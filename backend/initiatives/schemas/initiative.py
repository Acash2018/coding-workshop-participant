"""Request and response models for the initiative resource."""

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

InitiativeStatus = Literal["PROPOSED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]
RiskStatus = Literal["ON_TRACK", "AT_RISK", "OVERDUE", "CLOSED"]


class InitiativeCreate(BaseModel):
    """Payload for creating an initiative."""

    code: Annotated[str, Field(min_length=2, max_length=32)]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    department: Annotated[str, Field(min_length=1, max_length=100)]
    description: str | None = None
    status: InitiativeStatus = "PROPOSED"
    planned_start_date: date
    planned_end_date: date
    planned_budget: Annotated[Decimal, Field(ge=0)] = Decimal("0")
    owner_employee_id: int | None = None

    @model_validator(mode="after")
    def check_date_order(self) -> "InitiativeCreate":
        """
        Rejects an end date that precedes the start date.

        Mirrors the initiatives_dates_ordered constraint so the caller gets a
        422 with a field-level message rather than a 409 from PostgreSQL.

        Returns:
            InitiativeCreate: The validated model.

        Raises:
            ValueError: If planned_end_date precedes planned_start_date.
        """
        if self.planned_end_date < self.planned_start_date:
            raise ValueError("planned_end_date must not precede planned_start_date")
        return self


class InitiativeUpdate(BaseModel):
    """Payload for a partial update. Omitted fields are left unchanged."""

    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    department: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    description: str | None = None
    status: InitiativeStatus | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    actual_end_date: date | None = None
    planned_budget: Annotated[Decimal, Field(ge=0)] | None = None
    owner_employee_id: int | None = None


class Initiative(BaseModel):
    """An initiative as stored."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    department: str
    description: str | None
    status: InitiativeStatus
    planned_start_date: date
    planned_end_date: date
    actual_end_date: date | None
    planned_budget: Decimal
    owner_employee_id: int | None


class InitiativeStatusRow(BaseModel):
    """A row from v_initiative_status - the portfolio dashboard projection."""

    id: int
    code: str
    name: str
    department: str
    status: InitiativeStatus
    planned_end_date: date
    days_remaining: int
    headcount: int
    fte_committed: Decimal
    milestone_count: int
    milestones_complete: int
    milestones_behind: int
    milestones_blocked: int
    percent_complete: Decimal
    planned_budget: Decimal
    total_consumed: Decimal
    percent_consumed: Decimal | None
    forecast_overrun: bool | None
    risk_status: RiskStatus
