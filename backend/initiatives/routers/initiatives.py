"""
CRUD for initiatives themselves.

An initiative is a funded body of work - a new product or programme - not a
project plan. It carries a budget, dates and an owner; the people and the
deliverables hang off it and live in their own routers.
"""

from fastapi import APIRouter, HTTPException, Query, Response, status

from core import database as db
from schemas import Initiative, InitiativeCreate, InitiativeUpdate, Page

router = APIRouter(tags=["initiatives"])

# The stored columns, as opposed to the derived ones in v_initiative_status.
COLUMNS = """
    id, code, name, department, description, status,
    planned_start_date, planned_end_date, actual_end_date,
    planned_budget, owner_employee_id
"""

# Optional filters, expressed once. The ::text casts are required, not
# cosmetic: a bare parameter that only ever appears next to NULL gives
# PostgreSQL nothing to infer a type from, and it raises AmbiguousParameter
# (42P08).
_FILTERS = """
     WHERE (%(q)s::text IS NULL
            OR code ILIKE %(q)s::text OR name ILIKE %(q)s::text)
       AND (%(status)s::text IS NULL OR status = %(status)s::text)
       AND (%(department)s::text IS NULL OR department = %(department)s::text)
"""


@router.get("/", response_model=Page[Initiative])
def list_initiatives(
    q: str | None = Query(None, description="Case-insensitive search on code and name"),
    status_filter: str | None = Query(None, alias="status"),
    department: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Page[Initiative]:
    """
    Lists initiatives with search, filtering and pagination.

    Args:
        q: Optional substring matched against code and name.
        status_filter: Optional lifecycle status filter.
        department: Optional department filter.
        limit: Maximum rows to return.
        offset: Rows to skip.

    Returns:
        Page[Initiative]: The matching page plus the unpaginated total.
    """
    params = {
        "q": f"%{q}%" if q else None,
        "status": status_filter,
        "department": department,
        "limit": limit,
        "offset": offset,
    }
    rows = db.query_all(
        f"SELECT {COLUMNS} FROM initiatives {_FILTERS} "
        "ORDER BY planned_start_date DESC, id "
        "LIMIT %(limit)s OFFSET %(offset)s",
        params,
    )
    total = db.query_one(f"SELECT COUNT(*) AS n FROM initiatives {_FILTERS}", params)
    return Page[Initiative](
        items=[Initiative(**row) for row in rows],
        total=total["n"],
        limit=limit,
        offset=offset,
    )


@router.post("/", response_model=Initiative, status_code=status.HTTP_201_CREATED)
def create_initiative(payload: InitiativeCreate) -> Initiative:
    """
    Creates an initiative.

    Args:
        payload: The new initiative.

    Returns:
        Initiative: The stored record, including its generated id.
    """
    row = db.query_one(
        f"""
        INSERT INTO initiatives (
            code, name, department, description, status,
            planned_start_date, planned_end_date, planned_budget, owner_employee_id
        ) VALUES (
            %(code)s, %(name)s, %(department)s, %(description)s, %(status)s,
            %(planned_start_date)s, %(planned_end_date)s, %(planned_budget)s,
            %(owner_employee_id)s
        )
        RETURNING {COLUMNS}
        """,
        payload.model_dump(),
    )
    return Initiative(**row)


@router.get("/{initiative_id}", response_model=Initiative)
def get_initiative(initiative_id: int) -> Initiative:
    """
    Fetches a single initiative.

    Args:
        initiative_id: Primary key.

    Returns:
        Initiative: The stored record.

    Raises:
        HTTPException: 404 if no such initiative exists.
    """
    row = db.query_one(
        f"SELECT {COLUMNS} FROM initiatives WHERE id = %(id)s",
        {"id": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")
    return Initiative(**row)


@router.patch("/{initiative_id}", response_model=Initiative)
def update_initiative(initiative_id: int, payload: InitiativeUpdate) -> Initiative:
    """
    Applies a partial update. Fields omitted from the body are left unchanged.

    Args:
        initiative_id: Primary key.
        payload: Fields to change.

    Returns:
        Initiative: The updated record.

    Raises:
        HTTPException: 400 if the body is empty, 404 if the row does not exist.
    """
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")

    assignments = ", ".join(f"{column} = %({column})s" for column in changes)
    row = db.query_one(
        f"UPDATE initiatives SET {assignments} WHERE id = %(id)s RETURNING {COLUMNS}",
        {**changes, "id": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")
    return Initiative(**row)


@router.delete("/{initiative_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_initiative(initiative_id: int) -> Response:
    """
    Deletes an initiative and, by cascade, its milestones, allocations and costs.

    Args:
        initiative_id: Primary key.

    Returns:
        Response: An empty 204.

    Raises:
        HTTPException: 404 if the row does not exist.
    """
    row = db.query_one(
        "DELETE FROM initiatives WHERE id = %(id)s RETURNING id",
        {"id": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
