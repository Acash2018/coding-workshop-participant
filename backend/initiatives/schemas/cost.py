"""Request and response models for non-labour costs."""

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field

CostCategory = Literal["HARDWARE", "SOFTWARE_LICENSE", "TRAVEL", "TRAINING", "OTHER"]


class CostCreate(BaseModel):
    """
    Payload for recording a non-labour cost against an initiative.

    These are the expenses that are not people: software licences, hardware,
    travel, training. Labour cost is derived from allocations and never entered
    by hand; these are the other side of the budget, entered directly.
    """

    category: CostCategory = "OTHER"
    description: Annotated[str, Field(min_length=1, max_length=200)]
    amount: Annotated[Decimal, Field(ge=0)]
    incurred_on: date


class Cost(BaseModel):
    """A recorded cost."""

    id: int
    category: CostCategory
    description: str
    amount: Decimal
    incurred_on: date
