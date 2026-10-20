# Managed hosting cutover — prepared, not deployed

The PC/tunnel deployment is a temporary demo and is unsuitable as the tournament's production host. Do not describe it as tournament-ready. This configuration preserves the existing FastAPI/Bracket engine, PostgreSQL schema, users, passwords, rosters, tournaments and scoring logic.

## Proposed resources and approval

`render.yaml` defines a paid always-on Starter web service and a paid small PostgreSQL instance in Frankfurt, with 1 GB database storage. Render provisions HTTPS, restarts unhealthy instances, and provides point-in-time recovery for paid PostgreSQL. The small configuration is approximately $13/month before storage, bandwidth overages and taxes; confirm the current checkout total before provisioning. It is a single-instance starting configuration, not a high-availability guarantee. Event capacity still requires a representative load test after deployment. Free services that sleep or have expiring databases are not the proposed event host.

The original request forbids introducing billing without approval. No cloud resources have been provisioned and no charges have been authorized. No Render credentials or authenticated deployment session are available in this workspace. Required next action: owner approval of hosting charges and access to the owner's Render account. Never ask for passwords or tokens in chat.

## Prepared deployment

- Source: `https://github.com/nadavo11/tournament-manager`, branch `codex/live-tournament`.
- Blueprint: `render.yaml`; container: `Dockerfile.cloud`.
- The app serves its frontend and API from the managed host; the existing GitHub Pages frontend can also point to that stable API origin.
- The container binds to `0.0.0.0` and the provider's `PORT`. It includes the corresponding AGPL source archive.
- Render injects the internal database connection and a generated JWT secret. No local environment files or PC tunnels are used. Existing passwords migrate with database hashes; existing sessions will need a fresh login.
- Health check `/health/ready` queries PostgreSQL. Auto-deploy is disabled to avoid unplanned releases during a tournament.
- The pre-deploy check deliberately refuses to launch against an empty database or one missing tournaments 1/8 and the three admin accounts. Restore first, then deploy. Do not bootstrap an unrelated empty demo and switch traffic to it.

## Migration and verification sequence

1. Approve the provider's actual price, connect its GitHub integration, and provision the Blueprint. The first app deployment is expected to stop at preflight until data is restored. Keep public traffic on the existing site until verification passes.
2. Agree a brief scoring freeze for cutover. Stop writes to the old backend, then export a new consistent snapshot. The prepared archive is a rehearsal and must be refreshed if scores have changed.
3. Run `backend/.venv/Scripts/python.exe tools/cloud_database.py export --archive .local/backups/NEW-UNIQUE-NAME.dump`. The source connection comes from private `.local/runtime.env`. The export and row-count manifest share the same PostgreSQL transaction snapshot. The private archive contains password hashes and must not be committed or uploaded to a public repository.
4. Temporarily allow only the migration operator's public IP in the managed database firewall. Obtain its external TLS database URL through the provider's secure environment workflow; set `CLOUD_PG_DSN` in the process environment or ignored `.local/cloud.env`.
5. Restore with `backend/.venv/Scripts/python.exe tools/cloud_database.py restore --archive .local/backups/NEW-UNIQUE-NAME.dump`. The target must be completely empty. The tool verifies the checksum, restores in a single transaction, and compares every table count. It has no destructive overwrite option. Remove temporary external database access afterwards; `ipAllowList: []` retains private-network-only access.
6. Deploy the app. Preflight checks migrated records; startup applies pending migrations. Confirm database-backed readiness and corresponding source download.
7. Verify all three administrators, two independent scorekeepers, read-only viewer permissions, concurrent scoring, player stats, undo, conflict handling and standings through the managed URL. Use isolated test tournaments and remove only those fixtures.
8. Update the GitHub Pages API origin to the verified stable managed URL and publish. Keep the existing `streetball4biber` share URL. Test the published site and then stop the PC backend/tunnel. Repeat login and live synchronization from an external client with those PC services stopped. This is the required proof that the migration removes the PC dependency.
9. Confirm provider backups/recovery window, make a fresh logical backup, rehearse recovery, and run a representative multi-device load test before calling the event deployment ready. Record the actual managed URL and test results here.

Do not reopen writes on both databases after cutover: that would split scores across two sources. A rollback after new cloud writes requires exporting those writes; switching the frontend back to the old snapshot would lose them.

## Checks performed before account access

The migration rehearsal exported a consistent database snapshot, restored it into a separate temporary database, verified all 20 table row counts, and confirmed a second restore is refused without changing existing data. The temporary test database was removed. The source database and existing tournaments were retained. Private evidence is in `.local/backups/cloud-migration-verification.json`. Cloud configuration and existing scoring/ranking tests pass locally. Docker is unavailable on this host, so an actual container build and cloud deployment remain unverified until provider access is supplied.

Provider references: [Blueprint fields](https://render.com/docs/blueprint-spec), [health checks](https://render.com/docs/health-checks), [paid database recovery](https://render.com/docs/postgresql-backups), [pricing](https://render.com/pricing).
