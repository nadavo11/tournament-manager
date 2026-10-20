# Streetball4Biber tournament manager

A functional multi-user scoring workspace built on [evroon/bracket](https://github.com/evroon/bracket), retaining its AGPL-3.0 license and attribution. The original frontend and backend remain in this repository. `backend/live-ui` is a focused mobile organizer interface served by the original FastAPI application.

## Current demonstration

Public frontend: https://nadavo11.github.io/streetball4biber/

Source: https://github.com/nadavo11/tournament-manager/tree/codex/live-tournament

The named frontend is published with GitHub Pages (https://github.com/nadavo11/streetball4biber) and uses the same authenticated FastAPI service and PostgreSQL data through a temporary Cloudflare Quick Tunnel to the current Windows host. The API origin is recorded privately in `.local/active-url.txt` and published in `site-config.js`; it contains no credentials. The computer, PostgreSQL, Python app, and cloudflared must remain running. Tunnel addresses can change on restart. There is no subscription or paid API; infrastructure costs are zero beyond the existing computer, electricity, and connection. It has no uptime guarantee and is not an unattended production hosting arrangement.

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

To restart this prepared Windows environment, run `./start-live.ps1`. If the public hostname returns NXDOMAIN or cloudflared logs “Tunnel not found” while still running, use `./start-live.ps1 -RenewTunnel`; this replaces only this app’s tunnel and issues a new public address. An expired Quick Tunnel address cannot be recovered by Windows DNS diagnostics. The current restored address is also saved privately in `.local/active-url.txt`. Logs: `.local/server.log`, `.local/server-error.log`, and `../.runtime/tunnel-error.log`. This script uses the already prepared binaries and data directory; it is not a fresh-machine installer. No startup task was installed.

For another machine, create a private `.local/runtime.env` containing random `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PG_DSN`, `ENVIRONMENT=PRODUCTION`, `API_PREFIX=/api`, `SERVE_FRONTEND=false`, `ALLOW_USER_REGISTRATION=false`, `ALLOW_DEMO_USER_REGISTRATION=false`, and the HTTPS `CORS_ORIGINS`. Install Python 3.13 and uv, then `cd backend; uv sync --locked --no-dev`, create `static`, and start `uv run uvicorn bracket.app:app --host 127.0.0.1 --port 8400`. Empty databases initialize from schema metadata and stamp Alembic head; existing databases apply `live_scoring_v1`. Run `uv run python seed_live.py` once. Production should use a stable HTTPS reverse proxy and a backed-up database.

Optional Docker path: `python tools/package_source.py`, set a random `POSTGRES_PASSWORD` in the shell, provide `.local/runtime.env`, then `docker compose -f compose.live.yml up -d --build`. The app and PostgreSQL run as two services; the database uses a named persistent volume and has no public port. Seed with `docker compose -f compose.live.yml exec app uv run python seed_live.py`; credentials are written to `/app/.local/demo-accounts.json` inside the app container. Docker is not installed on the demo host, so the Docker build is supplied but unverified. The live native deployment is the verified path.

## Verification and limitations

Run from `e2e`: `npm ci`, `npx playwright install chromium`, then set `DEMO_URL` and run `npx playwright test`. Node 20+ is required. Credentials are read locally from `.local/demo-accounts.json`, never embedded in test source. The tests use four isolated browser contexts with real UI logins, simultaneous scoring, an independent standings oracle, backend permission bypass attempts, stale editors, a true concurrent version race, reload persistence, mobile overflow checking, and Hebrew RTL. A second test drives the complete group → quarterfinal → semifinal → final flow and reset. The public viewer context records a WebM video; screenshots and JSON evidence are in `e2e/evidence`. Do not publish authentication traces or credential files.

`public-demo-proof.yml` independently fetches the deployed app, database-backed tournament snapshot, and corresponding source from a GitHub-hosted Ubuntu runner. Its successful run is required before claiming external reachability.

Known limitations: temporary host/tunnel lifecycle; two-second polling instead of push; Hebrew translation covers navigation and key scoring labels but some supporting text remains English; no email invitation or password recovery service; no arbitrary ranking-rule editor or head-to-head tiebreak; groups cannot be reseeded after play without clearing results; no Docker verification on this host. Group/knockout correction locks deliberately require later results to be cleared or the tournament reset before changing already-progressed data.


## Streetball4Biber frontend update

The interface now uses a red dark palette, native dark form controls, and Streetball4Biber branding. The Diagram tab is built from the actual stages, standings, and `winner_from_match_id` relationships: groups → quarterfinals → semifinals → final → champion. It includes fit/100% controls, horizontal scrolling, live standings and score updates, Hebrew/RTL labels, and match edit links for authorized users. It does not calculate an independent bracket.

The same frontend runs directly from FastAPI or from the named Pages address. Same-origin mode uses `site-config.js` with an empty API origin. `python tools/publish_frontend.py` publishes the frontend files, license, attribution and a public API origin to the separate `streetball4biber` repository. No credentials are included. Set `CORS_ORIGIN_REGEX=^https://nadavo11[.]github[.]io$` in the private runtime environment to allow the named frontend. Authentication still uses independent JWT sessions and all permissions remain enforced in FastAPI.

`start-live.ps1 -RenewTunnel` now records the replacement API origin and republishes the named frontend configuration automatically when the Pages checkout exists. The shareable Pages URL remains unchanged, although its backend still depends on the local machine, network and tunnel. Allow Pages deployment to complete and reload after renewing the tunnel. This is not permanent cloud hosting of the database or API.

Run the named-site UI and synchronization check from `e2e` with `npx playwright test diagram.spec.cjs`. It creates an isolated verification tournament, verifies the additional administrator, dark theme, real diagram edges, mobile/RTL controls and a score write reflected in another viewer’s diagram without navigation. It does not reset the main demonstration tournament. Evidence is saved in `e2e/evidence/streetball4biber-proof.json`.
