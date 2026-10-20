"""Basketball event capture over Bracket matches, with atomic/idempotent relative scoring."""

import json
from collections import Counter
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from heliclockter import datetime_utc
from pydantic import BaseModel, Field

from bracket.config import config
from bracket.database import database
from bracket.live import Score, apply_score, relation, require_owner
from bracket.routes.auth import user_authenticated

router = APIRouter(prefix=f"{config.api_prefix}/live")

POINTS = {
    "one_made": 1,
    "two_made": 2,
    "three_made": 3,
    "free_throw_made": 1,
    "adjust_plus": 1,
    "adjust_minus": -1,
}
SHOTS = {
    "one_made": ("fgm", "fga"),
    "two_made": ("fgm", "fga"),
    "three_made": ("fgm", "fga", "tpm", "tpa"),
    "one_missed": ("fga",),
    "two_missed": ("fga",),
    "three_missed": ("fga", "tpa"),
    "free_throw_made": ("ftm", "fta"),
    "free_throw_missed": ("fta",),
}
COUNTERS = {
    "offensive_rebound": "oreb",
    "defensive_rebound": "dreb",
    "assist": "ast",
    "steal": "stl",
    "block": "blk",
    "turnover": "to",
    "personal_foul": "pf",
    "technical_foul": "tf",
    "unsportsmanlike_foul": "uf",
    "timeout": "timeouts",
    "violation": "violations",
}
STATS = set(POINTS) | set(SHOTS) | set(COUNTERS) | {"sub_in", "sub_out"}
CONTROLS = {
    "clock_start",
    "clock_pause",
    "set_clock",
    "next_period",
    "profile",
    "possession",
    "finish",
    "resume",
}
FIELDS = (
    "pts",
    "fgm",
    "fga",
    "tpm",
    "tpa",
    "ftm",
    "fta",
    "oreb",
    "dreb",
    "ast",
    "stl",
    "blk",
    "to",
    "pf",
    "tf",
    "uf",
    "timeouts",
    "violations",
)


def default_game(mid):
    return {
        "match_id": mid,
        "profile": "standard",
        "period": 1,
        "period_count": 4,
        "period_seconds": 600,
        "remaining_ms": 600000,
        "started_at": None,
        "possession": None,
    }


def clock_view(game, now=None):
    now = now or datetime_utc.now()
    remaining = game["remaining_ms"]
    if game["started_at"] is not None:
        remaining -= int((now - game["started_at"]).total_seconds() * 1000)
    return {
        "remaining_ms": max(0, remaining),
        "running": game["started_at"] is not None and remaining > 0,
        "server_now": now.isoformat(),
    }


def project_box_score(events, roster, scores, period, profile):
    """Count only active events; prior/imported points remain explicitly unassigned."""
    teams = {str(side): {key: 0 for key in FIELDS} | {"fouls_period": 0} for side in (1, 2)}
    players = {str(p["id"]): {key: 0 for key in FIELDS} | {"on_court": None} for p in roster}
    attributed = Counter()
    for event in events:
        if event.get("undone_at") is not None or event["kind"] not in STATS:
            continue
        side = str(event["side"])
        team = teams[side]
        player = players.get(str(event.get("player_id")))
        delta = POINTS.get(event["kind"], 0)
        team["pts"] += delta
        if player is not None:
            player["pts"] += delta
            attributed[side] += delta
        for key in SHOTS.get(event["kind"], ()):
            team[key] += 1
            if player is not None:
                player[key] += 1
        if key := COUNTERS.get(event["kind"]):
            team[key] += 1
            if player is not None:
                player[key] += 1
        if event["kind"] in {"personal_foul", "technical_foul", "unsportsmanlike_foul"} and (
            profile == "streetball" or event["period"] == period
        ):
            team["fouls_period"] += 1
        if player is not None and event["kind"] in {"sub_in", "sub_out"}:
            player["on_court"] = event["kind"] == "sub_in"
    for side in (1, 2):
        teams[str(side)]["pts"] = scores[side - 1]
        teams[str(side)]["unassigned_points"] = scores[side - 1] - attributed[str(side)]
    return {"teams": teams, "players": players}


