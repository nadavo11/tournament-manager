"""Create an isolated demo club and random credentials. Never prints passwords."""

import asyncio
import json
import secrets
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".local" / "runtime.env")

from bracket.database import database
from bracket.live import Setup, build_tournament, seed_scores
from bracket.sql.users import create_user, get_user
from bracket.models.db.user import UserInsertable
from bracket.models.db.account import UserAccountType
from bracket.utils.security import hash_password
from heliclockter import datetime_utc


async def main():
    await database.connect()
    try:
        existing = await database.fetch_val("SELECT id FROM live_tournaments LIMIT 1")
        if existing:
            print(f"Demo already exists: {existing}; use the organizer reset button")
            return
        async with database.transaction():
            club = await database.fetch_val(
                "INSERT INTO clubs(name) VALUES('Community Sports Club') RETURNING id"
            )
            credentials = {}
            for key, name, role in [
                ("admin", "Administrator", "OWNER"),
                ("scorekeeper-a", "Scorekeeper A", "COLLABORATOR"),
                ("scorekeeper-b", "Scorekeeper B", "COLLABORATOR"),
            ]:
                email = f"{key}@tournament.demo"
                password = secrets.token_urlsafe(18)
                u = await create_user(
                    UserInsertable(
                        email=email,
                        name=name,
                        password_hash=hash_password(password),
                        created=datetime_utc.now(),
                        account_type=UserAccountType.REGULAR,
                    )
                )
                await database.execute(
                    "INSERT INTO users_x_clubs(user_id,club_id,relation) VALUES(:u,:c,:r)",
                    {"u": u.id, "c": club, "r": role},
                )
                credentials[key] = {"email": email, "password": password}
            tid = await build_tournament(
                Setup(
                    name="Community Cup 2026",
                    teams=[
                        "Harbor Hawks",
                        "Desert Foxes",
                        "Carmel Wolves",
                        "Galilee Stars",
                        "Coastal Lions",
                        "Negev Falcons",
                        "Jaffa Waves",
                        "Golan Eagles",
                        "Valley Panthers",
                        "Cedar Bears",
                        "Sunset United",
                        "Orchard Rovers",
                        "Coral Tigers",
                        "Summit FC",
                        "River Otters",
                        "Olive Athletic",
                    ],
                    groups=4,
                    qualify=2,
                    shuffle=False,
                ),
                club,
            )
            await seed_scores(tid)
        credentials["viewer"] = {
            "instructions": "Open the public URL without signing in. Read-only access."
        }
        target = Path(os.getenv("DEMO_PRIVATE_DIR", "../.local")) / "demo-accounts.json"
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(credentials, indent=2))
        print(
            f"Seeded tournament {tid}: 16 teams, 4 groups, 24 matches. Private credentials: {target.resolve()}"
        )
    finally:
        await database.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
