-- =============================================================================
-- ACME Inc. - Initiative Delivery Tracker
-- Reporting views: one per business question in the brief.
--
-- Kept separate from schema.sql because views are re-created far more often
-- than tables. Safe to re-run: every view uses CREATE OR REPLACE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Q: What are the key deliverables and their completion status?
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_milestone_health AS
SELECT m.id,
       m.initiative_id,
       i.code   AS initiative_code,
       i.name   AS initiative_name,
       m.name,
       m.sequence_no,
       m.status,
       m.planned_date,
       m.actual_date,
       CASE
           WHEN m.status = 'COMPLETED' AND m.actual_date <= m.planned_date THEN 'COMPLETE_ON_TIME'
           WHEN m.status = 'COMPLETED'                                     THEN 'COMPLETE_LATE'
           WHEN m.status = 'BLOCKED'                                       THEN 'BLOCKED'
           WHEN m.planned_date < current_date                              THEN 'BEHIND'
           WHEN m.planned_date <= current_date + 14 AND m.status = 'NOT_STARTED' THEN 'AT_RISK'
           ELSE 'ON_TRACK'
       END AS health,
       m.planned_date - current_date AS days_until_due
  FROM milestones m
  JOIN initiatives i ON i.id = m.initiative_id;

-- -----------------------------------------------------------------------------
-- Q: How much budget has been consumed versus planned?
--
-- Labour cost = allocation_percent x weekly capacity x hourly rate x weeks.
-- "Consumed" counts only weeks that have actually elapsed; "committed" counts
-- the full allocation window, which is what tells a PM whether they will
-- overrun *before* they do.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_allocation_cost AS
SELECT a.id AS allocation_id,
       a.initiative_id,
       a.employee_id,
       a.allocation_percent,
       e.weekly_capacity_hours,
       e.hourly_rate,
       -- Weeks already worked: start_date -> today, clamped at the end date.
       GREATEST(
           (LEAST(COALESCE(a.end_date, current_date), current_date) - a.start_date + 1) / 7.0,
           0
       )::numeric(10,4) AS elapsed_weeks,
       -- Weeks in the whole committed window. Open-ended allocations are
       -- measured to the initiative's planned end date.
       GREATEST(
           (COALESCE(a.end_date, i.planned_end_date) - a.start_date + 1) / 7.0,
           0
       )::numeric(10,4) AS committed_weeks
  FROM allocations a
  JOIN employees   e ON e.id = a.employee_id
  JOIN initiatives i ON i.id = a.initiative_id;

CREATE OR REPLACE VIEW v_initiative_budget AS
WITH labour AS (
    SELECT initiative_id,
           SUM(allocation_percent / 100.0 * weekly_capacity_hours * hourly_rate * elapsed_weeks)
               ::numeric(14,2) AS labour_consumed,
           SUM(allocation_percent / 100.0 * weekly_capacity_hours * hourly_rate * committed_weeks)
               ::numeric(14,2) AS labour_committed
      FROM v_allocation_cost
     GROUP BY initiative_id
),
other AS (
    SELECT initiative_id, SUM(amount)::numeric(14,2) AS other_costs
      FROM initiative_costs
     WHERE incurred_on <= current_date
     GROUP BY initiative_id
)
SELECT i.id,
       i.code,
       i.name,
       i.planned_budget,
       COALESCE(l.labour_consumed, 0)  AS labour_consumed,
       COALESCE(o.other_costs, 0)      AS other_costs,
       COALESCE(l.labour_consumed, 0) + COALESCE(o.other_costs, 0) AS total_consumed,
       COALESCE(l.labour_committed, 0) + COALESCE(o.other_costs, 0) AS total_committed,
       i.planned_budget - (COALESCE(l.labour_consumed, 0) + COALESCE(o.other_costs, 0))
           AS remaining_budget,
       CASE WHEN i.planned_budget > 0 THEN
           ROUND(100.0 * (COALESCE(l.labour_consumed, 0) + COALESCE(o.other_costs, 0))
                 / i.planned_budget, 1)
       END AS percent_consumed,
       -- Will the committed run-rate blow the budget even though today looks fine?
       (COALESCE(l.labour_committed, 0) + COALESCE(o.other_costs, 0)) > i.planned_budget
           AS forecast_overrun
  FROM initiatives i
  LEFT JOIN labour l ON l.initiative_id = i.id
  LEFT JOIN other  o ON o.initiative_id = i.id;

