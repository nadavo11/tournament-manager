# Streetball4Biber tournament manager

A functional multi-user scoring workspace built on [evroon/bracket](https://github.com/evroon/bracket), retaining its AGPL-3.0 license and attribution. The original frontend and backend remain in this repository. `backend/live-ui` is a focused mobile organizer interface served by the original FastAPI application.

## Current demonstration

The app now runs on Render's free backend and PostgreSQL, verified on October 21, 2026. The PC backend, PostgreSQL and tunnel are stopped. Migration preserved all users and tournaments; browser login, concurrent scoring, player stats, undo, diagrams and live viewer updates passed against cloud hosting. See [CLOUD-DEPLOYMENT.md](CLOUD-DEPLOYMENT.md). No paid resources are configured. The free database expires on November 19, 2026; export final results after the weekend.

Public frontend: https://nadavo11.github.io/streetball4biber/

Source: https://github.com/nadavo11/tournament-manager/tree/codex/live-tournament

The named frontend is published with GitHub Pages (https://github.com/nadavo11/streetball4biber) and uses https://streetball4biber.onrender.com for its authenticated FastAPI service and Render PostgreSQL database. The API origin is recorded in private `.local/managed-api-url.txt` and published in `site-config.js`; it contains no credentials. The user's computer can be switched off. Both resources are free tiers for the weekend: the backend sleeps on inactivity and the database expires after 30 days. Free-tier quota and availability limits apply; no uptime guarantee is claimed.

Credentials are randomly generated, uncommitted, and stored only in the access-restricted `.local/demo-accounts.json` on the host. The original identities Administrator, Scorekeeper A, and Scorekeeper B remain available. Additional organizer usernames were added at the user’s request; their credentials also remain private in the same local file. The fourth identity is the unauthenticated public read-only viewer. The bootstrap account also has a random password and no club access; upstream default credentials are not accepted. Registration and temporary demo-account creation are disabled.

## Three-phone demonstration

1. Open the public URL on all three phones. Sign into phone 1 as Scorekeeper A, phone 2 as Scorekeeper B, and leave phone 3 signed out as Viewer. An optional fourth device signs in as Administrator.
2. Open Matches on phones 1 and 2; leave Groups or Standings visible on phone 3.
3. On phone 1, edit a pending match, enter scores, select COMPLETED, and save. The other phones update automatically within about two seconds plus network latency.
4. On phone 2, enter a different match while phone 1 enters another result. All devices share the same database.
5. Open the same match's editor on both scoring phones. Save on phone 1, then save the older editor on phone 2. The second write shows a conflict and offers Load latest score.
6. Reload: scores and accounts persist. The viewer has no score controls and cannot submit a score to the backend.
7. Administrator can use Reset demonstration to restore sample scores, or run `python tools/reset_demo.py --url PUBLIC_URL` locally.

## Workflow

The initial tournament contains 16 fictional teams, 4 groups, 24 group fixtures, 8 completed matches, 4 in progress, and 12 pending. Top 2 qualify. Seven knockout fixtures are pre-created with group qualification placeholders (A1, B2, etc.). After all group matches are complete, the organizer resolves those placeholders to the final qualifying teams. This prevents provisional standings from being treated as final qualifiers.

Organizer → New tournament supports bulk team entry, group count, qualification count, random distribution or entry order, reshuffling before any group match starts, and configurable win/draw points. Group sizes differ by at most one. The total qualifiers must be 4, 8, 16, or 32. Four groups with two qualifiers seed A1–B2, C1–D2, B1–A2, D1–C2, keeping group rematches out of the semifinals. Other sizes use the documented rank-major mirrored seed order in `live.py`.

Standings count completed results only: points, goal difference, goals scored, then stable input ID. Display includes played, wins, draws, losses, goals for/against, goal difference, and points. The fallback is deterministic, rather than an unrecorded random draw. A tied knockout result requires an explicit penalty/overtime winner. Score corrections update winners until a downstream match starts; afterwards the backend rejects corrections that could invalidate played rounds. Group scores lock after knockout generation. Reset restores sample group scores and rebuilds the unqualified knockout bracket.

## Architecture and upstream inspection

Reused: password hashing and `/api/token` JWT authentication; separate user records; `users_x_clubs` ownership/collaboration; PostgreSQL tables; stage/item/input/round models; `build_matches_for_stage_item` for round robin and elimination; ranking calculation; and `update_inputs_in_subsequent_elimination_rounds` for advancing winners. No duplicate fixture or bracket engine was introduced.

Upstream membership only checks club access, so collaborators originally had organizer-level mutation access. The adapter checks OWNER vs COLLABORATOR for every live write. A guard also protects legacy mutation routes: collaborators cannot use them, and owners cannot bypass live revisions for managed tournaments. Public snapshot endpoints expose only public tournaments; all score writes require an authenticated membership.

Added: versioned match updates, explicit PENDING/LIVE/COMPLETED state, penalty/overtime winner, immutable score-change audit records, stable goals-based ranking tiebreaks, mobile UI with Hebrew labels/RTL switch, organizer setup/invitation/reset, migration and schema metadata, seed command, Docker deployment configuration, and automated browser evidence. PostgreSQL row locks serialize each tournament's derived changes in one transaction. A stale `live_version` returns HTTP 409; an unchanged two-second poll returns a small revision response. Snapshot reads use repeatable-read transactions. SQL aggregation now explicitly orders matches, rounds, stage items and input slots for consistent fixture generation and display. The timestamp decoder also preserves fractional seconds and timezone offsets, keeping audit times correct on the Jerusalem host.

## Runtime and persistence

The running service uses Python 3.13, the upstream locked dependencies plus Windows timezone data, FastAPI/Uvicorn on 127.0.0.1:8400, and PostgreSQL 17 on 127.0.0.1:55432. PostgreSQL data lives in `../.runtime/pgdata`, outside the source checkout. Runtime secrets are in `.local/runtime.env`; never commit them or copy them into public reports. PostgreSQL uses SCRAM password authentication. The `.local` directory is restricted to the current Windows user. The public endpoint provides `/source.zip`, containing corresponding source without secrets, database data, or dependencies.

`./start-live.ps1` now reports the managed backend without restarting PC hosting or changing the public API origin. `-LocalOnly` explicitly starts local development services while preserving the public cloud configuration. The publisher prefers `.local/managed-api-url.txt`, preventing an obsolete tunnel from replacing the cloud API. No local startup task is needed for the tournament.

For another machine, create a private `.local/runtime.env` containing random `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PG_DSN`, `ENVIRONMENT=PRODUCTION`, `API_PREFIX=/api`, `SERVE_FRONTEND=false`, `ALLOW_USER_REGISTRATION=false`, `ALLOW_DEMO_USER_REGISTRATION=false`, and the HTTPS `CORS_ORIGINS`. Install Python 3.13 and uv, then `cd backend; uv sync --locked --no-dev`, create `static`, and start `uv run uvicorn bracket.app:app --host 127.0.0.1 --port 8400`. Empty databases initialize from schema metadata and stamp Alembic head; existing databases apply `live_scoring_v1`. Run `uv run python seed_live.py` once. Production should use a stable HTTPS reverse proxy and a backed-up database.

Optional Docker path: `python tools/package_source.py`, set a random `POSTGRES_PASSWORD` in the shell, provide `.local/runtime.env`, then `docker compose -f compose.live.yml up -d --build`. The app and PostgreSQL run as two services; the database uses a named persistent volume and has no public port. Seed with `docker compose -f compose.live.yml exec app uv run python seed_live.py`; credentials are written to `/app/.local/demo-accounts.json` inside the app container. Docker is not installed on the demo host, so the Docker build is supplied but unverified. The live native deployment is the verified path.

## Verification and limitations

Run from `e2e`: `npm ci`, `npx playwright install chromium`, then set `DEMO_URL` and run `npx playwright test`. Node 20+ is required. Credentials are read locally from `.local/demo-accounts.json`, never embedded in test source. The tests use four isolated browser contexts with real UI logins, simultaneous scoring, an independent standings oracle, backend permission bypass attempts, stale editors, a true concurrent version race, reload persistence, mobile overflow checking, and Hebrew RTL. A second test drives the complete group → quarterfinal → semifinal → final flow and reset. The public viewer context records a WebM video; screenshots and JSON evidence are in `e2e/evidence`. Do not publish authentication traces or credential files.

`public-demo-proof.yml` independently fetches the deployed app, database-backed tournament snapshot, and corresponding source from a GitHub-hosted Ubuntu runner. Its successful run is required before claiming external reachability.

Known limitations: free Render inactivity wake-up, monthly quotas and database expiration; two-second polling instead of push; Hebrew translation covers navigation and key scoring labels but some supporting text remains English; no email invitation or password recovery service; no arbitrary ranking-rule editor or head-to-head tiebreak; groups cannot be reseeded after play without clearing results. The Docker image was built and deployed by Render. Group/knockout correction locks deliberately require later results to be cleared or the tournament reset before changing already-progressed data.


## Streetball4Biber frontend update

The interface now uses a red dark palette, native dark form controls, and Streetball4Biber branding. The Diagram tab is built from the actual stages, standings, and `winner_from_match_id` relationships: groups → quarterfinals → semifinals → final → champion. It includes fit/100% controls, horizontal scrolling, live standings and score updates, Hebrew/RTL labels, and match edit links for authorized users. It does not calculate an independent bracket.

The same frontend runs directly from FastAPI or from the named Pages address. Same-origin mode uses `site-config.js` with an empty API origin. `python tools/publish_frontend.py` publishes the frontend files, license, attribution and a public API origin to the separate `streetball4biber` repository. No credentials are included. Set `CORS_ORIGIN_REGEX=^https://nadavo11[.]github[.]io$` in the private runtime environment to allow the named frontend. Authentication still uses independent JWT sessions and all permissions remain enforced in FastAPI.

The former Quick Tunnel workflow has been superseded by Render. The shareable Pages URL remains unchanged and its backend no longer depends on the local computer. `start-live.ps1` and the publisher preserve the managed API origin; no tunnel renewal is needed.

Run the named-site UI and synchronization check from `e2e` with `npx playwright test diagram.spec.cjs`. It creates an isolated verification tournament, verifies the additional administrator, dark theme, real diagram edges, mobile/RTL controls and a score write reflected in another viewer’s diagram without navigation. It does not reset the main demonstration tournament. Evidence is saved in `e2e/evidence/streetball4biber-proof.json`.

## Basketball Live Court

Open **Live Court** or a match's Live Court button. Share `?t=TOURNAMENT_ID&view=live&match=MATCH_ID` to open a particular scoreboard directly. Signed-out visitors see the same live score, clock, play log and optional player dashboards without mutation controls.

**Quick score** is the default: large team buttons for two points, three points, and a one-point free throw; team fouls, timeouts, possession, undo and an optional shared clock. **Game setup** before the first play supports conventional 2/3 scoring or streetball 1/2 scoring, with free throws worth one point in both. Configure one period, two halves or four quarters and their duration. A timeout pauses the clock. Scorekeepers explicitly control clock start/pause, remaining time, periods and finishing the game; no automatic win-at-21, bonus free throws or rule-specific penalties are assumed.

**Player stats** is optional. An organizer adds names and optional jersey numbers to the actual team roster. Select a player, then tap a made/missed shot, free throw, offensive/defensive rebound, assist, steal, block, turnover, personal/technical/unsportsmanlike foul, violation or substitution. Made shots update the team score and player points together. Each player shows points, rebounds, assists, fouls, shooting makes/attempts, steals, blocks and turnovers. Unassigned and pre-existing team points stay explicitly separate; the app does not invent historical attempts, minutes or plus/minus. Substitutions record on/off status; a shot clock is not included. Undo reverses the event's score and statistics and retains its author and undo record. Undoing a timeout does not automatically restart the clock.

The workflow follows the simple input pattern praised by users of [Easy Stats](https://apps.apple.com/us/app/easy-stats-for-basketball/id561687907) and the separate basic/full-stat workflows in [GameChanger](https://help.gc.com/hc/en-us/articles/48017461762445-Cover-Your-Way-Basketball). This is an original implementation integrated with the existing match, roster and ranking tables.

The basketball migration adds a persisted game clock, jersey metadata and an append-only play log (undo marks an event and adds an audit entry). Every relative scoring event has a client UUID. Tournament row locks serialize concurrent events and the original score/standings/progression engine commits in the same transaction. Replaying an identical UUID returns success without counting again; changed content under the same UUID returns a conflict. Controls and undo require a current match version; point events can commute across scorekeepers. The UI keeps unconfirmed actions in the tab's session storage and retries a lost response with the same UUID. It shows errors and offers explicit retry/discard; it never silently assumes an unsaved score succeeded. Player/team membership is checked by the server. The legacy absolute score editor rejects score changes once a play log exists, directing corrections through undo or explicit team adjustments.

The clock is calculated from a persisted remaining time and server timestamp, so viewers stay synchronized and a server restart does not reset it. An expired clock cannot be restarted until time is set or the next period is chosen. Existing tournament progression guards still apply: group results lock after qualification and a played downstream knockout round prevents earlier corrections. Reset clears the basketball log/clock with the original tournament reset and retains rosters.

Validation: from `backend`, run `.venv/Scripts/python.exe -m pytest tests/unit_tests/basketball_test.py tests/unit_tests/datetime_codec_test.py tests/unit_tests/ranking_calculation_test.py -q`. From `e2e`, run `npx playwright test basketball.spec.cjs --reporter=list` (requires Node 20+); set `FRONTEND_URL=https://nadavo11.github.io/streetball4biber/` to exercise the published site. This creates isolated, explicitly named test tournaments, recorded in the private `.local/basketball-test-tournaments.json`. It verifies concurrent scorekeepers, idempotency after a lost response, permissions, player attribution, undo, clock expiry, final/reopen, streetball scoring, viewer polling and phone layouts. Evidence is in `e2e/evidence/basketball-proof.json` and the corresponding screenshots.
