import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  InputAdornment, MenuItem, Stack, TextField,
} from '@mui/material';
import initiativesApi from '../api/client';

// COMPLETED is deliberately absent: the database requires a completion date and
// every milestone done, neither of which exists at creation. An initiative is
// created as proposed, active, or on hold, then completed later through its
// status editor.
const STATUS_OPTIONS = [
  { value: 'PROPOSED', label: 'Proposed' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
];

/**
 * Form for creating a new initiative. Admin only.
 *
 * Code, name, department and the planned dates are required; the owner and an
 * opening budget are optional and can be filled in later. The date-order and
 * unique-code rules are enforced by the server, and their messages surface
 * here rather than being re-implemented.
 *
 * @param {{open: boolean, serverDate: string, onClose: Function,
 *          onCreated: Function}} props Component props.
 * @returns {JSX.Element} The rendered dialog.
 */
export default function NewInitiativeDialog({ open, serverDate, onClose, onCreated }) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    department: '',
    description: '',
    status: 'PROPOSED',
    planned_start_date: serverDate,
    planned_end_date: '',
    planned_budget: '',
    owner_employee_id: '',
  });
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm((current) => ({ ...current, planned_start_date: serverDate }));
  }, [serverDate]);

  useEffect(() => {
    if (!open) return;
    initiativesApi.employees().then(setEmployees).catch(() => {});
  }, [open]);

  /**
   * Updates one field of the form.
   *
   * @param {string} field Field name.
   * @returns {Function} An onChange handler for that field.
   */
  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  /**
   * Creates the initiative and hands it back to the caller.
   *
   * @param {React.FormEvent} event The submit event.
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await initiativesApi.create({
        code: form.code,
        name: form.name,
        department: form.department,
        description: form.description || null,
        status: form.status,
        planned_start_date: form.planned_start_date,
        planned_end_date: form.planned_end_date,
        planned_budget: form.planned_budget ? Number(form.planned_budget) : 0,
        owner_employee_id: form.owner_employee_id ? Number(form.owner_employee_id) : null,
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New initiative</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack component="form" id="new-initiative-form" onSubmit={handleSubmit} spacing={2} sx={{ mt: 0.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              required autoFocus size="small" label="Name" sx={{ flex: 2 }}
              value={form.name} onChange={set('name')}
            />
            <TextField
              required size="small" label="Code" sx={{ flex: 1 }}
              value={form.code} onChange={set('code')} placeholder="CC-2027"
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              required size="small" label="Department" sx={{ flex: 1 }}
              value={form.department} onChange={set('department')}
            />
            <TextField
              select size="small" label="Status" sx={{ flex: 1 }}
              value={form.status} onChange={set('status')}
            >
              {STATUS_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              required size="small" type="date" label="Planned start" sx={{ flex: 1 }}
              value={form.planned_start_date} onChange={set('planned_start_date')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              required size="small" type="date" label="Planned end" sx={{ flex: 1 }}
              value={form.planned_end_date} onChange={set('planned_end_date')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              size="small" type="number" label="Planned budget" sx={{ flex: 1 }}
              value={form.planned_budget} onChange={set('planned_budget')}
              slotProps={{
                htmlInput: { min: 0, step: 1000 },
                input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
              }}
            />
            <TextField
              select size="small" label="Owner (optional)" sx={{ flex: 1 }}
              value={form.owner_employee_id} onChange={set('owner_employee_id')}
            >
              <MenuItem value="">Unassigned</MenuItem>
              {employees.map((emp) => (
                <MenuItem key={emp.id} value={emp.id}>{emp.full_name}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            size="small" label="Description (optional)" multiline minRows={2}
            value={form.description} onChange={set('description')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" form="new-initiative-form" variant="contained" disabled={saving}>
          {saving ? 'Creating…' : 'Create initiative'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

NewInitiativeDialog.propTypes = {
  /** Whether the dialog is open. */
  open: PropTypes.bool.isRequired,
  /** The database's today, for defaulting the start date. */
  serverDate: PropTypes.string.isRequired,
  /** Called when the dialog should close. */
  onClose: PropTypes.func.isRequired,
  /** Called with the created initiative. */
  onCreated: PropTypes.func.isRequired,
};
