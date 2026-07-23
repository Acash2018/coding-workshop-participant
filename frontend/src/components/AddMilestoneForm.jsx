import { useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Box, Button, Checkbox, ListItemText, MenuItem, Stack, TextField,
} from '@mui/material';
import initiativesApi from '../api/client';

/**
 * Admin-only form for adding a milestone to an initiative.
 *
 * A new milestone can declare prerequisites - the milestones that must finish
 * before it can start. That is how the rollout is made to depend on the work
 * ahead of it. Prerequisites here are chosen from this initiative's own
 * milestones; cross-initiative dependencies exist in the model but are out of
 * scope for this form.
 *
 * @param {{initiativeId: number, existing: Array<object>, serverDate: string,
 *          onAdded: Function}} props Component props.
 * @returns {JSX.Element} The rendered form.
 */
export default function AddMilestoneForm({ initiativeId, existing, serverDate, onAdded }) {
  const [name, setName] = useState('');
  const [plannedDate, setPlannedDate] = useState(serverDate);
  const [dependsOn, setDependsOn] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  /**
   * Creates the milestone.
   *
   * @param {React.FormEvent} event The submit event.
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await initiativesApi.addMilestone(initiativeId, {
        name,
        planned_date: plannedDate,
        status: 'NOT_STARTED',
        depends_on: dependsOn,
      });
      setName('');
      setDependsOn([]);
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <TextField
          required size="small" label="Milestone" value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Security review" sx={{ flex: 2, minWidth: 160 }}
        />
        <TextField
          required size="small" type="date" label="Planned" value={plannedDate}
          onChange={(event) => setPlannedDate(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          select size="small" label="Depends on" value={dependsOn}
          onChange={(event) => setDependsOn(event.target.value)}
          sx={{ minWidth: 160 }}
          slotProps={{
            select: {
              multiple: true,
              renderValue: (selected) => (selected.length
                ? `${selected.length} selected`
                : 'None'),
            },
          }}
        >
          {existing.length === 0 && <MenuItem disabled>No other milestones yet</MenuItem>}
          {existing.map((m) => (
            <MenuItem key={m.id} value={m.id}>
              <Checkbox size="small" checked={dependsOn.includes(m.id)} />
              <ListItemText primary={m.name} />
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? 'Adding…' : 'Add milestone'}
        </Button>
      </Stack>
    </Box>
  );
}

AddMilestoneForm.propTypes = {
  /** Initiative to add the milestone to. */
  initiativeId: PropTypes.number.isRequired,
  /** This initiative's existing milestones, offered as prerequisites. */
  existing: PropTypes.arrayOf(PropTypes.object).isRequired,
  /** The database's today, for defaulting the planned date. */
  serverDate: PropTypes.string.isRequired,
  /** Called after a successful add so the list refreshes. */
  onAdded: PropTypes.func.isRequired,
};