async def match_row(tid, mid, *, public=False):
    row = await database.fetch_one(
        "SELECT m.*,s.tournament_id,si.type,si.id AS item_id,t.dashboard_public,t.status AS tournament_status,i1.team_id AS home_team_id,i2.team_id AS away_team_id,ht.name AS home_name,at.name AS away_name FROM matches m JOIN rounds r ON r.id=m.round_id JOIN stage_items si ON si.id=r.stage_item_id JOIN stages s ON s.id=si.stage_id JOIN tournaments t ON t.id=s.tournament_id LEFT JOIN stage_item_inputs i1 ON i1.id=m.stage_item_input1_id LEFT JOIN stage_item_inputs i2 ON i2.id=m.stage_item_input2_id LEFT JOIN teams ht ON ht.id=i1.team_id LEFT JOIN teams at ON at.id=i2.team_id WHERE m.id=:m AND s.tournament_id=:t",
        {"m": mid, "t": tid},
    )
    if row is None or (public and not row["dashboard_public"]):
        raise HTTPException(404, "Match not found")
    return dict(row._mapping)


async def game_row(mid):
    row = await database.fetch_one("SELECT * FROM basketball_games WHERE match_id=:m", {"m": mid})
    return dict(row._mapping) if row else default_game(mid)


async def lock_game(tid, mid, user):
    if await relation(user.id, tid) not in {"OWNER", "COLLABORATOR"}:
        raise HTTPException(403, "Scoring permission required")
    if not await database.fetch_val(
        "SELECT id FROM live_tournaments WHERE id=:t FOR UPDATE", {"t": tid}
    ):
        raise HTTPException(404, "Tournament not found")
    row = await match_row(tid, mid)
    if row["tournament_status"] == "ARCHIVED":
        raise HTTPException(409, "This tournament is archived")
    if not row["home_team_id"] or not row["away_team_id"]:
        raise HTTPException(409, "Both teams must qualify before scoring")
    return row


@router.get("/tournaments/{tid}/basketball/matches/{mid}")
async def game_snapshot(tid: int, mid: int, since: int | None = None):
    async with database.transaction(isolation="repeatable_read"):
        row = await match_row(tid, mid, public=True)
        game = await game_row(mid)
        clock = clock_view(game)
        if since == row["live_version"]:
            return {"unchanged": True, "version": row["live_version"], "clock": clock}
        roster = [
            dict(r._mapping)
            for r in await database.fetch_all(
                "SELECT DISTINCT p.id,p.name,pt.team_id,j.jersey FROM players p JOIN players_x_teams pt ON pt.player_id=p.id LEFT JOIN basketball_jerseys j ON j.player_id=p.id WHERE p.tournament_id=:t AND p.active AND pt.team_id=ANY(:teams) ORDER BY pt.team_id,p.id",
                {
                    "t": tid,
                    "teams": [
                        x for x in (row["home_team_id"], row["away_team_id"]) if x is not None
                    ],
                },
            )
        ]
        events = [
            dict(e._mapping)
            for e in await database.fetch_all(
                "SELECT * FROM basketball_events WHERE match_id=:m ORDER BY id", {"m": mid}
            )
        ]
        boxes = project_box_score(
            events,
            roster,
            [row["stage_item_input1_score"], row["stage_item_input2_score"]],
            game["period"],
            game["profile"],
        )
        return {
            "version": row["live_version"],
            "match": {
                "id": mid,
                "home": row["home_name"] or "TBD",
                "away": row["away_name"] or "TBD",
                "home_team_id": row["home_team_id"],
                "away_team_id": row["away_team_id"],
                "home_score": row["stage_item_input1_score"],
                "away_score": row["stage_item_input2_score"],
                "status": row["live_status"],
                "type": row["type"],
            },
            "game": {k: v for k, v in game.items() if k != "started_at"},
            "clock": clock,
            "roster": roster,
            "box": boxes,
            "events": [
                {**e, "undoable": e["kind"] in STATS and e["undone_at"] is None}
                for e in reversed(events[-60:])
            ],
        }


