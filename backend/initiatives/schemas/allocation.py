"""Request models for committing people to initiatives."""

from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, model_validator


class AllocationCreate(BaseModel):
    """
    Payload for committing an employee to an initiative.

    Commitment is a percentage of the employee's week, never a task list. The
    database enforces that the sum across overlapping allocations never exceeds
    100% - this model only checks what is knowable from a single request.
    """

    employee_id: int
    allocation_percent: Annotated[Decimal, Field(gt=0, le=100)]
    start_date: date
    end_date: date | None = None
    role_on_initiative: Annotated[str, Field(max_length=100)] | None = None

    @model_validator(mode="after")
    def check_date_order(self) -> "AllocationCreate":
        """
        Rejects an end date that precedes the start date.

        Returns:
            AllocationCreate: The validated model.

        Raises:
            ValueError: If end_date precedes start_date.
        """
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must not precede start_date")
        return self


class AllocationUpdate(BaseModel):
    """
    Payload for changing an existing commitment.

    The employee is not editable - moving a commitment to a different person is
    a removal plus an addition, and treating it as an edit would hide that two
    people's capacity changed.

    end_date uses a sentinel-free convention: omit it to leave it alone, send
    null to make the allocation open ended.
    """

    allocation_percent: Annotated[Decimal, Field(gt=0, le=100)] | None = None
    start_date: date | None = None
    end_date: date | None = None
    role_on_initiative: Annotated[str, Field(max_length=100)] | None = None