-- -----------------------------------------------------------------------------
-- Q: What is the status of each active project, and which are at risk?
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_initiative_status AS
WITH ms AS (
    SELECT initiative_id,
           COUNT(*)                                            AS milestone_count,
           COUNT(*) FILTER (WHERE status = 'COMPLETED')        AS milestones_complete,
           COUNT(*) FILTER (WHERE health = 'BEHIND')           AS milestones_behind,
           COUNT(*) FILTER (WHERE health = 'BLOCKED')          AS milestones_blocked,
           MIN(planned_date) FILTER (WHERE status <> 'COMPLETED') AS next_milestone_date
      FROM v_milestone_health
     GROUP BY initiative_id
),
people AS (
    SELECT initiative_id,
           COUNT(DISTINCT employee_id)                AS headcount,
           SUM(allocation_percent) / 100.0            AS fte_committed
      FROM allocations
     WHERE period @> current_date
     GROUP BY initiative_id
)
SELECT i.id,
       i.code,
       i.name,
       i.department,
       i.status,
       i.planned_start_date,
       i.planned_end_date,
       i.planned_end_date - current_date AS days_remaining,
       COALESCE(p.headcount, 0)          AS headcount,
       COALESCE(p.fte_committed, 0)::numeric(6,2) AS fte_committed,
       COALESCE(m.milestone_count, 0)    AS milestone_count,
       COALESCE(m.milestones_complete, 0) AS milestones_complete,
       COALESCE(m.milestones_behind, 0)  AS milestones_behind,
       COALESCE(m.milestones_blocked, 0) AS milestones_blocked,
       m.next_milestone_date,
       CASE WHEN COALESCE(m.milestone_count, 0) > 0 THEN
           ROUND(100.0 * m.milestones_complete / m.milestone_count, 1)
       ELSE 0 END AS percent_complete,
       b.percent_consumed,
       b.forecast_overrun,
       -- Risk rollup. Ordered worst-first; the first matching rule wins.
       CASE
           WHEN i.status IN ('COMPLETED', 'CANCELLED')      THEN 'CLOSED'
           WHEN i.planned_end_date < current_date           THEN 'OVERDUE'
           WHEN COALESCE(m.milestones_blocked, 0) > 0       THEN 'AT_RISK'
           WHEN COALESCE(m.milestones_behind, 0) > 0        THEN 'AT_RISK'
           WHEN b.forecast_overrun                          THEN 'AT_RISK'
           WHEN COALESCE(p.headcount, 0) = 0
                AND i.status = 'ACTIVE'                     THEN 'AT_RISK'
           ELSE 'ON_TRACK'
       END AS risk_status
  FROM initiatives i
  LEFT JOIN ms     m ON m.initiative_id = i.id
  LEFT JOIN people p ON p.initiative_id = i.id
  LEFT JOIN v_initiative_budget b ON b.id = i.id;

COMMENT ON VIEW v_initiative_status IS
    'One row per initiative: progress, staffing, budget and a single risk_status. '
    'Backs both the portfolio dashboard and the at-risk filter.';