class Play(BaseModel):
    request_id: UUID
    kind: str = Field(min_length=1, max_length=35)
    side: Literal[1, 2] | None = None
    player_id: int | None = Field(default=None, gt=0)
    profile: Literal["standard", "streetball"] = "standard"
    version: int | None = Field(default=None, ge=0)
    seconds: int | None = Field(default=None, ge=0, le=7200)
    period_count: Literal[1, 2, 4] = 4
    period_seconds: int = Field(default=600, ge=60, le=3600)
    tiebreak_winner: Literal[1, 2] | None = None


async def duplicate(mid, request_id, payload):
    existing = await database.fetch_one(
        "SELECT payload FROM basketball_events WHERE match_id=:m AND request_id=:r",
        {"m": mid, "r": str(request_id)},
    )
    if existing:
        if existing["payload"] != payload:
            raise HTTPException(409, "That request ID was already used for a different play")
        return True
    return False


async def insert_event(tid, mid, user, body, game, payload):
    return await database.fetch_val(
        "INSERT INTO basketball_events(tournament_id,match_id,request_id,kind,side,player_id,period,clock_ms,actor,payload) VALUES(:t,:m,:r,:k,:s,:p,:period,:clock,:actor,:payload) RETURNING id",
        {
            "t": tid,
            "m": mid,
            "r": str(body.request_id),
            "k": body.kind,
            "s": body.side,
            "p": body.player_id,
            "period": game["period"],
            "clock": clock_view(game)["remaining_ms"],
            "actor": user.name,
            "payload": payload,
        },
    )


async def save_game(game):
    await database.execute(
        "INSERT INTO basketball_games(match_id,profile,period,period_count,period_seconds,remaining_ms,started_at,possession) VALUES(:match_id,:profile,:period,:period_count,:period_seconds,:remaining_ms,:started_at,:possession) ON CONFLICT(match_id) DO UPDATE SET profile=EXCLUDED.profile,period=EXCLUDED.period,period_count=EXCLUDED.period_count,period_seconds=EXCLUDED.period_seconds,remaining_ms=EXCLUDED.remaining_ms,started_at=EXCLUDED.started_at,possession=EXCLUDED.possession",
        game,
    )


