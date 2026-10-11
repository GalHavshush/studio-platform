"""baseline

Revision ID: 303649b12d35
Revises: 
Create Date: 2026-10-11 17:00:49.946423

"""
from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = '303649b12d35'
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""


def downgrade() -> None:
    """Downgrade schema."""
