"""
Milestones: the deliverable checkpoints of an initiative.

A milestone is a checkpoint (prototype finished, beta test, QA signed off,
rollout), not a task. Milestones may depend on one another, forming a chain
across initiatives - adjusting physical ATMs requires the credit card changes
to land first.
"""

from fastapi import APIRouter, HTTPException, Response, status

from core import database as db, security
from schemas import MilestoneCreate, MilestoneUpdate

router = APIRouter(tags=["milestones"], dependencies=[security.RequireAuth])

# The stored milestone columns, as opposed to the derived health fields the
# read endpoint pulls from v_milestone_health.
_COLUMNS = "id, initiative_id, name, sequence_no, status, planned_date, actual_date"


def _milestone_with_health(milestone_id: int) -> dict:
    """
    Returns a milestone from the health view, shaped as the list endpoint does.

    Args:
        milestone_id: The milestone to fetch.

    Returns:
        dict: The milestone with recomputed health, slippage and prerequisites.
    """
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
               ) AS depends_on,
               COALESCE(
                   (SELECT array_agg(d.depends_on_milestone_id)
                      FROM milestone_dependencies d
                     WHERE d.milestone_id = m.id),
                   ARRAY[]::bigint[]
               ) AS depends_on_ids
          FROM v_milestone_health m
         WHERE m.id = %(id)s
        """,
        {"id": milestone_id},
    )


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
               ) AS depends_on,
               -- The prerequisite ids, so the UI can order a milestone after
               -- the work it depends on rather than by sequence_no alone.
               COALESCE(
                   (SELECT array_agg(d.depends_on_milestone_id)
                      FROM milestone_dependencies d
                     WHERE d.milestone_id = m.id),
                   ARRAY[]::bigint[]
               ) AS depends_on_ids
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
    return _milestone_with_health(milestone_id)


@router.post("/{initiative_id}/milestones", status_code=status.HTTP_201_CREATED)
def add_milestone(
    initiative_id: int,
    payload: MilestoneCreate,
    _auth: dict = security.require_roles("ADMIN"),
) -> dict:
    """
    Adds a milestone to an initiative. Admin only.

    Defining the deliverables of an initiative is an administrative act, like
    creating the initiative itself; managers then track them. sequence_no is
    assigned as the next in line when the payload omits it.

    Args:
        initiative_id: The initiative to add the milestone to.
        payload: The milestone, with optional prerequisites.

    Returns:
        dict: The stored milestone with its derived health.

    Raises:
        HTTPException: 404 if the initiative does not exist.
    """
    exists = db.query_one(
        "SELECT id FROM initiatives WHERE id = %(id)s", {"id": initiative_id}
    )
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")

    created = db.query_one(
        """
        INSERT INTO milestones (
            initiative_id, name, sequence_no, status, planned_date, actual_date
        )
        VALUES (
            %(initiative_id)s, %(name)s,
            COALESCE(
                (SELECT MAX(sequence_no) + 1 FROM milestones
                  WHERE initiative_id = %(initiative_id)s),
                1
            ),
            %(status)s, %(planned_date)s, %(actual_date)s
        )
        RETURNING id
        """,
        {
            "initiative_id": initiative_id,
            "name": payload.name,
            "status": payload.status,
            "planned_date": payload.planned_date,
            "actual_date": payload.actual_date,
        },
    )

    # Prerequisites, if any. A prerequisite may belong to another initiative -
    # the brief's ATM-needs-credit-card example is exactly that - so they are
    # not scoped to this one. The foreign keys guarantee they exist; a new
    # milestone cannot close a cycle because nothing depends on it yet.
    for prerequisite_id in dict.fromkeys(payload.depends_on):
        db.query_one(
            "INSERT INTO milestone_dependencies (milestone_id, depends_on_milestone_id) "
            "VALUES (%(m)s, %(dep)s) RETURNING milestone_id",
            {"m": created["id"], "dep": prerequisite_id},
        )

    return _milestone_with_health(created["id"])


@router.delete(
    "/{initiative_id}/milestones/{milestone_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_milestone(
    initiative_id: int,
    milestone_id: int,
    _auth: dict = security.require_roles("ADMIN"),
) -> Response:
    """
    Removes a milestone. Admin only.

    Any dependency edges touching it are removed by cascade.

    Args:
        initiative_id: The initiative, used to scope the delete.
        milestone_id: The milestone to remove.

    Returns:
        Response: An empty 204.

    Raises:
        HTTPException: 404 if no such milestone exists on that initiative.
    """
    row = db.query_one(
        "DELETE FROM milestones WHERE id = %(id)s AND initiative_id = %(init)s "
        "RETURNING id",
        {"id": milestone_id, "init": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No milestone {milestone_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
