from datetime import timedelta

from heliclockter import datetime_utc

from bracket.basketball import clock_view, default_game, project_box_score


def test_recorded_attempts_undo_and_unassigned_points():
    events = [
        dict(kind="three_made", side=1, player_id=7, period=1),
        dict(kind="free_throw_missed", side=1, player_id=7, period=1),
        dict(kind="two_made", side=1, player_id=7, period=1, undone_at="undone"),
        dict(kind="personal_foul", side=1, player_id=7, period=1),
        dict(kind="personal_foul", side=1, player_id=7, period=2),
        dict(kind="defensive_rebound", side=1, player_id=7, period=2),
        dict(kind="sub_in", side=1, player_id=7, period=2),
        dict(kind="sub_out", side=1, player_id=7, period=2),
    ]
    box = project_box_score(events, [{"id": 7}], [8, 0], 2, "standard")
    assert box["players"]["7"] | {} == {
        "pts": 3,
        "fgm": 1,
        "fga": 1,
        "tpm": 1,
        "tpa": 1,
        "ftm": 0,
        "fta": 1,
        "oreb": 0,
        "dreb": 1,
        "ast": 0,
        "stl": 0,
        "blk": 0,
        "to": 0,
        "pf": 2,
        "tf": 0,
        "uf": 0,
        "timeouts": 0,
        "violations": 0,
        "on_court": False,
    }
    assert box["teams"]["1"]["pts"] == 8
    assert box["teams"]["1"]["unassigned_points"] == 5
    assert box["teams"]["1"]["fouls_period"] == 1
    assert (
        project_box_score(events, [{"id": 7}], [8, 0], 2, "streetball")["teams"]["1"][
            "fouls_period"
        ]
        == 2
    )


def test_clock_elapsed_expired_and_paused():
    game = default_game(1)
    now = datetime_utc.now()
    game.update(remaining_ms=1000, started_at=now)
    assert clock_view(game, now + timedelta(milliseconds=250))["remaining_ms"] == 750
    assert clock_view(game, now + timedelta(seconds=2))["remaining_ms"] == 0
    assert clock_view(game, now + timedelta(seconds=2))["running"] is False
    game.update(remaining_ms=500, started_at=None)
    assert clock_view(game, now + timedelta(days=1))["remaining_ms"] == 500
