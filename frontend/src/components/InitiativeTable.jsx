import PropTypes from 'prop-types';
import { useMediaQuery } from 'react-responsive';
import {
  Box, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material';
import StatusChip from './StatusChip';
import Meter from './Meter';
import { riskRoles } from '../theme/vizTokens';

/**
 * Formats a percentage for display.
 *
 * @param {number|null} value Percentage, already 0-100.
 * @returns {string} Formatted value, or an em dash when unknown.
 */
function percent(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(0)}%`;
}

/**
 * Describes remaining time in words.
 *
 * A closed initiative is never "overdue" - it has already finished, and its
 * planned end date being in the past is expected rather than a problem.
 *
 * @param {number} days Days until the planned end date; negative when past.
 * @param {string} riskStatus The row's computed risk status.
 * @returns {string} A short human phrase.
 */
function describeDays(days, riskStatus) {
  if (riskStatus === 'CLOSED') return 'Closed';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d left`;
}

/**
 * Portfolio rows, rendered as a table on wide screens and as cards on narrow.
 *
 * This is a genuine layout switch rather than a horizontally scrolling table:
 * eight columns cannot be read on a phone, and a card can stack the same
 * fields without shrinking any of them below legibility.
 *
 * @param {{rows: Array<object>}} props Component props.
 * @returns {JSX.Element} The rendered collection.
 */
export default function InitiativeTable({ rows }) {
  const isNarrow = useMediaQuery({ maxWidth: 899 });

  if (rows.length === 0) {
    return (
      <Paper elevation={0} sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          No initiatives match these filters.
        </Typography>
      </Paper>
    );
  }

  if (isNarrow) {
    return (
      <Stack spacing={1.5}>
        {rows.map((row) => (
          <Paper key={row.id} elevation={0} sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                {/* Wraps rather than truncating: the name is the row's primary
                    identifier, and an ellipsis can make two initiatives with a
                    shared prefix indistinguishable. */}
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {row.name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {row.code} · {row.department}
                </Typography>
              </Box>
              <StatusChip
                role={riskRoles[row.risk_status]?.role ?? 'neutral'}
                label={riskRoles[row.risk_status]?.label ?? row.risk_status}
                dense
              />
            </Box>

            <Stack spacing={1.25} sx={{ mt: 1.5 }}>
              <Meter
                label="Milestones"
                value={Number(row.percent_complete ?? 0)}
                caption={`${row.milestones_complete}/${row.milestone_count}`}
              />
              <Meter
                label="Budget"
                value={Number(row.percent_consumed ?? 0)}
                caption={percent(row.percent_consumed)}
              />
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1.5, display: 'block' }}>
              {row.headcount} people · {Number(row.fte_committed).toFixed(1)} FTE ·{' '}
              {describeDays(row.days_remaining, row.risk_status)}
            </Typography>
          </Paper>
        ))}
      </Stack>
    );
  }

  return (
    <TableContainer component={Paper} elevation={0}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Initiative</TableCell>
            <TableCell>Risk</TableCell>
            <TableCell sx={{ minWidth: 150 }}>Milestones</TableCell>
            <TableCell sx={{ minWidth: 150 }}>Budget used</TableCell>
            <TableCell align="right">People</TableCell>
            <TableCell align="right">FTE</TableCell>
            <TableCell align="right">Timeline</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {row.name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {row.code} · {row.department}
                </Typography>
              </TableCell>
              <TableCell>
                <StatusChip
                  role={riskRoles[row.risk_status]?.role ?? 'neutral'}
                  label={riskRoles[row.risk_status]?.label ?? row.risk_status}
                  dense
                />
              </TableCell>
              <TableCell>
                <Meter
                  label=""
                  value={Number(row.percent_complete ?? 0)}
                  caption={`${row.milestones_complete}/${row.milestone_count}`}
                  height={6}
                />
              </TableCell>
              <TableCell>
                <Meter
                  label=""
                  value={Number(row.percent_consumed ?? 0)}
                  caption={percent(row.percent_consumed)}
                  height={6}
                />
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {row.headcount}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {Number(row.fte_committed).toFixed(1)}
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  fontVariantNumeric: 'tabular-nums',
                  color: row.days_remaining < 0 && row.risk_status !== 'CLOSED'
                    ? 'error.main'
                    : 'text.secondary',
                  whiteSpace: 'nowrap',
                }}
              >
                {describeDays(row.days_remaining, row.risk_status)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

InitiativeTable.propTypes = {
  /** Rows from v_initiative_status. */
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
};