@router.post("/tournaments/{tid}/basketball/matches/{mid}/plays")
async def record_play(tid: int, mid: int, body: Play, user=Depends(user_authenticated)):
    payload = body.model_dump_json()
    async with database.transaction():
        row = await lock_game(tid, mid, user)
        if await duplicate(mid, body.request_id, payload):
            return {"accepted": True, "duplicate": True}
        if body.kind not in STATS | CONTROLS:
            raise HTTPException(422, "Unknown basketball action")
        if row["live_status"] == "COMPLETED" and body.kind != "resume":
            raise HTTPException(409, "Game is final. Reopen it before recording another play")
        game = await game_row(mid)
        if body.kind in STATS:
            if body.side is None:
                raise HTTPException(422, "Choose a team")
            if body.profile != game["profile"]:
                raise HTTPException(
                    409, "The scoring preset changed. Review the current buttons and retry"
                )
            if (
                game["profile"] == "streetball" and body.kind in {"three_made", "three_missed"}
            ) or (game["profile"] == "standard" and body.kind in {"one_made", "one_missed"}):
                raise HTTPException(422, "This shot does not belong to the selected scoring preset")
            if body.kind in {"adjust_plus", "adjust_minus", "timeout"} and body.player_id:
                raise HTTPException(422, "Record this action for the team, without a player")
            if body.kind in {"sub_in", "sub_out"} and body.player_id is None:
                raise HTTPException(422, "Choose the player entering or leaving")
            if body.player_id:
                team = row["home_team_id"] if body.side == 1 else row["away_team_id"]
                if not await database.fetch_val(
                    "SELECT p.id FROM players p JOIN players_x_teams pt ON pt.player_id=p.id WHERE p.id=:p AND p.tournament_id=:t AND pt.team_id=:team AND p.active",
                    {"p": body.player_id, "t": tid, "team": team},
                ):
                    raise HTTPException(422, "That player does not belong to the selected team")
        else:
            if body.version != row["live_version"]:
                raise HTTPException(
                    409, "Another scorekeeper changed the game. Review the latest state and retry"
                )
            if body.player_id:
                raise HTTPException(422, "Game controls do not take a player")
        home, away = row["stage_item_input1_score"], row["stage_item_input2_score"]
        if body.side == 1:
            home += POINTS.get(body.kind, 0)
        if body.side == 2:
            away += POINTS.get(body.kind, 0)
        if min(home, away) < 0 or max(home, away) > 999:
            raise HTTPException(422, "Score must be between 0 and 999")
        if body.kind == "adjust_minus":
            attributed = await database.fetch_all(
                "SELECT kind FROM basketball_events WHERE match_id=:m AND side=:s AND player_id IS NOT NULL AND undone_at IS NULL",
                {"m": mid, "s": body.side},
            )
            if sum(POINTS.get(e["kind"], 0) for e in attributed) > (
                home if body.side == 1 else away
            ):
                raise HTTPException(
                    409, "Undo the player's scoring play before removing an attributed point"
                )
        status = row["live_status"]
        if body.kind in STATS | {"clock_start", "next_period", "resume"}:
            status = "LIVE"
        if body.kind in {"clock_pause", "set_clock", "next_period", "profile", "finish", "timeout"}:
            game["remaining_ms"] = clock_view(game)["remaining_ms"]
            game["started_at"] = None
        if body.kind == "clock_start":
            if clock_view(game)["running"]:
                raise HTTPException(409, "The clock is already running")
            game["remaining_ms"] = clock_view(game)["remaining_ms"]
            if game["remaining_ms"] <= 0:
                raise HTTPException(409, "Set the clock or move to the next period first")
            game["started_at"] = datetime_utc.now()
        elif body.kind == "set_clock":
            if body.seconds is None:
                raise HTTPException(422, "Enter the remaining seconds")
            game["remaining_ms"] = body.seconds * 1000
        elif body.kind == "next_period":
            game["period"] += 1
            game["remaining_ms"] = (
                300 if game["period"] > game["period_count"] else game["period_seconds"]
            ) * 1000
        elif body.kind == "profile":
            if await database.fetch_val(
                "SELECT id FROM basketball_events WHERE match_id=:m AND kind=ANY(:kinds) AND undone_at IS NULL LIMIT 1",
                {"m": mid, "kinds": list(STATS)},
            ):
                raise HTTPException(409, "Choose the scoring preset before the first recorded play")
            game.update(
                profile=body.profile,
                period=1,
                period_count=1 if body.profile == "streetball" else body.period_count,
                period_seconds=body.period_seconds,
                remaining_ms=body.period_seconds * 1000,
            )
        elif body.kind == "possession":
            if body.side is None:
                raise HTTPException(422, "Choose a possession side")
            game["possession"] = body.side
        elif body.kind == "finish":
            status = "COMPLETED"
        await insert_event(tid, mid, user, body, game, payload)
        await save_game(game)
        await apply_score(
            tid,
            mid,
            Score(
                version=row["live_version"],
                home=home,
                away=away,
                status=status,
                tiebreak_winner=body.tiebreak_winner,
            ),
            user,
            basketball=True,
        )
    return {"accepted": True}


class Undo(BaseModel):
    request_id: UUID
    version: int = Field(ge=0)


