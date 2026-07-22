"""Request and response models for employees (resources)."""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field

EmploymentType = Literal["FULL_TIME", "PART_TIME", "CONTRACTOR"]

# Deliberately a pattern rather than pydantic's EmailStr, which needs the
# email-validator package. Every added dependency is another chance to repeat
# the wheel/ABI problems this service has already hit, and the column is citext
# UNIQUE - the database owns correctness here, this only catches typos early.
_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class EmployeeCreate(BaseModel):
    """
    Payload for adding a person to the resource pool.

    weekly_capacity_hours is what 100% allocation means for this person. A
    part-timer's full commitment is their own week, not everyone else's - the
    default of 40 is the standard full-time week described in the brief.
    """

    employee_number: Annotated[str, Field(min_length=1, max_length=32)]
    full_name: Annotated[str, Field(min_length=1, max_length=200)]
    email: Annotated[str, Field(pattern=_EMAIL_PATTERN, max_length=200)]
    department: Annotated[str, Field(min_length=1, max_length=100)]
    job_title: Annotated[str, Field(max_length=100)] | None = None
    employment_type: EmploymentType = "FULL_TIME"
    weekly_capacity_hours: Annotated[Decimal, Field(gt=0, le=60)] = Decimal("40")
    hourly_rate: Annotated[Decimal, Field(ge=0)] = Decimal("100")


class Employee(BaseModel):
    """An employee as stored."""

    id: int
    employee_number: str
    full_name: str
    email: str
    department: str
    job_title: str | None
    employment_type: EmploymentType
    weekly_capacity_hours: Decimal
    hourly_rate: Decimal
    is_active: bool
