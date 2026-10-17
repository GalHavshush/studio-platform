"""add refresh_tokens family_id

Revision ID: 9130b525afe1
Revises: a4b00fe1d59a
Create Date: 2026-10-17 02:42:26.746944

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9130b525afe1'
down_revision: Union[str, Sequence[str], None] = 'a4b00fe1d59a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable first: existing rows need a value before the column can be NOT NULL.
    op.add_column('refresh_tokens', sa.Column('family_id', sa.Uuid(), nullable=True))
    # Backfill along each chain, so a token rotated into another stays in the same family.
    # (family_id = id would split every A -> B -> C chain into three separate families.)
    # The recursion starts at each chain's first token (nobody replaced it) and follows
    # replaced_by_id; every token takes its chain's first token's id as the family.
    op.execute("""
        WITH RECURSIVE chain(id, family) AS (
            SELECT r.id, r.id FROM refresh_tokens r
            WHERE NOT EXISTS (SELECT 1 FROM refresh_tokens p WHERE p.replaced_by_id = r.id)
          UNION ALL
            SELECT cur.replaced_by_id, chain.family
            FROM chain JOIN refresh_tokens cur ON cur.id = chain.id
            WHERE cur.replaced_by_id IS NOT NULL
        )
        UPDATE refresh_tokens t SET family_id = chain.family FROM chain WHERE t.id = chain.id
    """)
    op.alter_column('refresh_tokens', 'family_id', nullable=False)
    op.create_index(op.f('ix_refresh_tokens_family_id'), 'refresh_tokens', ['family_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_refresh_tokens_family_id'), table_name='refresh_tokens')
    op.drop_column('refresh_tokens', 'family_id')
