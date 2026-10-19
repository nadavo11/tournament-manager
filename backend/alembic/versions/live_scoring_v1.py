"""Transactional live scoring metadata, revisions, and audit trail."""

from alembic import op
import sqlalchemy as sa

revision = "live_scoring_v1"
down_revision = "c1ab44651e79"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "matches", sa.Column("live_status", sa.String(), nullable=False, server_default="COMPLETED")
    )
    op.add_column(
        "matches", sa.Column("live_version", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("matches", sa.Column("tiebreak_winner", sa.Integer(), nullable=True))
    op.create_table(
        "live_tournaments",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.ForeignKey("tournaments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("qualify", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("knockout_started", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_table(
        "live_audit",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "tournament_id",
            sa.BigInteger(),
            sa.ForeignKey("tournaments.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("match_id", sa.BigInteger(), nullable=True),
        sa.Column("actor", sa.String(), nullable=False),
        sa.Column("before", sa.Text(), nullable=False),
        sa.Column("after", sa.Text(), nullable=False),
        sa.Column(
            "created", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade():
    op.drop_table("live_audit")
    op.drop_table("live_tournaments")
    for c in ("tiebreak_winner", "live_version", "live_status"):
        op.drop_column("matches", c)
