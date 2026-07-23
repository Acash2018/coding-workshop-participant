"""
Milestones: the deliverable checkpoints of an initiative.

A milestone is a checkpoint (prototype finished, beta test, QA signed off,
rollout), not a task. Milestones may depend on one another, forming a chain
across initiatives - adjusting physical ATMs requires the credit card changes
to land first.
"""

from fastapi import APIRouter, HTTPException, status

from core import database as db, security
from schemas import MilestoneUpdate

router = APIRouter(tags=["milestones"], dependencies=[security.RequireAuth])

# The stored milestone columns, as opposed to the derived health fields the
# read endpoint pulls from v_milestone_health.
_COLUMNS = "id, initiative_id, name, sequence_no, status, planned_date, actual_date"


@router.get("/{initiative_id}/milestones")
def get_milestones(initiative_id: int) -> list[dict]:
    """
    Lists an initiative's milestones with derived health and slippage.

    Reads v_milestone_health so BEHIND / AT_RISK are computed in one place
    rather than re-derived from planned_date in the UI.

    Args:
        initiative_id: Primary key of the initiative.

    Returns:
        list[dict]: Milestones in delivery order.
    """
    return db.query_all(
        """
        SELECT m.id,
               m.name,
               m.sequence_no,
               m.status,
               m.health,
               m.planned_date,
               m.actual_date,
               m.days_until_due,
               -- Days late is only meaningful once a milestone has landed.
               CASE WHEN m.actual_date IS NOT NULL
                    THEN m.actual_date - m.planned_date END AS days_variance,
               COALESCE(
                   (SELECT array_agg(p.name ORDER BY p.name)
                      FROM milestone_dependencies d
                      JOIN milestones p ON p.id = d.depends_on_milestone_id
                     WHERE d.milestone_id = m.id),
                   ARRAY[]::text[]
               ) AS depends_on
          FROM v_milestone_health m
         WHERE m.initiative_id = %(id)s
         ORDER BY m.sequence_no, m.planned_date
        """,
        {"id": initiative_id},
    )


@router.patch("/{initiative_id}/milestones/{milestone_id}")
def update_milestone(
    initiative_id: int,
    milestone_id: int,
    payload: MilestoneUpdate,
    _auth: dict = security.require_roles(*security.MANAGERS),
) -> dict:
    """
    Edits a milestone's status or dates.

    The completed-needs-an-actual-date rule is checked here against the merged
    state - the incoming change plus whatever is already stored - so marking a
    milestone COMPLETED without ever supplying a date is a clean 400 rather than
    a raw constraint violation. The same rule is enforced by a database CHECK as
    the backstop.

    Args:
        initiative_id: The initiative, used to scope the update.
        milestone_id: The milestone to change.
        payload: Fields to change; omitted fields are left unchanged.

    Returns:
        dict: The milestone with its recomputed health, as the list returns it.

    Raises:
        HTTPException: 400 on an empty body or a completed milestone with no
            actual date, 404 if the milestone does not exist on that initiative.
    """
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")

    current = db.query_one(
        f"SELECT {_COLUMNS} FROM milestones "
        "WHERE id = %(id)s AND initiative_id = %(init)s",
        {"id": milestone_id, "init": initiative_id},
    )
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No milestone {milestone_id}")

    final_status = changes.get("status", current["status"])
    final_actual = changes.get("actual_date", current["actual_date"]) \
        if "actual_date" in changes else current["actual_date"]
    if final_status == "COMPLETED" and final_actual is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A completed milestone needs an actual date.",
        )

    assignments = ", ".join(f"{column} = %({column})s" for column in changes)
    db.query_one(
        f"UPDATE milestones SET {assignments} "
        "WHERE id = %(id)s AND initiative_id = %(init)s RETURNING id",
        {**changes, "id": milestone_id, "init": initiative_id},
    )

    # Return the row from the health view so the client gets health, slippage
    # and dependencies recomputed rather than re-deriving them.
    return db.query_one(
        """
        SELECT m.id, m.name, m.sequence_no, m.status, m.health,
               m.planned_date, m.actual_date, m.days_until_due,
               CASE WHEN m.actual_date IS NOT NULL
                    THEN m.actual_date - m.planned_date END AS days_variance,
               COALESCE(
                   (SELECT array_agg(p.name ORDER BY p.name)
                      FROM milestone_dependencies d
                      JOIN milestones p ON p.id = d.depends_on_milestone_id
                     WHERE d.milestone_id = m.id),
                   ARRAY[]::text[]
               ) AS depends_on
          FROM v_milestone_health m
         WHERE m.id = %(id)s
        """,
        {"id": milestone_id},
    )
