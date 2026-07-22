"""
Committing people to initiatives.

Resources are allocated by percentage of their working week, never by task.
100% means the whole week - the standard capacity is 40 hours, held per employee
so a part-timer's 100% is their own week, not everyone else's.

The rule that an employee may never exceed 100% at any instant is enforced by a
database trigger, not here. See data/schema.sql.
"""

from datetime import date

from fastapi import APIRouter, HTTPException, Query, Response, status

from core import database as db
from schemas import AllocationCreate, AllocationUpdate

router = APIRouter(tags=["allocations"])


@router.get("/{initiative_id}/team")
def get_team(initiative_id: int) -> list[dict]:
    """
    Lists everyone allocated to an initiative, past and present.

    Allocations that have ended are included rather than filtered out - they
    explain historic budget consumption, and hiding them makes a stalled
    initiative look like it never had anyone on it. `active_today` distinguishes
    current staffing from past.

    Args:
        initiative_id: Primary key of the initiative.

    Returns:
        list[dict]: One row per allocation, current allocations first.
    """
    return db.query_all(
        """
        SELECT a.id,
               e.id AS employee_id,
               e.full_name,
               e.department,
               e.employment_type,
               e.weekly_capacity_hours,
               a.allocation_percent,
               a.role_on_initiative,
               a.start_date,
               a.end_date,
               (a.period @> current_date) AS active_today,
               ROUND(a.allocation_percent / 100.0 * e.weekly_capacity_hours, 1)
                   AS hours_per_week
          FROM allocations a
          JOIN employees e ON e.id = a.employee_id
         WHERE a.initiative_id = %(id)s
         ORDER BY (a.period @> current_date) DESC, e.full_name
        """,
        {"id": initiative_id},
    )


@router.get("/{initiative_id}/candidates")
def get_candidates(
    initiative_id: int,
    start: date,
    end: date | None = Query(None),
) -> list[dict]:
    """
    Lists employees with the spare capacity they have during a proposed window.

    Peak commitment, not commitment today: an employee free this week but booked
    solid next month cannot take a six-month allocation. The peak of a sum of
    step functions falls on a day some allocation starts, so probing those dates
    inside the window is exact - the same reasoning the capacity trigger uses.

    Args:
        initiative_id: The initiative being staffed (used to flag existing members).
        start: First day of the proposed allocation.
        end: Last day, or None for open ended.

    Returns:
        list[dict]: Active employees, those with most headroom first.
    """
    return db.query_all(
        """
        WITH window_range AS (
            SELECT daterange(%(start)s::date, %(end)s::date, '[]') AS r
        ),
        probe AS (
            -- Only start dates that fall inside the proposed window. An
            -- allocation overlapping the window may have begun long before it,
            -- and its start date can carry a peak that has since passed -
            -- probing it would report capacity the employee actually has.
            SELECT DISTINCT s.start_date AS d
              FROM allocations s, window_range w
             WHERE s.period && w.r
               AND w.r @> s.start_date
            UNION
            -- The window's own first day covers allocations already running
            -- when it opens.
            SELECT %(start)s::date
        )
        SELECT e.id,
               e.full_name,
               e.department,
               e.employment_type,
               e.weekly_capacity_hours,
               COALESCE(peak.max_total, 0)::numeric(6,2) AS committed_percent,
               (100 - COALESCE(peak.max_total, 0))::numeric(6,2) AS available_percent,
               ROUND((100 - COALESCE(peak.max_total, 0)) / 100.0 * e.weekly_capacity_hours, 1)
                   AS available_hours,
               EXISTS (
                   SELECT 1 FROM allocations a
                    WHERE a.employee_id = e.id
                      AND a.initiative_id = %(initiative_id)s
                      AND a.period && (SELECT r FROM window_range)
               ) AS already_on_initiative
          FROM employees e
          LEFT JOIN LATERAL (
              SELECT MAX(t.total) AS max_total
                FROM (
                    SELECT SUM(a.allocation_percent) AS total
                      FROM probe p
                      JOIN allocations a
                        ON a.employee_id = e.id
                       AND a.period @> p.d
                     GROUP BY p.d
                ) t
          ) peak ON true
         WHERE e.is_active
         ORDER BY available_percent DESC, e.full_name
        """,
        {"initiative_id": initiative_id, "start": start, "end": end},
    )


