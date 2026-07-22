import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Box, Button, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import initiativesApi from '../api/client';

/** Default allocation window: today through the end of next quarter-ish. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Form for committing an employee to an initiative.
 *
 * Commitment is a percentage of the person's week - 100% is 40 hours. The
 * candidate list is re-fetched whenever the dates change, because spare
 * capacity is a property of the *window*, not of the person: someone free today
 * may be fully booked across the period being proposed.
 *
 * The 100% rule is enforced by a database trigger rather than here. This form
 * shows remaining capacity to make a breach unlikely, but it deliberately does
 * not block submission on its own arithmetic - the database is the authority,
 * and its rejection message names the person, the percentage and the date.
 *
 * @param {{initiativeId: number, onAdded: Function}} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export default function AddAllocationForm({ initiativeId, onAdded }) {
  const [candidates, setCandidates] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [percent, setPercent] = useState('50');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!startDate) return undefined;
    let active = true;
    initiativesApi
      .candidates(initiativeId, { start: startDate, end: endDate || undefined })
      .then((rows) => active && setCandidates(rows))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [initiativeId, startDate, endDate]);

  const selected = candidates.find((row) => row.id === Number(employeeId));
  const requested = Number(percent);
  // A local warning, not a gate. The database has the final say.
  const wouldExceed = selected && requested > Number(selected.available_percent);

  /**
   * Submits the allocation and reports any capacity rejection.
   *
   * @param {React.FormEvent} event The submit event.
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await initiativesApi.addAllocation(initiativeId, {
        employee_id: Number(employeeId),
        allocation_percent: requested,
        start_date: startDate,
        end_date: endDate || null,
        role_on_initiative: role || null,
      });
      setEmployeeId('');
      setRole('');
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={0} component="form" onSubmit={handleSubmit} sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        ADD SOMEONE TO THIS INITIATIVE
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            select
            required
            size="small"
            label="Employee"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            sx={{ flex: 2, minWidth: 200 }}
            helperText={selected ? `${selected.available_hours}h/week free in this window` : ' '}
          >
            {candidates.map((row) => (
              <MenuItem key={row.id} value={row.id} disabled={Number(row.available_percent) <= 0}>
                {row.full_name}
                <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                  {Number(row.available_percent) <= 0
                    ? 'fully committed'
                    : `${Number(row.available_percent).toFixed(0)}% free`}
                  {row.already_on_initiative ? ' · already on this' : ''}
                </Typography>
              </MenuItem>
            ))}
          </TextField>

          <TextField
            required
            size="small"
            type="number"
            label="Commitment %"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            // step must be 1: with min=1 a step of 5 makes the valid ladder
            // 1, 6, 11 ... 81, so an ordinary value like 80 fails native
            // validation and the form silently refuses to submit.
            slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }}
            sx={{ flex: 1, minWidth: 130 }}
            helperText={
              Number.isFinite(requested) && requested > 0
                ? `${((requested / 100) * 40).toFixed(0)}h per week`
                : ' '
            }
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            required
            size="small"
            type="date"
            label="From"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            type="date"
            label="Until"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Leave empty for open ended"
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="e.g. Tech lead"
            sx={{ flex: 1 }}
          />
        </Stack>

        {wouldExceed && (
          <Alert severity="warning" variant="outlined">
            {selected.full_name} has only {Number(selected.available_percent).toFixed(0)}%
            free during this period. Committing {requested}% would take them past
            40 hours a week and will be rejected.
          </Alert>
        )}

        <Box>
          <Button type="submit" variant="contained" disabled={saving || !employeeId}>
            {saving ? 'Adding…' : 'Add to initiative'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

AddAllocationForm.propTypes = {
  /** Initiative being staffed. */
  initiativeId: PropTypes.number.isRequired,
  /** Called after a successful allocation so the parent can refresh. */
  onAdded: PropTypes.func.isRequired,
};
