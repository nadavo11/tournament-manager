"""Private, consistent migration export; restore only into an empty database.

Credentials are read from environment/private runtime files, never CLI arguments.
"""

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs

import psycopg2
from psycopg2 import sql
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def connection_environment(dsn):
    parsed = urlsplit(dsn)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise ValueError("A PostgreSQL connection is required")
    values = dict(os.environ)
    values.update(
        PGHOST=parsed.hostname,
        PGPORT=str(parsed.port or 5432),
        PGUSER=unquote(parsed.username or ""),
        PGPASSWORD=unquote(parsed.password or ""),
        PGDATABASE=unquote(parsed.path.lstrip("/")),
    )
    options = parse_qs(parsed.query)
    if "sslmode" in options:
        values["PGSSLMODE"] = options["sslmode"][0]
    return values


def counts(connection):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        )
        tables = [row[0] for row in cursor.fetchall()]
        result = {}
        for table in tables:
            cursor.execute(
                sql.SQL("SELECT count(*) FROM public.{}").format(sql.Identifier(table))
            )
            result[table] = cursor.fetchone()[0]
        return result


def pg_tool(name):
    bundled = ROOT.parent / ".runtime" / "pgsql" / "bin" / (name + ".exe")
    return str(bundled) if bundled.exists() else name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["export", "restore"])
    parser.add_argument("--archive", type=Path, required=True)
    args = parser.parse_args()
    archive = args.archive.resolve()
    private = (ROOT / ".local").resolve()
    if not archive.is_relative_to(private):
        raise ValueError("Migration archives must stay in the private .local directory")
    manifest = archive.with_suffix(".json")
    load_dotenv(ROOT / ".local" / "runtime.env")
    if args.action == "export":
        if archive.exists() or manifest.exists():
            raise ValueError(
                "Choose a new archive filename; existing backups are never overwritten"
            )
        archive.parent.mkdir(parents=True, exist_ok=True)
        dsn = os.environ["PG_DSN"]
        with psycopg2.connect(dsn) as connection:
            connection.set_session(isolation_level="REPEATABLE READ", readonly=True)
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_export_snapshot()")
                snapshot = cursor.fetchone()[0]
            tables = counts(connection)
            subprocess.run(
                [
                    pg_tool("pg_dump"),
                    "--format=custom",
                    "--no-owner",
                    "--no-privileges",
                    "--snapshot",
                    snapshot,
                    "--file",
                    str(archive),
                ],
                env=connection_environment(dsn),
                check=True,
                capture_output=True,
            )
        manifest.write_text(
            json.dumps(
                {
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                    "table_counts": tables,
                },
                indent=2,
            )
        )
        print("Consistent private migration archive created:", archive.name)
        print(
            "Tables:",
            len(tables),
            "· tournaments:",
            tables.get("tournaments", 0),
            "· users:",
            tables.get("users", 0),
        )
    else:
        # No cleanup, drop, truncate or overwrite flag exists in this tool.
        load_dotenv(ROOT / ".local" / "cloud.env")
        dsn = os.environ["CLOUD_PG_DSN"]
        if dsn == os.environ.get("PG_DSN"):
            raise ValueError("Refusing to restore over the current source database")
        expected = json.loads(manifest.read_text())
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected["sha256"]:
            raise ValueError("Archive checksum does not match its manifest")
        with psycopg2.connect(dsn) as connection:
            if counts(connection):
                raise ValueError(
                    "Restore target must be completely empty; existing data is preserved"
                )
        subprocess.run(
            [
                pg_tool("pg_restore"),
                "--dbname",
                unquote(urlsplit(dsn).path.lstrip("/")),
                "--no-owner",
                "--no-privileges",
                "--single-transaction",
                "--exit-on-error",
                str(archive),
            ],
            env=connection_environment(dsn),
            check=True,
            capture_output=True,
        )
        with psycopg2.connect(dsn) as connection:
            if counts(connection) != expected["table_counts"]:
                raise RuntimeError(
                    "Restored row counts differ; do not switch public traffic"
                )
        print("Restore verified: every table row count matches the migration snapshot")


if __name__ == "__main__":
    try:
        main()
    except (psycopg2.Error, subprocess.CalledProcessError):
        # Provider errors can contain connection details. Do not expose them to logs.
        raise SystemExit(
            "Database operation failed; credentials and provider output suppressed"
        ) from None