-- -----------------------------------------------------------------------------
-- Q: How are resources allocated? Who is over-allocated?
--
-- NOTE: the capacity trigger in schema.sql makes >100% impossible to insert, so
-- in steady state over_allocated is always false. The column stays because the
-- trigger is DEFERRABLE - a bulk import can defer it, and constraints added
-- after data has landed do not retroactively validate. This view is the safety
-- net that proves the invariant holds.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_employee_allocation AS
SELECT e.id,
       e.employee_number,
       e.full_name,
       e.department,
       e.employment_type,
       e.weekly_capacity_hours,
       COALESCE(SUM(a.allocation_percent), 0)::numeric(6,2) AS total_percent,
       ROUND(COALESCE(SUM(a.allocation_percent), 0) / 100.0 * e.weekly_capacity_hours, 1)
           AS allocated_hours_per_week,
       ROUND((100 - COALESCE(SUM(a.allocation_percent), 0)) / 100.0 * e.weekly_capacity_hours, 1)
           AS available_hours_per_week,
       COUNT(a.id)                                     AS initiative_count,
       ARRAY_REMOVE(ARRAY_AGG(i.code ORDER BY i.code), NULL) AS initiative_codes,
       COALESCE(SUM(a.allocation_percent), 0) > 100    AS over_allocated,
       CASE
           WHEN COALESCE(SUM(a.allocation_percent), 0) > 100 THEN 'OVER_ALLOCATED'
           WHEN COALESCE(SUM(a.allocation_percent), 0) = 100 THEN 'FULLY_ALLOCATED'
           WHEN COALESCE(SUM(a.allocation_percent), 0) = 0   THEN 'UNALLOCATED'
           ELSE 'HAS_CAPACITY'
       END AS utilisation_status
  FROM employees e
  LEFT JOIN allocations a ON a.employee_id = e.id AND a.period @> current_date
  LEFT JOIN initiatives i ON i.id = a.initiative_id
 WHERE e.is_active
 GROUP BY e.id, e.employee_number, e.full_name, e.department,
          e.employment_type, e.weekly_capacity_hours;

-- -----------------------------------------------------------------------------
-- Q: What is the dependency chain between deliverables?  (STRETCH)
--
-- Walks the graph from every root milestone (one with no prerequisites) down to
-- its leaves. CYCLE guards against a bad edge turning this into an infinite
-- loop, and surfaces the offending path instead of hanging the API.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_milestone_dependency_chain AS
WITH RECURSIVE roots AS (
    SELECT m.id
      FROM milestones m
     WHERE NOT EXISTS (SELECT 1 FROM milestone_dependencies d WHERE d.milestone_id = m.id)
),
chain AS (
    SELECT r.id            AS root_id,
           m.id            AS milestone_id,
           1               AS depth,
           ARRAY[m.id]     AS path,
           m.name::text    AS path_labels
      FROM roots r
      JOIN milestones m ON m.id = r.id

    UNION ALL

    SELECT c.root_id,
           child.id,
           c.depth + 1,
           c.path || child.id,
           c.path_labels || ' -> ' || child.name
      FROM chain c
      JOIN milestone_dependencies d ON d.depends_on_milestone_id = c.milestone_id
      JOIN milestones child         ON child.id = d.milestone_id
)
CYCLE milestone_id SET is_cycle USING cycle_path
SELECT c.root_id,
       c.milestone_id,
       m.initiative_id,
       m.name,
       m.status,
       m.planned_date,
       c.depth,
       c.path,
       c.path_labels,
       c.is_cycle,
       -- A milestone cannot legitimately start until everything it depends on
       -- is done. This is what drives the "blocked by" badge in the UI.
       EXISTS (
           SELECT 1
             FROM milestone_dependencies d
             JOIN milestones p ON p.id = d.depends_on_milestone_id
            WHERE d.milestone_id = c.milestone_id
              AND p.status <> 'COMPLETED'
       ) AS has_unmet_prerequisites
  FROM chain c
  JOIN milestones m ON m.id = c.milestone_id;

COMMENT ON VIEW v_milestone_dependency_chain IS
    'Recursive walk of the milestone graph. path_labels renders the readable '
    'chain, e.g. "Credit card changes -> ATM firmware -> ATM rollout".';
