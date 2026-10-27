import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantCtx
from app.models import Tenant

router = APIRouter(tags=["tenant"])


class TenantDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    timezone: str  # IANA name; times are UTC instants and this is how a client shows them
    modules: list[str]


@router.get("/tenant")
async def get_tenant(
    ctx: TenantCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> TenantDetail:
    """The studio named by `X-Tenant-Id`, with its timezone and the optional modules it has switched on. Any member.

    Studio-level facts live here and the user's own data lives in `/me`. The studio comes from the
    verified membership, so there is no id in the path to get wrong.
    """
    row = await session.scalar(select(Tenant).where(Tenant.id == ctx.tenant_id))
    return TenantDetail.model_validate(row)
