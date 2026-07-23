import { useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Box, Button, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import initiativesApi from '../api/client';

const STATUS_OPTIONS = [
  { value: 'PROPOSED', label: 'Proposed' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/**
 * Lets a manager change an initiative's lifecycle status.
 *
 * Completing an initiative has two requirements the database enforces: every
 * milestone must already be complete, and a completion date must be recorded.
 * The date field appears the moment COMPLETED is chosen (defaulted to the
 * server's today), and the "all milestones complete" rule surfaces as a clear
 * message from the server rather than being duplicated here - the database is
 * the single source of that truth.
 *
 * @param {{initiative: object, serverDate: string,
 *          onSaved: Function}} props Component props.
 * @returns {JSX.Element} The rendered editor.
 */
export default function StatusEditor({ initiative, serverDate, onSaved }) {
  const [status, setStatus] = useState(initiative.status);
  const [actualEnd, setActualEnd] = useState(serverDate);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const completing = status === 'COMPLETED';
  const dirty = status !== initiative.status;

  /**
   * Persists the status change.
   *
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = { status };
      // A completed initiative must carry an end date; send it only then, so a
      // move to any other status does not stamp one.
      if (completing) payload.actual_end_date = actualEnd;
      await initiativesApi.update(initiative.id, payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        STATUS
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <TextField
          select size="small" label="Lifecycle status" value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 170 }}
        >
          {STATUS_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </TextField>

        {completing && (
          <TextField
            required size="small" type="date" label="Completed on" value={actualEnd}
            onChange={(event) => setActualEnd(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        )}

        <Button
          variant="contained" onClick={handleSave}
          disabled={!dirty || saving || (completing && !actualEnd)}
        >
          {saving ? 'Saving…' : 'Update status'}
        </Button>
      </Stack>

      {completing && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          Every milestone, including rollout, must be complete before this can be saved.
        </Typography>
      )}
    </Box>
  );
}

StatusEditor.propTypes = {
  /** The selected initiative row. */
  initiative: PropTypes.object.isRequired,
  /** The database's today, for defaulting the completion date. */
  serverDate: PropTypes.string.isRequired,
  /** Called after a successful change so the portfolio refreshes. */
  onSaved: PropTypes.func.isRequired,
};
