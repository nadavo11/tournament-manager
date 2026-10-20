"""Mobile live-scoring adapter around Bracket's database and tournament engine."""

import json
import random
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from bracket.config import config
from bracket.database import database
from bracket.logic.ranking.calculation import (
    determine_team_ranking_for_stage_item,
    recalculate_ranking_for_stage_item,
)
from bracket.logic.ranking.elimination import update_inputs_in_subsequent_elimination_rounds
from bracket.logic.scheduling.builder import build_matches_for_stage_item
from bracket.models.db.stage_item import StageItemWithInputsCreate, StageType
from bracket.models.db.stage_item_inputs import (
    StageItemInputCreateBodyFinal,
    StageItemInputCreateBodyTentative,
)
from bracket.routes.auth import user_authenticated, check_jwt_and_get_user
from bracket.sql.stage_items import sql_create_stage_item_with_inputs, get_stage_item
from bracket.sql.stages import get_full_tournament_details
from bracket.sql.rankings import get_ranking_for_stage_item
from bracket.sql.users import create_user
from bracket.models.db.user import UserInsertable
from bracket.models.db.account import UserAccountType
from bracket.utils.security import hash_password
from heliclockter import datetime_utc

router = APIRouter(prefix=f"{config.api_prefix}/live")


async def relation(user_id, tournament_id):
    return await database.fetch_val(
        "SELECT u.relation FROM users_x_clubs u JOIN tournaments t ON t.club_id=u.club_id WHERE u.user_id=:u AND t.id=:t",
        {"u": user_id, "t": tournament_id},
    )


async def require_owner(user, tournament_id):
    if await relation(user.id, tournament_id) != "OWNER":
        raise HTTPException(403, "Organizer permission required")


async def legacy_write_guard(request, call_next):
    """Protect every legacy mutation too; scorekeepers use the versioned score endpoint."""
    path = request.url.path
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and path.startswith(
        config.api_prefix + "/"
    ):
        if path == config.api_prefix + "/token" or path.startswith(config.api_prefix + "/live/"):
            return await call_next(request)
        from starlette.responses import JSONResponse

        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        user = await check_jwt_and_get_user(token)
        if not user:
            return JSONResponse({"detail": "Authentication required"}, status_code=401)
        # Managed tournaments must never bypass version checks, including via upstream UI.
        parts = path.split("/")
        if "tournaments" in parts:
            i = parts.index("tournaments")
            if len(parts) > i + 1 and parts[i + 1].isdigit():
                tid = int(parts[i + 1])
                if await relation(user.id, tid) != "OWNER":
                    return JSONResponse(
                        {"detail": "Organizer permission required"}, status_code=403
                    )
                managed = await database.fetch_val(
                    "SELECT id FROM live_tournaments WHERE id=:t", {"t": tid}
                )
                if managed:
                    return JSONResponse(
                        {
                            "detail": "Use the Live workspace to preserve revisions and tournament invariants"
                        },
                        status_code=409,
                    )
        owner = await database.fetch_val(
            "SELECT id FROM users_x_clubs WHERE user_id=:u AND relation='OWNER' LIMIT 1",
            {"u": user.id},
        )
        if not owner:
            return JSONResponse({"detail": "Organizer permission required"}, status_code=403)
    return await call_next(request)


