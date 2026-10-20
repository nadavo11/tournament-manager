"""Fail deployment until the existing tournament database has been restored."""

import asyncio
import os
from urllib.parse import urlsplit


def validate_environment(values):
    if values.get("ENVIRONMENT") != "PRODUCTION":
        raise ValueError("Cloud deployment requires ENVIRONMENT=PRODUCTION")
    host = urlsplit(values.get("PG_DSN", "")).hostname
    if (
        not host
        or host.lower() in {"localhost", "127.0.0.1", "::1"}
        or host.endswith(".trycloudflare.com")
    ):
        raise ValueError("A managed PostgreSQL connection is required")
    if len(values.get("JWT_SECRET", "")) < 32:
        raise ValueError("A production JWT secret of at least 32 characters is required")
    ids = [int(value) for value in values.get("REQUIRED_TOURNAMENT_IDS", "1,8").split(",")]
    if not ids or any(value <= 0 for value in ids):
        raise ValueError("Required migrated tournament IDs must be positive")
    return ids


async def main():
    required = validate_environment(os.environ)
    from bracket.database import database

    await database.connect()
    try:
        for tid in required:
            exists = await database.fetch_val(
                "SELECT id FROM live_tournaments WHERE id=:t", {"t": tid}
            )
            if not exists:
                raise RuntimeError(
                    "Required tournament data is missing; restore the migration backup first"
                )
        count = await database.fetch_val(
            "SELECT count(*) FROM users WHERE email IN ('admin1','admin2','admin3')"
        )
        if count != 3:
            raise RuntimeError("The three existing administrator accounts must be migrated")
        print("Cloud preflight passed: required tournaments and administrators exist")
    finally:
        await database.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
