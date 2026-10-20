"""Managed-host entrypoint. No local environment file or tunnel is used."""

import os

import uvicorn

from cloud_preflight import validate_environment

if __name__ == "__main__":
    validate_environment(os.environ)
    uvicorn.run(
        "bracket.app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8400")),
        proxy_headers=True,
    )