@router.post("/{initiative_id}/allocations", status_code=status.HTTP_201_CREATED)
def add_allocation(initiative_id: int, payload: AllocationCreate) -> dict:
    """
    Commits an employee to an initiative at a percentage of their week.

    A breach of the 100% rule is not validated here. The database trigger owns
    that invariant so it holds regardless of which client writes, and its
    rejection surfaces as a 409 carrying the offending percentage and date.

    Args:
        initiative_id: The initiative to staff.
        payload: Employee, commitment percentage and period.

    Returns:
        dict: The stored allocation joined to the employee.

    Raises:
        HTTPException: 404 if the initiative does not exist.
    """
    exists = db.query_one(
        "SELECT id FROM initiatives WHERE id = %(id)s", {"id": initiative_id}
    )
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")

    return db.query_one(
        """
        WITH inserted AS (
            INSERT INTO allocations (
                employee_id, initiative_id, allocation_percent,
                start_date, end_date, role_on_initiative
            ) VALUES (
                %(employee_id)s, %(initiative_id)s, %(allocation_percent)s,
                %(start_date)s, %(end_date)s, %(role_on_initiative)s
            )
            RETURNING *
        )
        SELECT i.id, i.employee_id, e.full_name, i.allocation_percent,
               i.role_on_initiative, i.start_date, i.end_date,
               (i.period @> current_date) AS active_today
          FROM inserted i
          JOIN employees e ON e.id = i.employee_id
        """,
        {**payload.model_dump(), "initiative_id": initiative_id},
    )


@router.patch("/{initiative_id}/allocations/{allocation_id}")
def update_allocation(
    initiative_id: int,
    allocation_id: int,
    payload: AllocationUpdate,
) -> dict:
    """
    Changes an existing commitment's percentage, period or role.

    Extending a period or raising a percentage can breach the 100% rule just as
    an insert can, and the trigger fires on UPDATE too - so a change that would
    over-commit someone comes back as a 409 naming the date it happens.

    Args:
        initiative_id: The initiative, used to scope the update.
        allocation_id: The allocation to change.
        payload: Fields to change; omitted fields are left alone.

    Returns:
        dict: The updated allocation joined to the employee.

    Raises:
        HTTPException: 400 if the body is empty, 404 if no such allocation.
    """
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")

    assignments = ", ".join(f"{column} = %({column})s" for column in changes)
    row = db.query_one(
        f"""
        WITH updated AS (
            UPDATE allocations SET {assignments}
             WHERE id = %(allocation_id)s AND initiative_id = %(initiative_id)s
            RETURNING *
        )
        SELECT u.id, u.employee_id, e.full_name, u.allocation_percent,
               u.role_on_initiative, u.start_date, u.end_date,
               (u.period @> current_date) AS active_today
          FROM updated u
          JOIN employees e ON e.id = u.employee_id
        """,
        {**changes, "allocation_id": allocation_id, "initiative_id": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No allocation {allocation_id}")
    return row


@router.delete(
    "/{initiative_id}/allocations/{allocation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_allocation(initiative_id: int, allocation_id: int) -> Response:
    """
    Removes an employee's commitment to an initiative.

    Args:
        initiative_id: The initiative, used to scope the delete.
        allocation_id: The allocation to remove.

    Returns:
        Response: An empty 204.

    Raises:
        HTTPException: 404 if no such allocation exists on that initiative.
    """
    row = db.query_one(
        "DELETE FROM allocations WHERE id = %(id)s AND initiative_id = %(init)s "
        "RETURNING id",
        {"id": allocation_id, "init": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No allocation {allocation_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
