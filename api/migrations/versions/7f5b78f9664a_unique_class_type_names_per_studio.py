"""unique class type names per studio

Revision ID: 7f5b78f9664a
Revises: 693e407aada5
Create Date: 2026-10-21 18:40:14.225495

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7f5b78f9664a"
down_revision: Union[str, Sequence[str], None] = "693e407aada5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ponytail: fails if a studio already has two names that differ only by case; rename those first.
    op.create_index(
        "uq_class_types_tenant_id_lower_name",
        "class_types",
        ["tenant_id", sa.literal_column("lower(name)")],
        unique=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_class_types_tenant_id_lower_name", table_name="class_types")
