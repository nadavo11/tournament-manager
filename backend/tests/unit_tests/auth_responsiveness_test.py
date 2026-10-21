import asyncio
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bracket.routes import auth


@pytest.mark.asyncio
async def test_password_check_does_not_block_live_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(password_hash="stored-hash")
    monkeypatch.setattr(auth, "get_user", AsyncMock(return_value=user))
    entered = threading.Event()
    release = threading.Event()

    def verify(password: str, hashed: str) -> bool:
        assert (password, hashed) == ("password", "stored-hash")
        entered.set()
        return release.wait(timeout=2)

    monkeypatch.setattr(auth, "verify_password", verify)
    task = asyncio.create_task(auth.authenticate_user("organizer", "password"))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        # The event loop gets here before verification finishes, so reads can proceed.
        assert not task.done()
    finally:
        release.set()
        result = await task
    assert result is user


@pytest.mark.asyncio
async def test_invalid_password_still_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth, "get_user", AsyncMock(return_value=SimpleNamespace(password_hash="stored-hash"))
    )
    monkeypatch.setattr(auth, "verify_password", lambda *_: False)
    assert await auth.authenticate_user("organizer", "wrong") is None