class Setup(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    teams: list[str] = Field(min_length=4, max_length=64)
    groups: int = Field(ge=2, le=16)
    qualify: int = Field(default=2, ge=1, le=4)
    shuffle: bool = True
    win_points: int = Field(default=3, ge=1, le=10)
    draw_points: int = Field(default=1, ge=0, le=10)

    @model_validator(mode="after")
    def validate_format(self):
        self.teams = [t.strip() for t in self.teams]
        if any(not t or len(t) > 80 for t in self.teams) or len(set(self.teams)) != len(self.teams):
            raise ValueError("Team names must be unique and 1–80 characters")
        if len(self.teams) // self.groups < max(2, self.qualify):
            raise ValueError("Each group needs enough teams for qualification")
        if self.groups * self.qualify not in {4, 8, 16, 32}:
            raise ValueError("Total qualifiers must be 4, 8, 16, or 32")
        return self


async def build_tournament(body, club_id):
    """Generate through upstream stage builders, without duplicating their algorithms."""
    tid = await database.fetch_val(
        "INSERT INTO tournaments(name,start_time,club_id,dashboard_public,players_can_be_in_multiple_teams,auto_assign_courts,duration_minutes,margin_minutes) VALUES(:n,NOW(),:c,true,false,false,15,5) RETURNING id",
        {"n": body.name, "c": club_id},
    )
    await database.execute(
        "INSERT INTO live_tournaments(id,qualify) VALUES(:t,:q)", {"t": tid, "q": body.qualify}
    )
    await database.execute(
        "INSERT INTO rankings(tournament_id,position,win_points,draw_points,loss_points,add_score_points) VALUES(:t,0,:w,:d,0,false)",
        {"t": tid, "w": body.win_points, "d": body.draw_points},
    )
    sid = await database.fetch_val(
        "INSERT INTO stages(name,tournament_id,is_active) VALUES('Group stage',:t,true) RETURNING id",
        {"t": tid},
    )
    names = body.teams.copy()
    if body.shuffle:
        random.SystemRandom().shuffle(names)
    teams = [
        await database.fetch_val(
            "INSERT INTO teams(name,tournament_id) VALUES(:n,:t) RETURNING id", {"n": n, "t": tid}
        )
        for n in names
    ]
    for g in range(body.groups):
        members = teams[g :: body.groups]
        item = await sql_create_stage_item_with_inputs(
            tid,
            StageItemWithInputsCreate(
                stage_id=sid,
                name=f"Group {chr(65 + g)}",
                type=StageType.ROUND_ROBIN,
                team_count=len(members),
                inputs=[
                    StageItemInputCreateBodyFinal(slot=i + 1, team_id=t)
                    for i, t in enumerate(members)
                ],
            ),
        )
        await build_matches_for_stage_item(item, tid)
    await database.execute(
        "UPDATE matches SET live_status='PENDING' WHERE round_id IN (SELECT r.id FROM rounds r JOIN stage_items si ON si.id=r.stage_item_id WHERE si.stage_id=:s)",
        {"s": sid},
    )
    for item in (await get_full_tournament_details(tid))[0].stage_items:
        await recalculate_ranking_for_stage_item(tid, item)
    await create_knockout_preview(tid)
    return tid


async def create_knockout_preview(tid):
    stages = await get_full_tournament_details(tid)
    if len(stages) > 1:
        return stages[1].stage_items[0]
    groups = sorted(stages[0].stage_items, key=lambda i: i.name)
    q = await database.fetch_val("SELECT qualify FROM live_tournaments WHERE id=:t", {"t": tid})
    seeds = []
    if len(groups) % 2 == 0 and q == 2:
        for offset in (0, 1):
            for g in range(0, len(groups), 2):
                seeds.extend([(groups[g + offset].id, 1), (groups[g + 1 - offset].id, 2)])
    else:
        flat = [(g.id, rank) for rank in range(1, q + 1) for g in groups]
        for i in range(len(flat) // 2):
            seeds.extend([flat[i], flat[-1 - i]])
    sid = await database.fetch_val(
        "INSERT INTO stages(name,tournament_id,is_active) VALUES('Knockout',:t,false) RETURNING id",
        {"t": tid},
    )
    item = await sql_create_stage_item_with_inputs(
        tid,
        StageItemWithInputsCreate(
            stage_id=sid,
            name="Championship bracket",
            type=StageType.SINGLE_ELIMINATION,
            team_count=len(seeds),
            inputs=[
                StageItemInputCreateBodyTentative(
                    slot=i + 1, winner_from_stage_item_id=g, winner_position=rank
                )
                for i, (g, rank) in enumerate(seeds)
            ],
        ),
    )
    await build_matches_for_stage_item(item, tid)
    await database.execute(
        "UPDATE matches SET live_status='PENDING' WHERE round_id IN (SELECT id FROM rounds WHERE stage_item_id=:s)",
        {"s": item.id},
    )
    return await get_stage_item(tid, item.id)


@router.get("/tournaments")
async def list_tournaments():
    return [
        dict(r._mapping)
        for r in await database.fetch_all(
            "SELECT t.id,t.name FROM tournaments t JOIN live_tournaments l ON l.id=t.id WHERE t.dashboard_public ORDER BY t.id"
        )
    ]


@router.get("/me")
async def me(user=Depends(user_authenticated)):
    memberships = await database.fetch_all(
        "SELECT club_id,relation FROM users_x_clubs WHERE user_id=:u", {"u": user.id}
    )
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "memberships": [dict(r._mapping) for r in memberships],
    }


@router.get("/tournaments/{tid}")
async def snapshot(tid: int, since: int | None = None):
    # A coherent MVCC snapshot even while another request commits scores and standings.
    async with database.transaction(isolation="repeatable_read"):
        t = await database.fetch_one(
            "SELECT t.*,l.revision,l.qualify,l.knockout_started FROM tournaments t JOIN live_tournaments l ON l.id=t.id WHERE t.id=:t AND t.dashboard_public",
            {"t": tid},
        )
        if not t:
            raise HTTPException(404, "Tournament not found")
        if since == t["revision"]:
            return {"unchanged": True}
        stages = await get_full_tournament_details(tid)
        tables = {}
        for stage in stages:
            for item in stage.stage_items:
                ranking = await get_ranking_for_stage_item(tid, item.id)
                ordered = determine_team_ranking_for_stage_item(item, ranking)
                by_id = {i.id: i for i in item.inputs}
                tables[str(item.id)] = [
                    {
                        "input_id": iid,
                        "name": getattr(by_id[iid], "team", None).name
                        if getattr(by_id[iid], "team", None)
                        else "TBD",
                        **stats.model_dump(mode="json"),
                    }
                    for iid, stats in ordered
                ]
        audit = await database.fetch_all(
            "SELECT id,match_id,actor,after,created FROM live_audit WHERE tournament_id=:t ORDER BY id DESC LIMIT 30",
            {"t": tid},
        )
        return {
            "tournament": dict(t._mapping),
            "stages": [s.model_dump(mode="json") for s in stages],
            "standings": tables,
            "audit": [dict(a._mapping) for a in audit],
        }


@router.post("/tournaments")
async def create(body: Setup, user=Depends(user_authenticated)):
    club = await database.fetch_val(
        "SELECT club_id FROM users_x_clubs WHERE user_id=:u AND relation='OWNER' LIMIT 1",
        {"u": user.id},
    )
    if not club:
        raise HTTPException(403, "Organizer permission required")
    async with database.transaction():
        return {"id": await build_tournament(body, club)}


class Score(BaseModel):
    version: int = Field(ge=0)
    home: int = Field(ge=0, le=999)
    away: int = Field(ge=0, le=999)
    status: Literal["PENDING", "LIVE", "COMPLETED"]
    tiebreak_winner: Literal[1, 2] | None = None


@router.put("/tournaments/{tid}/matches/{mid}")
async def score(tid: int, mid: int, body: Score, user=Depends(user_authenticated)):
    return await apply_score(tid, mid, body, user)


async def apply_score(tid: int, mid: int, body: Score, user, *, basketball: bool = False):
    if await relation(user.id, tid) not in {"OWNER", "COLLABORATOR"}:
        raise HTTPException(403, "Scoring permission required")
    async with database.transaction():
        # Serialize derived standings/progression per tournament, across workers too.
        tournament = await database.fetch_one(
            "SELECT * FROM live_tournaments WHERE id=:t FOR UPDATE", {"t": tid}
        )
        if not tournament:
            raise HTTPException(404, "Tournament not found")
        row = await database.fetch_one(
            "SELECT m.*,si.type,si.id AS item_id FROM matches m JOIN rounds r ON r.id=m.round_id JOIN stage_items si ON si.id=r.stage_item_id JOIN stages s ON s.id=si.stage_id WHERE m.id=:m AND s.tournament_id=:t",
            {"m": mid, "t": tid},
        )
        if not row:
            raise HTTPException(404, "Match not found")
        if row["live_version"] != body.version:
            raise HTTPException(
                409, "Another scorekeeper changed this match. Review the latest score and retry."
            )
        if (
            not basketball
            and (
                body.home != row["stage_item_input1_score"]
                or body.away != row["stage_item_input2_score"]
                or body.status != row["live_status"]
                or body.tiebreak_winner != row["tiebreak_winner"]
            )
            and await database.fetch_val(
                "SELECT id FROM basketball_events WHERE match_id=:m LIMIT 1", {"m": mid}
            )
        ):
            raise HTTPException(
                409, "This match has a play log. Use Live Court to control the game or correct a play."
            )
        if row["type"] == "ROUND_ROBIN" and tournament["knockout_started"]:
            raise HTTPException(
                409, "Group results are locked after qualification. Reset knockout first."
            )
        if not row["stage_item_input1_id"] or not row["stage_item_input2_id"]:
            raise HTTPException(409, "Both participants must qualify first")
        if (
            row["type"] == "SINGLE_ELIMINATION"
            and body.status == "COMPLETED"
            and body.home == body.away
            and body.tiebreak_winner is None
        ):
            raise HTTPException(422, "Choose the penalty/overtime winner for a tied knockout match")
        if row["type"] == "SINGLE_ELIMINATION":
            if not tournament["knockout_started"]:
                raise HTTPException(
                    409, "Complete group qualification before scoring knockout matches"
                )
            downstream = await database.fetch_val(
                "WITH RECURSIVE d AS (SELECT id FROM matches WHERE stage_item_input1_winner_from_match_id=:m OR stage_item_input2_winner_from_match_id=:m UNION SELECT m.id FROM matches m JOIN d ON m.stage_item_input1_winner_from_match_id=d.id OR m.stage_item_input2_winner_from_match_id=d.id) SELECT count(*) FROM matches WHERE id IN (SELECT id FROM d) AND live_status<>'PENDING'",
                {"m": mid},
            )
            if downstream:
                raise HTTPException(
                    409,
                    "A later round has started. Clear later results before correcting this match.",
                )
        await database.execute(
            "UPDATE matches SET stage_item_input1_score=:h,stage_item_input2_score=:a,live_status=:s,live_version=live_version+1,tiebreak_winner=:w WHERE id=:m",
            {
                "m": mid,
                "h": body.home,
                "a": body.away,
                "s": body.status,
                "w": body.tiebreak_winner if body.home == body.away else None,
            },
        )
        item = await get_stage_item(tid, row["item_id"])
        await recalculate_ranking_for_stage_item(tid, item)
        if row["type"] == "SINGLE_ELIMINATION":
            await update_inputs_in_subsequent_elimination_rounds(row["round_id"], item, {mid})
        await database.execute(
            "INSERT INTO live_audit(tournament_id,match_id,actor,before,after) VALUES(:t,:m,:a,:b,:v)",
            {
                "t": tid,
                "m": mid,
                "a": user.name,
                "b": json.dumps(
                    {
                        "home": row["stage_item_input1_score"],
                        "away": row["stage_item_input2_score"],
                        "status": row["live_status"],
                    }
                ),
                "v": body.model_dump_json(),
            },
        )
        await database.execute(
            "UPDATE live_tournaments SET revision=revision+1 WHERE id=:t", {"t": tid}
        )
    return {"version": body.version + 1}


@router.post("/tournaments/{tid}/qualify")
async def qualify(tid: int, user=Depends(user_authenticated)):
    await require_owner(user, tid)
    async with database.transaction():
        t = await database.fetch_one(
            "SELECT * FROM live_tournaments WHERE id=:t FOR UPDATE", {"t": tid}
        )
        if t["knockout_started"]:
            raise HTTPException(409, "Knockout already generated")
        stages = await get_full_tournament_details(tid)
        groups = sorted(stages[0].stage_items, key=lambda i: i.name)
        if any(m.live_status != "COMPLETED" for g in groups for r in g.rounds for m in r.matches):
            raise HTTPException(409, "Complete every group match before qualifying teams")
        winners = []
        for g in groups:
            ranks = determine_team_ranking_for_stage_item(
                g, await get_ranking_for_stage_item(tid, g.id)
            )
            inputs = {i.id: i for i in g.inputs}
            winners.append([inputs[i].team_id for i, _ in ranks[: t["qualify"]]])
        item = await create_knockout_preview(tid)
        by_group = {g.id: winners[index] for index, g in enumerate(groups)}
        for input_ in item.inputs:
            team = by_group[input_.winner_from_stage_item_id][input_.winner_position - 1]
            await database.execute(
                "UPDATE stage_item_inputs SET team_id=:team WHERE id=:i",
                {"team": team, "i": input_.id},
            )
        await database.execute(
            "UPDATE matches SET live_version=live_version+1 WHERE round_id IN (SELECT id FROM rounds WHERE stage_item_id=:s)",
            {"s": item.id},
        )
        await database.execute(
            "UPDATE stages SET is_active=(id=:s) WHERE tournament_id=:t",
            {"s": item.stage_id, "t": tid},
        )
        await database.execute(
            "UPDATE live_tournaments SET knockout_started=true,revision=revision+1 WHERE id=:t",
            {"t": tid},
        )
    return {"ok": True}


@router.post("/tournaments/{tid}/reset")
async def reset(tid: int, user=Depends(user_authenticated)):
    await require_owner(user, tid)
    async with database.transaction():
        await database.fetch_one(
            "SELECT id FROM live_tournaments WHERE id=:t FOR UPDATE", {"t": tid}
        )
        stages = await get_full_tournament_details(tid)
        await database.execute(
            "DELETE FROM basketball_games WHERE match_id IN (SELECT m.id FROM matches m JOIN rounds r ON r.id=m.round_id JOIN stage_items si ON si.id=r.stage_item_id JOIN stages s ON s.id=si.stage_id WHERE s.tournament_id=:t)",
            {"t": tid},
        )
        await database.execute("DELETE FROM basketball_events WHERE tournament_id=:t", {"t": tid})
        for stage in reversed(stages[1:]):
            for item in stage.stage_items:
                await database.execute(
                    "DELETE FROM matches WHERE round_id IN (SELECT id FROM rounds WHERE stage_item_id=:s)",
                    {"s": item.id},
                )
                await database.execute("DELETE FROM rounds WHERE stage_item_id=:s", {"s": item.id})
                await database.execute("DELETE FROM stage_items WHERE id=:s", {"s": item.id})
            await database.execute("DELETE FROM stages WHERE id=:s", {"s": stage.id})
        await database.execute(
            "UPDATE matches SET stage_item_input1_score=0,stage_item_input2_score=0,live_status='PENDING',tiebreak_winner=NULL,live_version=live_version+1 WHERE round_id IN (SELECT r.id FROM rounds r JOIN stage_items si ON si.id=r.stage_item_id JOIN stages s ON s.id=si.stage_id WHERE s.tournament_id=:t)",
            {"t": tid},
        )
        await seed_scores(tid)
        await create_knockout_preview(tid)
        await database.execute(
            "UPDATE live_tournaments SET knockout_started=false,revision=revision+1 WHERE id=:t",
            {"t": tid},
        )
        await database.execute(
            "INSERT INTO live_audit(tournament_id,actor,before,after) VALUES(:t,:a,'{}','{\"action\":\"reset\"}')",
            {"t": tid, "a": user.name},
        )
    return {"ok": True}


async def seed_scores(tid):
    stages = await get_full_tournament_details(tid)
    for g in stages[0].stage_items:
        matches = sorted([m for r in g.rounds for m in r.matches], key=lambda m: m.id)
        for index, m in enumerate(matches[:3]):
            await database.execute(
                "UPDATE matches SET stage_item_input1_score=:h,stage_item_input2_score=:a,live_status=:s WHERE id=:m",
                {
                    "m": m.id,
                    "h": [2, 1, 1][index],
                    "a": [0, 1, 0][index],
                    "s": "LIVE" if index == 2 else "COMPLETED",
                },
            )
        await recalculate_ranking_for_stage_item(tid, await get_stage_item(tid, g.id))


@router.post("/tournaments/{tid}/reshuffle")
async def reshuffle(tid: int, user=Depends(user_authenticated)):
    await require_owner(user, tid)
    async with database.transaction():
        meta = await database.fetch_one(
            "SELECT * FROM live_tournaments WHERE id=:t FOR UPDATE", {"t": tid}
        )
        if not meta or meta["knockout_started"]:
            raise HTTPException(409, "Reshuffle is only available before group play")
        stage = (await get_full_tournament_details(tid))[0]
        if any(
            m.live_status != "PENDING"
            for g in stage.stage_items
            for r in g.rounds
            for m in r.matches
        ):
            raise HTTPException(409, "Reshuffle is only available before any match starts")
        inputs = [i for g in stage.stage_items for i in g.inputs]
        team_ids = [i.team_id for i in inputs]
        random.SystemRandom().shuffle(team_ids)
        await database.execute(
            "UPDATE stage_item_inputs SET team_id=NULL WHERE stage_item_id IN (SELECT id FROM stage_items WHERE stage_id=:s)",
            {"s": stage.id},
        )
        for i, team_id in zip(inputs, team_ids):
            await database.execute(
                "UPDATE stage_item_inputs SET team_id=:t WHERE id=:i", {"t": team_id, "i": i.id}
            )
        await database.execute(
            "UPDATE matches SET live_version=live_version+1 WHERE round_id IN (SELECT r.id FROM rounds r JOIN stage_items si ON si.id=r.stage_item_id WHERE si.stage_id=:s)",
            {"s": stage.id},
        )
        await database.execute(
            "UPDATE live_tournaments SET revision=revision+1 WHERE id=:t", {"t": tid}
        )
        await database.execute(
            "INSERT INTO live_audit(tournament_id,actor,before,after) VALUES(:t,:a,'{}','{\"action\":\"reshuffle\"}')",
            {"t": tid, "a": user.name},
        )
    return {"ok": True}


class Invite(BaseModel):
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=64)
    role: Literal["OWNER", "COLLABORATOR"] = "COLLABORATOR"


@router.post("/tournaments/{tid}/users")
async def invite(tid: int, body: Invite, user=Depends(user_authenticated)):
    await require_owner(user, tid)
    async with database.transaction():
        if await database.fetch_val("SELECT id FROM users WHERE email=:e", {"e": body.email}):
            raise HTTPException(409, "Email already exists")
        created = await create_user(
            UserInsertable(
                email=body.email,
                name=body.name,
                password_hash=hash_password(body.password),
                created=datetime_utc.now(),
                account_type=UserAccountType.REGULAR,
            )
        )
        club = await database.fetch_val("SELECT club_id FROM tournaments WHERE id=:t", {"t": tid})
        await database.execute(
            "INSERT INTO users_x_clubs(user_id,club_id,relation) VALUES(:u,:c,:r)",
            {"u": created.id, "c": club, "r": body.role},
        )
    return {"id": created.id}
