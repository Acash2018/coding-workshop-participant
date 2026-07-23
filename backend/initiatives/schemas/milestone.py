"""Request models for milestones (deliverable checkpoints)."""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

MilestoneStatus = Literal[
    "NOT_STARTED", "STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"
]


class MilestoneCreate(BaseModel):
    """
    Payload for adding a milestone to an initiative.

    A milestone is a deliverable checkpoint, not a task. sequence_no is assigned
    by the server (next in line) when omitted. depends_on lists the milestones
    that must finish first - the prerequisites that form the dependency chain,
    and which may belong to another initiative.
    """

    name: Annotated[str, Field(min_length=1, max_length=200)]
    status: MilestoneStatus = "NOT_STARTED"
    planned_date: date
    actual_date: date | None = None
    depends_on: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_completed_has_actual(self) -> "MilestoneCreate":
        """
        Rejects a milestone created as COMPLETED with no actual date.

        Returns:
            MilestoneCreate: The validated model.

        Raises:
            ValueError: If status is COMPLETED without an actual date.
        """
        if self.status == "COMPLETED" and self.actual_date is None:
            raise ValueError("A completed milestone needs an actual date")
        return self


class MilestoneUpdate(BaseModel):
    """
    Payload for editing a milestone.

    Only what a delivery review actually revises: its status, the date it was
    planned for, and the date it landed. Omitted fields are left unchanged.

    The rule that a COMPLETED milestone must carry an actual date is enforced
    in the handler (with the stored values merged in) and by a database CHECK,
    so it holds whether the date arrives in this request or is already stored.
    """

    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    status: MilestoneStatus | None = None
    planned_date: date | None = None
    actual_date: date | None = None
