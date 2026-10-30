"""Weekly class series: the rule only (this class, this coach, every Tuesday at 18:00). Generating
the sessions from it is a later step. Only owners create them; a coach can read the ones they teach."""

import uuid
from datetime import date, time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, PositiveInt, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.class_types import OwnerCtx
from app.db import get_session
from app.models import ClassSeries
from app.sessions import CoachCtx, check_class_and_coach

router = APIRouter(prefix="/series", tags=["series"])


class SeriesIn(BaseModel):
    class_type_id: uuid.UUID
    # Omitted = the caller teaches it.
    coach_id: uuid.UUID | None = None
    weekday: Annotated[int, Field(ge=0, le=6)]  # 0 = Monday ... 6 = Sunday
    # The studio's wall clock: an offset is refused (422), as a missing one is for a session's times.
    start_time: time
    duration_minutes: PositiveInt
    # Omitted = unlimited.
    capacity: PositiveInt | None = None
    first_date: date
    # Omitted = no end.
    last_date: date | None = None

    @field_validator("start_time")
    @classmethod
    def no_offset(cls, value: time) -> time:
        if value.tzinfo is not None:
            raise ValueError("start_time is the studio's wall clock: no offset")
        return value

    @model_validator(mode="after")
    def last_not_before_first(self) -> "SeriesIn":
        if self.last_date is not None and self.last_date < self.first_date:
            raise ValueError("last_date must not be before first_date")
        return self


class SeriesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_type_id: uuid.UUID
    coach_id: uuid.UUID
    weekday: int
    start_time: time
    duration_minutes: int
    capacity: int | None
    first_date: date
    last_date: date | None


@router.post("", status_code=201)
async def create_series(
    body: SeriesIn, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SeriesOut:
    """Create a series in the studio named by `X-Tenant-Id`. Owner only (`403 insufficient_role`).

    The class type and coach follow the rules of `POST /sessions`. `first_date` must fall on
    `weekday` (`422 first_date_not_on_weekday`).
    """
    coach_id = await check_class_and_coach(session, ctx, body.class_type_id, body.coach_id)
    if body.first_date.weekday() != body.weekday:
        raise HTTPException(status_code=422, detail="first_date_not_on_weekday")

    row = ClassSeries(
        tenant_id=ctx.tenant_id,
        coach_id=coach_id,
        **body.model_dump(exclude={"coach_id"}),
    )
    session.add(row)
    await session.flush()
    created = SeriesOut.model_validate(row)  # read before commit, which expires `row`
    await session.commit()
    return created


@router.get("")
async def list_series(
    ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[SeriesOut]:
    """The studio's series: an owner sees all of them, a coach only their own."""
    query = select(ClassSeries).where(ClassSeries.tenant_id == ctx.tenant_id)
    if ctx.role == "coach":
        query = query.where(ClassSeries.coach_id == ctx.user.id)
    rows = await session.scalars(
        query.order_by(ClassSeries.weekday, ClassSeries.start_time, ClassSeries.id)
    )
    return [SeriesOut.model_validate(row) for row in rows]


@router.get("/{series_id}")
async def get_series_by_id(
    series_id: uuid.UUID, ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SeriesOut:
    """One series: 404 if it is not in this studio, 403 `not_your_series` if a coach (not an
    owner) is not its coach."""
    row = await session.scalar(
        select(ClassSeries).where(
            ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    if ctx.role == "coach" and row.coach_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="not_your_series")
    return SeriesOut.model_validate(row)
