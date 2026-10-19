from typing import Any
from datetime import datetime

import sqlalchemy
from databases import Database
from heliclockter import datetime_utc

from bracket.config import config


def datetime_decoder(value: str) -> datetime_utc:
    # Keep both fractional seconds and the server's UTC offset. Dropping the fraction
    # also dropped its following offset and shifted audit times on non-UTC hosts.
    return datetime_utc.from_datetime(datetime.fromisoformat(value))


async def asyncpg_init(connection: Any) -> None:
    for timestamp_type in ("timestamp", "timestamptz"):
        await connection.set_type_codec(
            timestamp_type,
            encoder=datetime_utc.isoformat,
            decoder=datetime_decoder,
            schema="pg_catalog",
        )


database = Database(str(config.pg_dsn), init=asyncpg_init)

engine = sqlalchemy.create_engine(str(config.pg_dsn))
