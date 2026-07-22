import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Grid, MenuItem, Paper, Skeleton, Stack, TextField, Typography,
} from '@mui/material';
import initiativesApi from '../api/client';
import StatTile from '../components/StatTile';
import RiskDistribution from '../components/RiskDistribution';
import InitiativeTable from '../components/InitiativeTable';
import InitiativeDetail from '../components/InitiativeDetail';

const RISK_OPTIONS = [
  { value: '', label: 'All risk levels' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'AT_RISK', label: 'At risk' },
  { value: 'ON_TRACK', label: 'On track' },
  { value: 'CLOSED', label: 'Closed' },
];

/**
 * Formats a currency-ish figure compactly.
 *
 * @param {number} value The amount.
 * @returns {string} A short representation, e.g. "$1.2M".
 */
function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Portfolio dashboard.
 *
 * Reads v_initiative_status, which already computes risk, progress and budget
 * consumption in the database - the page aggregates for the KPI row but does
 * not recompute any of the underlying judgements client-side.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [department, setDepartment] = useState('');
  const [riskStatus, setRiskStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  // Bumped after any write so the portfolio reflects it. Budget consumption is
  // derived from allocations, so staffing changes move dashboard figures too.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    initiativesApi
      .status({ riskStatus, department })
      .then((data) => {
        if (active) {
          setRows(data);
          setError(null);
          // Keep the open dialog pointed at the refreshed row, so an edited
          // budget or new allocation is reflected without reopening it.
          setSelected((current) =>
            (current ? data.find((row) => row.id === current.id) ?? current : null));
        }
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [riskStatus, department, version]);

  const departments = useMemo(
    () => [...new Set(rows.map((row) => row.department))].sort(),
    [rows],
  );

  const summary = useMemo(() => {
    const counts = rows.reduce((acc, row) => {
      acc[row.risk_status] = (acc[row.risk_status] ?? 0) + 1;
      return acc;
    }, {});
    const live = rows.filter((row) => row.risk_status !== 'CLOSED');
    return {
      counts,
      atRisk: (counts.AT_RISK ?? 0) + (counts.OVERDUE ?? 0),
      live: live.length,
      fte: live.reduce((sum, row) => sum + Number(row.fte_committed ?? 0), 0),
      overrunning: rows.filter((row) => row.forecast_overrun).length,
      milestonesBehind: rows.reduce((sum, row) => sum + (row.milestones_behind ?? 0), 0),
    };
  }, [rows]);

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h2" sx={{ mb: 0.5 }}>
          Portfolio
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Delivery health across every initiative.
        </Typography>
      </Box>

      {/* Filters sit in one row above the content, never between chart and legend. */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          select
          size="small"
          label="Risk"
          value={riskStatus}
          onChange={(event) => setRiskStatus(event.target.value)}
          sx={{ minWidth: 180 }}
        >
          {RISK_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Department"
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All departments</MenuItem>
          {departments.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {loading ? (
        <Skeleton variant="rounded" height={148} />
      ) : (
        <Grid container spacing={2}>
          {/* Exactly one hero figure: the number a delivery review opens with. */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatTile
              label="Needs attention"
              value={summary.atRisk}
              caption={summary.atRisk === 1 ? 'initiative at risk' : 'initiatives at risk'}
              role={summary.atRisk > 0 ? 'warning' : 'good'}
              hero
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatTile label="Active" value={summary.live} caption="initiatives in flight" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatTile
              label="Committed effort"
              value={summary.fte.toFixed(1)}
              caption="FTE allocated today"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatTile
              label="Forecast overrun"
              value={summary.overrunning}
              caption="projected over budget"
              role={summary.overrunning > 0 ? 'critical' : 'good'}
            />
          </Grid>
        </Grid>
      )}

      <Paper elevation={0} sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 2 }}>
          RISK MIX
        </Typography>
        {loading ? <Skeleton height={40} /> : <RiskDistribution counts={summary.counts} />}
      </Paper>

      <Box>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          ALL INITIATIVES
        </Typography>
        {loading ? (
          <Skeleton variant="rounded" height={240} />
        ) : (
          <InitiativeTable rows={rows} onSelect={setSelected} />
        )}
      </Box>

      <InitiativeDetail
        initiative={selected}
        onClose={() => setSelected(null)}
        onChanged={() => setVersion((n) => n + 1)}
      />

      {summary.milestonesBehind > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {summary.milestonesBehind === 1
            ? '1 milestone is past its planned date.'
            : `${summary.milestonesBehind} milestones are past their planned date.`}
        </Typography>
      )}
    </Stack>
  );
}
