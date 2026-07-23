"""
Milestones: the deliverable checkpoints of an initiative.

A milestone is a checkpoint (prototype finished, beta test, QA signed off,
rollout), not a task. Milestones may depend on one another, forming a chain
across initiatives - adjusting physical ATMs requires the credit card changes
to land first.
"""

from fastapi import APIRouter

from core import database as db, security

router = APIRouter(tags=["milestones"], dependencies=[security.RequireAuth])


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
