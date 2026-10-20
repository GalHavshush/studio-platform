"""same studio foreign keys

Revision ID: bbecd308a635
Revises: c0f26fe1c347
Create Date: 2026-10-20 21:45:38.775460

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bbecd308a635'
down_revision: Union[str, Sequence[str], None] = 'c0f26fe1c347'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Redundant with each primary key, but a composite foreign key needs a unique target.
    op.create_unique_constraint('uq_class_types_tenant_id_id', 'class_types', ['tenant_id', 'id'])
    op.create_unique_constraint('uq_class_sessions_tenant_id_id', 'class_sessions', ['tenant_id', 'id'])
    op.create_unique_constraint('uq_participants_tenant_id_id', 'participants', ['tenant_id', 'id'])

    # A session's class type must be in the session's studio. Creating this fails (and the whole
    # migration rolls back) if a row already crosses studios: bad data is reported, not hidden.
    op.drop_constraint('class_sessions_class_type_id_fkey', 'class_sessions', type_='foreignkey')
    op.create_foreign_key(
        'fk_class_sessions_class_type_same_tenant',
        'class_sessions', 'class_types',
        ['tenant_id', 'class_type_id'], ['tenant_id', 'id'],
    )

    # rsvps gets its own tenant_id: add it empty, fill it from the session, then require it.
    op.add_column('rsvps', sa.Column('tenant_id', sa.Uuid(), nullable=True))
    op.execute(
        "UPDATE rsvps SET tenant_id = class_sessions.tenant_id"
        " FROM class_sessions WHERE class_sessions.id = rsvps.session_id"
    )
    op.alter_column('rsvps', 'tenant_id', nullable=False)
    op.drop_constraint('rsvps_session_id_fkey', 'rsvps', type_='foreignkey')
    op.drop_constraint('rsvps_participant_id_fkey', 'rsvps', type_='foreignkey')
    op.create_foreign_key(
        'fk_rsvps_session_same_tenant',
        'rsvps', 'class_sessions',
        ['tenant_id', 'session_id'], ['tenant_id', 'id'],
    )
    op.create_foreign_key(
        'fk_rsvps_participant_same_tenant',
        'rsvps', 'participants',
        ['tenant_id', 'participant_id'], ['tenant_id', 'id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_rsvps_participant_same_tenant', 'rsvps', type_='foreignkey')
    op.drop_constraint('fk_rsvps_session_same_tenant', 'rsvps', type_='foreignkey')
    op.create_foreign_key('rsvps_participant_id_fkey', 'rsvps', 'participants', ['participant_id'], ['id'])
    op.create_foreign_key('rsvps_session_id_fkey', 'rsvps', 'class_sessions', ['session_id'], ['id'])
    op.drop_column('rsvps', 'tenant_id')

    op.drop_constraint('fk_class_sessions_class_type_same_tenant', 'class_sessions', type_='foreignkey')
    op.create_foreign_key(
        'class_sessions_class_type_id_fkey', 'class_sessions', 'class_types', ['class_type_id'], ['id']
    )

    op.drop_constraint('uq_participants_tenant_id_id', 'participants', type_='unique')
    op.drop_constraint('uq_class_sessions_tenant_id_id', 'class_sessions', type_='unique')
    op.drop_constraint('uq_class_types_tenant_id_id', 'class_types', type_='unique')
