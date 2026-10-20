"""Shared basketball game controls, roster numbers, and idempotent play log."""

from alembic import op
from bracket.schema import basketball_games, basketball_jerseys, basketball_events

revision = "basketball_v1"
down_revision = "live_scoring_v1"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    for table in (basketball_games, basketball_jerseys, basketball_events):
        table.create(bind)


def downgrade():
    for name in ("basketball_events", "basketball_jerseys", "basketball_games"):
        op.drop_table(name)
