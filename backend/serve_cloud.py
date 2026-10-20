"""Managed-host entrypoint. No local environment file or tunnel is used."""

import os
import asyncio

import uvicorn

from cloud_preflight import main as check_migrated_database

if __name__ == "__main__":
    # Free services do not support a separate paid pre-deploy command.
    # Never serve an empty replacement before the real database is restored.
    asyncio.run(check_migrated_database())
    uvicorn.run(
        "bracket.app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8400")),
        proxy_headers=True,
    )
