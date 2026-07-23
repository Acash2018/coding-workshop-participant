import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useMediaQuery } from 'react-responsive';
import {
  Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Divider, IconButton,
  Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import initiativesApi from '../api/client';
import { useAuth } from '../auth/AuthContext';
import StatusChip from './StatusChip';
import AddAllocationForm from './AddAllocationForm';
import AllocationRow from './AllocationRow';
import MilestoneRow from './MilestoneRow';
import AddMilestoneForm from './AddMilestoneForm';
import BudgetEditor from './BudgetEditor';
import CostsPanel from './CostsPanel';
import StatusEditor from './StatusEditor';
import { riskRoles } from '../theme/vizTokens';

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
 * Orders milestones so each one appears after the milestones it depends on.
 *
 * A stable topological sort: rows are emitted in the server's order
 * (sequence_no, then planned date), except a milestone is held back until
 * every prerequisite that also belongs to this initiative has been emitted.
 * Prerequisites on other initiatives are not in this list, so they place no
 * constraint here. A dependency cycle - which the API prevents - degrades to
 * the server order rather than dropping any row.
 *
 * @param {Array<object>} rows Milestones, each with id and depends_on_ids.
 * @returns {Array<object>} The same rows, dependency-ordered.
 */
function orderByDependency(rows) {
  const present = new Set(rows.map((row) => row.id));
  const emitted = new Set();
  const ordered = [];

  // Repeatedly emit every row whose in-list prerequisites are all satisfied,
  // scanning in server order each pass so ties keep that order. Passes repeat
  // until one adds nothing, which means either we are done or a cycle remains.
  let progressed = true;
  while (ordered.length < rows.length && progressed) {
    progressed = false;
    rows.forEach((row) => {
      if (emitted.has(row.id)) return;
      const ready = (row.depends_on_ids ?? [])
        .every((id) => !present.has(id) || emitted.has(id));
      if (ready) {
        ordered.push(row);
        emitted.add(row.id);
        progressed = true;
      }
    });
  }

  // Append anything a cycle left behind, so nothing silently disappears.
  rows.forEach((row) => {
    if (!emitted.has(row.id)) ordered.push(row);
  });
  return ordered;
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
export default function InitiativeDetail({ initiative, onClose, onChanged }) {
  const isNarrow = useMediaQuery({ maxWidth: 899 });
  const { canManage, canStaff, isAdmin } = useAuth();
  const [team, setTeam] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [serverDate, setServerDate] = useState('');
  // Bumped after a write so the team list refetches without remounting.
  const [version, setVersion] = useState(0);

  // The completion date defaults to the database's today, not the browser's.
  useEffect(() => {
    initiativesApi.serverDate().then(setServerDate).catch(() => {});
  }, []);

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
  }, [initiative, version]);

  /**
   * Refreshes this dialog and the portfolio behind it after a write.
   *
   * Budget consumption is derived from allocations, so adding or removing a
   * person changes figures on the dashboard too - refreshing only the dialog
   * would leave the two disagreeing.
   *
   * @returns {void}
   */
  const handleChanged = () => {
    setVersion((n) => n + 1);
    onChanged();
  };

  /**
   * Deletes the whole initiative after confirming intent. Admin only.
   *
   * The cascade takes its milestones, allocations and costs with it, so this is
   * gated behind a confirm. On success the portfolio behind the dialog is
   * refreshed and the dialog closes, since the record it described is gone.
   *
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleDelete = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      `Delete initiative "${initiative.name}"? This also removes its `
      + 'milestones, allocations and costs, and cannot be undone.',
    )) return;
    setDeleting(true);
    setError(null);
    try {
      await initiativesApi.remove(initiative.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  if (!initiative) return null;

  // Three groups, not two: an allocation that has not started yet is upcoming,
  // not past. Ordered current, then upcoming, then ended.
  const current = team.filter((row) => row.active_today);
  const upcoming = team.filter((row) => !row.active_today && row.upcoming);
  const past = team.filter((row) => !row.active_today && !row.upcoming);
  const orderedTeam = [...current, ...upcoming, ...past];

  const fte = (rows) => rows.reduce(
    (sum, row) => sum + Number(row.allocation_percent) / 100, 0,
  );
  // FTE committed is today's commitment, matching the dashboard tile. Upcoming
  // work is surfaced separately so adding someone who starts later still gives
  // visible feedback rather than appearing to do nothing.
  const currentFte = fte(current);
  const upcomingFte = fte(upcoming);
  // Milestones read in dependency order, so each sits below the work it
  // depends on rather than in raw sequence order.
  const orderedMilestones = orderByDependency(milestones);
  // The delivery date a stakeholder actually asks about is the last milestone,
  // not the initiative's planned_end_date - those can differ. In dependency
  // order the final row is the one nothing else waits on.
  const finalMilestone = orderedMilestones[orderedMilestones.length - 1];

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
                    {upcomingFte > 0 && (
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        {' '}(+{upcomingFte.toFixed(1)} upcoming)
                      </Box>
                    )}
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
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orderedTeam.map((row) => (
                      <AllocationRow
                        key={row.id}
                        row={row}
                        initiativeId={initiative.id}
                        onChanged={handleChanged}
                        editable={canStaff}
                      />
                    ))}
                  </TableBody>
                </Table>
                </Box>
              )}

              {/* Staffing controls are shown only to roles that may use them.
                  The backend enforces this regardless; hiding them avoids
                  offering a button that would 403. */}
              {canStaff && (
                <Box sx={{ mt: 2 }}>
                  <AddAllocationForm
                    initiativeId={initiative.id}
                    onAdded={handleChanged}
                    refreshKey={version}
                  />
                </Box>
              )}
            </Box>

            <Divider />

            <BudgetEditor
              initiative={initiative}
              onSaved={handleChanged}
              editable={canManage}
            />

            <Divider />

            <CostsPanel
              initiativeId={initiative.id}
              serverDate={serverDate}
              canManage={canManage}
              onChanged={handleChanged}
            />

            {canManage && (
              <>
                <Divider />
                <StatusEditor
                  initiative={initiative}
                  serverDate={serverDate}
                  onSaved={handleChanged}
                />
              </>
            )}

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
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orderedMilestones.map((row) => (
                      <MilestoneRow
                        key={row.id}
                        row={row}
                        initiativeId={initiative.id}
                        onChanged={handleChanged}
                        editable={canManage}
                        deletable={isAdmin}
                      />
                    ))}
                  </TableBody>
                </Table>
                </Box>
              )}

              {isAdmin && (
                <AddMilestoneForm
                  initiativeId={initiative.id}
                  existing={milestones}
                  serverDate={serverDate}
                  onAdded={handleChanged}
                />
              )}
            </Box>

            {/* Deleting a whole initiative is an administrative act and
                irreversible, so it is admin-only and set apart from the
                editing controls above. The server enforces the role too. */}
            {isAdmin && (
              <>
                <Divider />
                <Box>
                  <Button
                    color="error"
                    variant="outlined"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Delete initiative'}
                  </Button>
                  <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                    Removes this initiative and all its milestones, allocations
                    and costs. This cannot be undone.
                  </Typography>
                </Box>
              </>
            )}
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
  /** Called after a write, so the portfolio behind the dialog can refresh. */
  onChanged: PropTypes.func.isRequired,
};
