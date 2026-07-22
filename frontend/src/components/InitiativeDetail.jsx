import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useMediaQuery } from 'react-responsive';
import {
  Alert, Box, Chip, Dialog, DialogContent, DialogTitle, Divider, IconButton,
  Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import initiativesApi from '../api/client';
import StatusChip from './StatusChip';
import { milestoneRoles, riskRoles } from '../theme/vizTokens';

/**
 * Formats an ISO date as a short readable date.
 *
 * @param {string|null} iso ISO date string.
 * @returns {string} Formatted date, or an em dash when absent.
 */
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * Describes how late or early a milestone landed.
 *
 * @param {number|null} variance Days between actual and planned date.
 * @returns {string} A short phrase, empty when not yet delivered.
 */
function describeVariance(variance) {
  if (variance === null || variance === undefined) return '';
  if (variance === 0) return 'on the day';
  return variance > 0 ? `${variance}d late` : `${Math.abs(variance)}d early`;
}

/**
 * Detail view for a single initiative: who is on it, and what is due when.
 *
 * Opens as a dialog rather than a separate route so the reader keeps the
 * portfolio context they clicked from. Goes full screen on narrow viewports,
 * where a centred dialog would leave unusable margins.
 *
 * @param {{initiative: object|null, onClose: Function}} props Component props.
 * @returns {JSX.Element|null} The dialog, or null when nothing is selected.
 */
export default function InitiativeDetail({ initiative, onClose }) {
  const isNarrow = useMediaQuery({ maxWidth: 899 });
  const [team, setTeam] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!initiative) return undefined;
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      initiativesApi.team(initiative.id),
      initiativesApi.milestones(initiative.id),
    ])
      .then(([teamRows, milestoneRows]) => {
        if (!active) return;
        setTeam(teamRows);
        setMilestones(milestoneRows);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [initiative]);

  if (!initiative) return null;

  const current = team.filter((row) => row.active_today);
  const past = team.filter((row) => !row.active_today);
  const currentFte = current.reduce(
    (sum, row) => sum + Number(row.allocation_percent) / 100, 0,
  );
  // The delivery date a stakeholder actually asks about is the last milestone,
  // not the initiative's planned_end_date - those can differ.
  const finalMilestone = milestones[milestones.length - 1];

  return (
    <Dialog
      open
      onClose={onClose}
      fullScreen={isNarrow}
      maxWidth="md"
      fullWidth
      aria-labelledby="initiative-detail-title"
    >
      <DialogTitle id="initiative-detail-title" sx={{ pr: 6 }}>
        <Typography component="div" variant="h2" sx={{ fontSize: '1.35rem' }}>
          {initiative.name}
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ mt: 0.75, alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {initiative.code} · {initiative.department}
          </Typography>
          <StatusChip
            role={riskRoles[initiative.risk_status]?.role ?? 'neutral'}
            label={riskRoles[initiative.risk_status]?.label ?? initiative.risk_status}
            dense
          />
        </Stack>
        <IconButton
          onClick={onClose}
          aria-label="Close"
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Stack spacing={2}>
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="rounded" height={160} />
          </Stack>
        ) : (
          <Stack spacing={3}>
            <Box>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                PEOPLE ON THIS INITIATIVE
              </Typography>

              <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h2" sx={{ fontSize: '1.75rem' }}>
                    {current.length}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    assigned today
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="h2" sx={{ fontSize: '1.75rem' }}>
                    {currentFte.toFixed(1)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    FTE committed
                  </Typography>
                </Box>
              </Stack>

              {team.length === 0 ? (
                <Alert severity="warning" variant="outlined">
                  Nobody has ever been allocated to this initiative. Budget
                  consumption is calculated from allocations, so it will read as
                  zero regardless of actual spend.
                </Alert>
              ) : (
                // Narrow viewports cannot fit four columns. The table scrolls
                // inside this box rather than clipping, so no column becomes
                // unreachable and the page itself never scrolls sideways.
                <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 460 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell align="right">Commitment</TableCell>
                      <TableCell>Period</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...current, ...past].map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {row.full_name}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {row.employment_type.replace('_', ' ').toLowerCase()}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {row.role_on_initiative ?? '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {Number(row.allocation_percent).toFixed(0)}%
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                            {row.hours_per_week}h/week
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <Typography variant="body2">
                            {formatDate(row.start_date)} – {row.end_date ? formatDate(row.end_date) : 'open'}
                          </Typography>
                          {!row.active_today && (
                            <Chip label="ended" size="small" variant="outlined" sx={{ mt: 0.5 }} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </Box>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                MILESTONES &amp; DELIVERY DATES
              </Typography>

              {finalMilestone && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Final milestone — {finalMilestone.name}
                  </Typography>
                  <Typography variant="h2" sx={{ fontSize: '1.5rem', mt: 0.25 }}>
                    {finalMilestone.actual_date
                      ? `Delivered ${formatDate(finalMilestone.actual_date)}`
                      : `Planned ${formatDate(finalMilestone.planned_date)}`}
                  </Typography>
                </Box>
              )}

              {milestones.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No milestones recorded.
                </Typography>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 460 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Milestone</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Planned</TableCell>
                      <TableCell>Actual</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {milestones.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {row.name}
                          </Typography>
                          {row.depends_on.length > 0 && (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              after {row.depends_on.join(', ')}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusChip
                            role={milestoneRoles[row.health]?.role ?? 'neutral'}
                            label={milestoneRoles[row.health]?.label ?? row.status}
                            dense
                            // A healthy but unfinished milestone shares the
                            // "good" colour with a completed one, so it needs a
                            // different mark - an open circle, not a tick.
                            icon={row.status === 'COMPLETED' ? undefined : RadioButtonUncheckedIcon}
                          />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {formatDate(row.planned_date)}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {formatDate(row.actual_date)}
                          {row.days_variance !== null && row.days_variance !== undefined && (
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                color: row.days_variance > 0 ? 'error.main' : 'text.secondary',
                              }}
                            >
                              {describeVariance(row.days_variance)}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </Box>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

InitiativeDetail.propTypes = {
  /** The selected row from v_initiative_status, or null when closed. */
  initiative: PropTypes.object,
  /** Called when the dialog should close. */
  onClose: PropTypes.func.isRequired,
};
