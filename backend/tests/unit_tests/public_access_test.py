from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from bracket import basketball, live
from bracket.database import database


@pytest.fixture
def public_app() -> FastAPI:
    app = FastAPI()
    app.include_router(live.router)
    app.include_router(basketball.router)
    return app


@pytest.mark.asyncio
async def test_public_list_and_snapshot_need_no_session(
    public_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    tournament = {"id": 1, "name": "Public cup", "revision": 1}

    class Row(dict[str, Any]):
        @property
        def _mapping(self) -> dict[str, Any]:
            return self

    @asynccontextmanager
    async def transaction(**_: Any) -> AsyncIterator[None]:
        yield

    monkeypatch.setattr(database, "transaction", transaction)
    monkeypatch.setattr(database, "fetch_one", AsyncMock(return_value=Row(tournament)))
    monkeypatch.setattr(live, "get_full_tournament_details", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        database,
        "fetch_all",
        AsyncMock(side_effect=[[SimpleNamespace(_mapping=tournament)], []]),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=public_app), base_url="http://test"
    ) as client:
        listing = await client.get(live.router.prefix + "/tournaments")
        snapshot = await client.get(live.router.prefix + "/tournaments/1")
    assert listing.status_code == snapshot.status_code == 200
    assert listing.json()[0]["name"] == "Public cup"
    assert snapshot.json()["tournament"] == tournament


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/tournaments"),
        ("PUT", "/tournaments/1/matches/1"),
        ("POST", "/tournaments/1/qualify"),
        ("POST", "/tournaments/1/reset"),
        ("POST", "/tournaments/1/reshuffle"),
        ("POST", "/tournaments/1/users"),
        ("POST", "/tournaments/1/basketball/matches/1/plays"),
        ("POST", "/tournaments/1/basketball/matches/1/plays/1/undo"),
        ("POST", "/tournaments/1/basketball/teams/1/players"),
    ],
)
async def test_public_viewer_cannot_write(public_app: FastAPI, method: str, path: str) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=public_app), base_url="http://test"
    ) as client:
        response = await client.request(method, live.router.prefix + path, json={})
    assert response.status_code == 401