@router.post("/tournaments/{tid}/basketball/matches/{mid}/plays/{event_id}/undo")
async def undo_play(
    tid: int, mid: int, event_id: int, body: Undo, user=Depends(user_authenticated)
):
    payload = json.dumps({"undo": event_id, **body.model_dump(mode="json")}, sort_keys=True)
    async with database.transaction():
        row = await lock_game(tid, mid, user)
        if await duplicate(mid, body.request_id, payload):
            return {"accepted": True, "duplicate": True}
        if row["live_status"] == "COMPLETED":
            raise HTTPException(409, "Reopen the game before undoing a play")
        if body.version != row["live_version"]:
            raise HTTPException(
                409, "Another scorekeeper changed this game. Review the log and retry"
            )
        event = await database.fetch_one(
            "SELECT * FROM basketball_events WHERE id=:e AND match_id=:m", {"e": event_id, "m": mid}
        )
        if not event or event["kind"] not in STATS or event["undone_at"] is not None:
            raise HTTPException(409, "That play cannot be undone")
        home, away = row["stage_item_input1_score"], row["stage_item_input2_score"]
        if event["side"] == 1:
            home -= POINTS.get(event["kind"], 0)
        else:
            away -= POINTS.get(event["kind"], 0)
        if min(home, away) < 0 or max(home, away) > 999:
            raise HTTPException(409, "Undo later score corrections before undoing this play")
        credited = await database.fetch_all(
            "SELECT kind FROM basketball_events WHERE match_id=:m AND side=:s AND player_id IS NOT NULL AND undone_at IS NULL AND id<>:e",
            {"m": mid, "s": event["side"], "e": event_id},
        )
        if sum(POINTS.get(e["kind"], 0) for e in credited) > (home if event["side"] == 1 else away):
            raise HTTPException(
                409, "Undo later score corrections before removing an attributed point"
            )
        await database.execute(
            "UPDATE basketball_events SET undone_at=NOW(),undone_by=:u WHERE id=:e",
            {"u": user.name, "e": event_id},
        )
        game = await game_row(mid)
        command = Play(request_id=body.request_id, kind="undo", version=body.version)
        await insert_event(tid, mid, user, command, game, payload)
        await apply_score(
            tid,
            mid,
            Score(version=row["live_version"], home=home, away=away, status=row["live_status"]),
            user,
            basketball=True,
        )
    return {"accepted": True}


class RosterEntry(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    jersey: str = Field(default="", max_length=3, pattern=r"^\d{0,3}$")


class Roster(BaseModel):
    players: list[RosterEntry] = Field(min_length=1, max_length=25)


@router.post("/tournaments/{tid}/basketball/teams/{team_id}/players")
async def add_roster(tid: int, team_id: int, body: Roster, user=Depends(user_authenticated)):
    await require_owner(user, tid)
    async with database.transaction():
        await database.fetch_one(
            "SELECT id FROM live_tournaments WHERE id=:t FOR UPDATE", {"t": tid}
        )
        if not await database.fetch_val(
            "SELECT id FROM teams WHERE id=:team AND tournament_id=:t", {"team": team_id, "t": tid}
        ):
            raise HTTPException(404, "Team not found")
        count = await database.fetch_val(
            "SELECT count(*) FROM players_x_teams WHERE team_id=:team", {"team": team_id}
        )
        if count + len(body.players) > 30:
            raise HTTPException(422, "A team can have up to 30 rostered players")
        ids = []
        for entry in body.players:
            if not entry.name.strip():
                raise HTTPException(422, "Enter a player name")
            pid = await database.fetch_val(
                "INSERT INTO players(name,tournament_id,active,elo_score,swiss_score,wins,draws,losses) VALUES(:n,:t,true,1200,0,0,0,0) RETURNING id",
                {"n": entry.name.strip(), "t": tid},
            )
            await database.execute(
                "INSERT INTO players_x_teams(player_id,team_id) VALUES(:p,:t)",
                {"p": pid, "t": team_id},
            )
            await database.execute(
                "INSERT INTO basketball_jerseys(player_id,jersey) VALUES(:p,:j)",
                {"p": pid, "j": entry.jersey},
            )
            ids.append(pid)
        await database.execute(
            "UPDATE matches SET live_version=live_version+1 WHERE stage_item_input1_id IN (SELECT id FROM stage_item_inputs WHERE team_id=:t) OR stage_item_input2_id IN (SELECT id FROM stage_item_inputs WHERE team_id=:t)",
            {"t": team_id},
        )
        await database.execute(
            "UPDATE live_tournaments SET revision=revision+1 WHERE id=:t", {"t": tid}
        )
    return {"ids": ids}
