-- =============================================================================
-- ACME Inc. - Initiative Delivery Tracker
-- PostgreSQL schema (target: Aurora PostgreSQL 17.x)
--
-- Domain model:
--   INITIATIVE  a funded body of work (a new product), NOT a project plan
--   MILESTONE   a deliverable checkpoint (prototype, beta, QA, rollout)
--   EMPLOYEE    a resource, allocated by PERCENT COMMITMENT - never by task
--   ALLOCATION  employee <-> initiative over a date range, at a % of capacity
--
-- There are deliberately no tasks, timesheets, or work items in this model.
-- =============================================================================

BEGIN;

-- citext    : case-insensitive email columns
-- btree_gist: lets a GiST index mix a scalar (employee_id) with a range (period)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
    'Generic BEFORE UPDATE trigger; stamps updated_at on any table that has it.';

-- -----------------------------------------------------------------------------
-- Authentication & authorization
-- -----------------------------------------------------------------------------

CREATE TABLE app_users (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email           citext      NOT NULL UNIQUE,
    password_hash   text        NOT NULL,
    display_name    text        NOT NULL,
    role            text        NOT NULL DEFAULT 'VIEWER'
                    CHECK (role IN ('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEAD', 'VIEWER')),
    is_active       boolean     NOT NULL DEFAULT true,
    last_login_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN app_users.role IS
    'ADMIN: everything. PROJECT_MANAGER: CRUD on owned initiatives. '
    'TEAM_LEAD: CRUD on allocations for own department. VIEWER: read-only.';

-- -----------------------------------------------------------------------------
-- Employees (resources)
-- -----------------------------------------------------------------------------

CREATE TABLE employees (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_number     text        NOT NULL UNIQUE,
    full_name           text        NOT NULL,
    email               citext      NOT NULL UNIQUE,
    department          text        NOT NULL,
    job_title           text,
    employment_type     text        NOT NULL DEFAULT 'FULL_TIME'
                        CHECK (employment_type IN ('FULL_TIME', 'PART_TIME', 'CONTRACTOR')),

    -- Capacity basis. 100% allocation == this many hours per week.
    weekly_capacity_hours numeric(5,2) NOT NULL DEFAULT 40.00
                          CHECK (weekly_capacity_hours > 0 AND weekly_capacity_hours <= 60),

    -- Blended cost rate. The brief estimates everyone at $100/hr; keeping it
    -- per-employee costs nothing now and avoids a migration if that changes.
    hourly_rate         numeric(10,2) NOT NULL DEFAULT 100.00 CHECK (hourly_rate >= 0),

    app_user_id         bigint UNIQUE REFERENCES app_users (id) ON DELETE SET NULL,
    is_active           boolean     NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employees_department_idx ON employees (department) WHERE is_active;

-- -----------------------------------------------------------------------------
-- Initiatives
-- -----------------------------------------------------------------------------

CREATE TABLE initiatives (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                text        NOT NULL UNIQUE,
    name                text        NOT NULL,
    description         text,
    department          text        NOT NULL,

    status              text        NOT NULL DEFAULT 'PROPOSED'
                        CHECK (status IN ('PROPOSED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),

    planned_start_date  date        NOT NULL,
    planned_end_date    date        NOT NULL,
    actual_end_date     date,

    planned_budget      numeric(14,2) NOT NULL DEFAULT 0 CHECK (planned_budget >= 0),

    owner_employee_id   bigint REFERENCES employees (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT initiatives_dates_ordered CHECK (planned_end_date >= planned_start_date),
    CONSTRAINT initiatives_completed_has_actual_end CHECK (
        status <> 'COMPLETED' OR actual_end_date IS NOT NULL
    )
);

CREATE INDEX initiatives_status_idx ON initiatives (status);
CREATE INDEX initiatives_department_idx ON initiatives (department);

-- -----------------------------------------------------------------------------
-- Milestones (deliverables)
-- -----------------------------------------------------------------------------

CREATE TABLE milestones (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    initiative_id       bigint      NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,
    name                text        NOT NULL,
    description         text,

    -- Display / logical ordering within the initiative. Dependencies below are
    -- the source of truth for actual sequencing; this is just for the UI.
    sequence_no         integer     NOT NULL DEFAULT 1 CHECK (sequence_no > 0),

    status              text        NOT NULL DEFAULT 'NOT_STARTED'
                        CHECK (status IN ('NOT_STARTED', 'STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED')),

    planned_date        date        NOT NULL,
    actual_date         date,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT milestones_unique_name_per_initiative UNIQUE (initiative_id, name),
    CONSTRAINT milestones_completed_has_actual_date CHECK (
        status <> 'COMPLETED' OR actual_date IS NOT NULL
    )
);

CREATE INDEX milestones_initiative_idx ON milestones (initiative_id, sequence_no);
CREATE INDEX milestones_status_idx ON milestones (status);

-- Dependency chain: "adjusting physical ATMs requires the credit-card changes
-- to land first" -> (ATM milestone) depends_on (credit-card milestone).
CREATE TABLE milestone_dependencies (
    milestone_id            bigint NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
    depends_on_milestone_id bigint NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
    created_at              timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (milestone_id, depends_on_milestone_id),
    CONSTRAINT milestone_dependencies_no_self_reference
        CHECK (milestone_id <> depends_on_milestone_id)
);

CREATE INDEX milestone_dependencies_reverse_idx
    ON milestone_dependencies (depends_on_milestone_id);

-- -----------------------------------------------------------------------------
-- Allocations (percent commitment of an employee to an initiative)
-- -----------------------------------------------------------------------------

CREATE TABLE allocations (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id         bigint      NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    initiative_id       bigint      NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,

    allocation_percent  numeric(5,2) NOT NULL
                        CHECK (allocation_percent > 0 AND allocation_percent <= 100),

    role_on_initiative  text,

    start_date          date        NOT NULL,
    end_date            date,       -- NULL == open ended

    -- Generated so the capacity trigger and the GiST index share one definition.
    -- Inclusive on both ends: an allocation ending 2026-06-30 covers that day.
    period              daterange   GENERATED ALWAYS AS
                        (daterange(start_date, end_date, '[]')) STORED,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT allocations_dates_ordered CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX allocations_employee_period_idx ON allocations USING gist (employee_id, period);
CREATE INDEX allocations_initiative_idx ON allocations (initiative_id);

COMMENT ON COLUMN allocations.allocation_percent IS
    'Percent of the employee weekly capacity. 100 == full time on this initiative.';

-- --- The 40-hour rule --------------------------------------------------------
-- An employee may never exceed 100% across all initiatives *at the same time*.
-- A row-level CHECK cannot express this (it spans rows), and an EXCLUSION
-- constraint cannot express it either (it cannot SUM). So: a constraint trigger.
--
-- Key insight: the sum of allocations over time is a step function, so its peak
-- always occurs on a day some allocation *starts*. Probing every start date that
-- overlaps the changed row is therefore sufficient - no day-by-day scan needed.
--
-- AFTER (not BEFORE) because generated columns such as period are not yet
-- populated during BEFORE triggers.

CREATE OR REPLACE FUNCTION enforce_allocation_capacity() RETURNS trigger AS $$
DECLARE
    v_peak_percent numeric(6,2);
    v_peak_date    date;
    v_employee     text;
BEGIN
    SELECT peak.total, peak.probe_date
      INTO v_peak_percent, v_peak_date
      FROM (
          SELECT probe.probe_date,
                 SUM(a.allocation_percent) AS total
            FROM (
                     SELECT DISTINCT s.start_date AS probe_date
                       FROM allocations s
                      WHERE s.employee_id = NEW.employee_id
                        AND s.period && NEW.period
                 ) probe
            JOIN allocations a
              ON a.employee_id = NEW.employee_id
             AND a.period @> probe.probe_date
           GROUP BY probe.probe_date
      ) peak
     ORDER BY peak.total DESC, peak.probe_date
     LIMIT 1;

    IF v_peak_percent > 100 THEN
        SELECT full_name INTO v_employee FROM employees WHERE id = NEW.employee_id;
        -- Note: the percent sign is appended to the argument rather than written
        -- into the format string, because RAISE parses '%%%' as literal-%
        -- followed by a placeholder, which renders as '%120.00'.
        RAISE EXCEPTION
            'Over-allocation: % would be committed at % on %, exceeding the 100%% capacity limit',
            COALESCE(v_employee, NEW.employee_id::text),
            v_peak_percent::text || '%',
            v_peak_date
            USING ERRCODE = 'check_violation',
                  HINT = 'Reduce an existing allocation percent or shift the date range.';
    END IF;

    RETURN NULL;  -- AFTER trigger; return value is ignored
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER allocations_capacity_check
    AFTER INSERT OR UPDATE OF employee_id, allocation_percent, start_date, end_date
    ON allocations
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION enforce_allocation_capacity();

COMMENT ON TRIGGER allocations_capacity_check ON allocations IS
    'Enforces the 40h / 100% rule. DEFERRABLE so a bulk reshuffle can '
    'SET CONSTRAINTS allocations_capacity_check DEFERRED and settle at COMMIT.';

-- -----------------------------------------------------------------------------
-- Non-labour costs (STRETCH: hardware, licences, printing)
-- -----------------------------------------------------------------------------

CREATE TABLE initiative_costs (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    initiative_id   bigint      NOT NULL REFERENCES initiatives (id) ON DELETE CASCADE,
    category        text        NOT NULL
                    CHECK (category IN ('HARDWARE', 'SOFTWARE_LICENSE', 'TRAVEL', 'TRAINING', 'OTHER')),
    description     text        NOT NULL,
    amount          numeric(14,2) NOT NULL CHECK (amount >= 0),
    incurred_on     date        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX initiative_costs_initiative_idx ON initiative_costs (initiative_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

CREATE TRIGGER app_users_set_updated_at BEFORE UPDATE ON app_users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER initiatives_set_updated_at BEFORE UPDATE ON initiatives
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER milestones_set_updated_at BEFORE UPDATE ON milestones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER allocations_set_updated_at BEFORE UPDATE ON allocations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER initiative_costs_set_updated_at BEFORE UPDATE ON initiative_costs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
