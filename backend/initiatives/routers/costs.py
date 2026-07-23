"""
Non-labour costs: the budget's other half.

Labour is derived from allocations; these are entered directly - licences,
hardware, travel, training. The budget view sums the two, so recording a cost
here immediately moves an initiative's consumed figure (once its date has
arrived - a future-dated cost does not count yet, matching how elapsed labour
is measured).
"""

from fastapi import APIRouter, HTTPException, Response, status

from core import database as db, security
from schemas import Cost, CostCreate

router = APIRouter(tags=["costs"], dependencies=[security.RequireAuth])

_COLUMNS = "id, category, description, amount, incurred_on"


@router.get("/{initiative_id}/costs", response_model=list[Cost])
def list_costs(initiative_id: int) -> list[dict]:
    """
    Lists an initiative's recorded non-labour costs, most recent first.

    Args:
        initiative_id: The initiative whose costs to list.

    Returns:
        list[dict]: Recorded costs.
    """
    return db.query_all(
        f"SELECT {_COLUMNS} FROM initiative_costs "
        "WHERE initiative_id = %(id)s ORDER BY incurred_on DESC, id DESC",
        {"id": initiative_id},
    )


@router.post(
    "/{initiative_id}/costs",
    response_model=Cost,
    status_code=status.HTTP_201_CREATED,
)
def add_cost(
    initiative_id: int,
    payload: CostCreate,
    _auth: dict = security.require_roles(*security.MANAGERS),
) -> dict:
    """
    Records a non-labour cost against an initiative.

    Args:
        initiative_id: The initiative to charge.
        payload: The cost.

    Returns:
        dict: The stored record.

    Raises:
        HTTPException: 404 if the initiative does not exist.
    """
    exists = db.query_one(
        "SELECT id FROM initiatives WHERE id = %(id)s", {"id": initiative_id}
    )
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")

    return db.query_one(
        f"""
        INSERT INTO initiative_costs (initiative_id, category, description, amount, incurred_on)
        VALUES (%(initiative_id)s, %(category)s, %(description)s, %(amount)s, %(incurred_on)s)
        RETURNING {_COLUMNS}
        """,
        {**payload.model_dump(), "initiative_id": initiative_id},
    )


@router.delete(
    "/{initiative_id}/costs/{cost_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_cost(
    initiative_id: int,
    cost_id: int,
    _auth: dict = security.require_roles(*security.MANAGERS),
) -> Response:
    """
    Removes a recorded cost.

    Args:
        initiative_id: The initiative, used to scope the delete.
        cost_id: The cost to remove.

    Returns:
        Response: An empty 204.

    Raises:
        HTTPException: 404 if no such cost exists on that initiative.
    """
    row = db.query_one(
        "DELETE FROM initiative_costs WHERE id = %(id)s AND initiative_id = %(init)s "
        "RETURNING id",
        {"id": cost_id, "init": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No cost {cost_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
