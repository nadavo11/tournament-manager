# Managed free weekend hosting — live

Deployed and verified on October 21, 2026 (Asia/Jerusalem): frontend https://nadavo11.github.io/streetball4biber/ and backend https://streetball4biber.onrender.com. Both Render resources show **Free**. The database dashboard reports expiration on **November 19, 2026**. No paid resources were selected.

All 20 table counts matched the consistent migration snapshot. The three existing tournaments and seven users were preserved. All three admin accounts passed browser login on the published Pages site. The basketball concurrency/idempotency/player-stat/undo/viewer/mobile test and diagram/standings synchronization test passed against Render with the local Python server, PostgreSQL and cloudflared all stopped. Disposable test tournaments were removed. Evidence: `e2e/evidence/managed-hosting-proof.json`, `basketball-proof.json`, `streetball4biber-proof.json`, and `render-live-scoreboard.png`. The container build and cloud startup are now verified. These are functional multi-device checks, not a large-event capacity benchmark.

An independent GitHub-hosted client also verified the named Pages frontend, its Render API configuration, actual tournament data/standings, and downloadable source: [successful external check](https://github.com/nadavo11/tournament-manager/actions/runs/39499981278).

The PC/tunnel deployment is a temporary demo and is unsuitable as the tournament's production host. Do not describe it as tournament-ready. This configuration preserves the existing FastAPI/Bracket engine, PostgreSQL schema, users, passwords, rosters, tournaments and scoring logic.

## Free weekend deployment

The owner requires a free tier and clarified that the app is needed only for the weekend. `render.yaml` now explicitly selects **Free** for both the web service and PostgreSQL, in Frankfurt. It needs one Render account. There are no paid resources in this Blueprint. Keep a free workspace and do not add a payment method or accept a paid upgrade without new explicit authorization.

Render's free backend sleeps after 15 minutes without incoming traffic and takes about a minute to wake. Normal live-view polling generates incoming requests while participants actually use the app; do not add artificial keep-alive traffic. Open and verify the site before the first game and after long breaks. PostgreSQL has 1 GB of persistent storage and expires 30 days after creation. Export the final database/results immediately after the weekend. Free PostgreSQL has no provider-managed recovery backups; use explicit logical exports. Free-tier usage quotas can suspend service, so review the account's remaining hours/bandwidth and test representative concurrent use before the event. Render explicitly does not recommend its free tier for production; this is a limited-duration, best-effort choice under the owner's $0 constraint, not a reliability guarantee.

The existing Render Blueprint is `streetball4biber-weekend`; do not provision a duplicate. Use the existing free service/database for subsequent work. Account credentials and migration connection details remain private under `.local`; never commit them or request passwords in chat. The steps below document the completed cutover and future recovery procedure.

## Prepared deployment

- Source: `https://github.com/nadavo11/tournament-manager`, branch `codex/live-tournament`.
- Blueprint: `render.yaml`; container: `Dockerfile.cloud`.
- The app serves its frontend and API from the managed host; the existing GitHub Pages frontend can also point to that stable API origin.
- The container binds to `0.0.0.0` and the provider's `PORT`. It includes the corresponding AGPL source archive.
- Render injects the internal database connection and a generated JWT secret. No local environment files or PC tunnels are used. Existing passwords migrate with database hashes; existing sessions will need a fresh login.
- Health check `/health/ready` queries PostgreSQL. Auto-deploy is disabled to avoid unplanned releases during a tournament.
- The entrypoint check deliberately refuses to launch against an empty database or one missing tournaments 1/8 and the three admin accounts. It runs at startup because the free tier does not support a separate pre-deploy command. Restore first, then deploy. Do not bootstrap an unrelated empty demo and switch traffic to it.

## Migration and verification sequence

1. Sign in to Render, connect GitHub and review the Blueprint: both resources must say **Free / $0**. Provision only free resources. The first app deployment is expected to stop at startup preflight until data is restored. Keep public traffic on the existing site until verification passes. If signup requests a paid plan, card, or an unavailable free database, pause and report that actual blocker instead of accepting charges.
2. Agree a brief scoring freeze for cutover. Stop writes to the old backend, then export a new consistent snapshot. The prepared archive is a rehearsal and must be refreshed if scores have changed.
3. Run `backend/.venv/Scripts/python.exe tools/cloud_database.py export --archive .local/backups/NEW-UNIQUE-NAME.dump`. The source connection comes from private `.local/runtime.env`. The export and row-count manifest share the same PostgreSQL transaction snapshot. The private archive contains password hashes and must not be committed or uploaded to a public repository.
4. Temporarily allow only the migration operator's public IP in the managed database firewall. Obtain its external TLS database URL through the provider's secure environment workflow; set `CLOUD_PG_DSN` in the process environment or ignored `.local/cloud.env`.
5. Restore with `backend/.venv/Scripts/python.exe tools/cloud_database.py restore --archive .local/backups/NEW-UNIQUE-NAME.dump`. The target must be completely empty. The tool verifies the checksum, restores in a single transaction, and compares every table count. It has no destructive overwrite option. Remove temporary external database access afterwards; `ipAllowList: []` retains private-network-only access.
6. Deploy the app. Preflight checks migrated records; startup applies pending migrations. Confirm database-backed readiness and corresponding source download.
7. Verify all three administrators, two independent scorekeepers, read-only viewer permissions, concurrent scoring, player stats, undo, conflict handling and standings through the managed URL. Use isolated test tournaments and remove only those fixtures.
8. Update the GitHub Pages API origin to the verified stable managed URL and publish. Keep the existing `streetball4biber` share URL. Test the published site and then stop the PC backend/tunnel. Repeat login and live synchronization from an external client with those PC services stopped. This is the required proof that the migration removes the PC dependency.
9. Make a fresh logical backup, verify its restore, and run a representative multi-device load test before the event. Record the actual managed URL, database expiration date and test results here. Export the completed tournament immediately after the weekend, well before the 30-day database expiration. An export file may be kept on a personal computer without making the live app depend on that computer.

Do not reopen writes on both databases after cutover: that would split scores across two sources. A rollback after new cloud writes requires exporting those writes; switching the frontend back to the old snapshot would lose them.

## Checks performed before account access

The migration rehearsal exported a consistent database snapshot, restored it into a separate temporary database, verified all 20 table row counts, and confirmed a second restore is refused without changing existing data. The temporary test database was removed. The source database and existing tournaments were retained. Private evidence is in `.local/backups/cloud-migration-verification.json`. Cloud configuration and existing scoring/ranking tests pass locally. The container was subsequently built and deployed successfully by Render. A fresh cloud database export was saved privately after cloud tests and test-fixture cleanup. Temporary external database migration access was removed; the API continues to reach PostgreSQL through Render's private network.

Provider references: [Blueprint fields](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks), [paid database recovery](https://render.com/docs/postgresql-backups), [pricing](https://render.com/pricing).
