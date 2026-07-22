import { useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField,
} from '@mui/material';
import initiativesApi from '../api/client';

const EMPLOYMENT_TYPES = [
  { value: 'FULL_TIME', label: 'Full time' },
  { value: 'PART_TIME', label: 'Part time' },
  { value: 'CONTRACTOR', label: 'Contractor' },
];

/**
 * Form for adding a person to the resource pool.
 *
 * Weekly capacity is captured explicitly because 100% commitment means
 * different things for different people - a part-timer at 100% is committed to
 * their own week, not a 40-hour one. Every capacity and budget figure in the
 * application derives from this number.
 *
 * @param {{open: boolean, onClose: Function, onCreated: Function}} props Props.
 * @returns {JSX.Element} The rendered dialog.
 */
export default function NewEmployeeDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    employee_number: '',
    full_name: '',
    email: '',
    department: '',
    job_title: '',
    employment_type: 'FULL_TIME',
    weekly_capacity_hours: '40',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  /**
   * Updates one field of the form.
   *
   * @param {string} field Field name.
   * @returns {Function} An onChange handler for that field.
   */
  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  /**
   * Creates the employee and hands the new record to the caller.
   *
   * @param {React.FormEvent} event The submit event.
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await initiativesApi.createEmployee({
        ...form,
        job_title: form.job_title || null,
        weekly_capacity_hours: Number(form.weekly_capacity_hours),
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
      <DialogTitle>Add a new employee</DialogTitle>
      {/* A real <form> element, not DialogContent with component="form":
          DialogContent silently ignores the component prop and renders a div,
          so the submit button's form="..." reference would point at a div and
          the dialog would never submit. */}
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack component="form" id="new-employee-form" onSubmit={handleSubmit} spacing={2} sx={{ mt: 0.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              required autoFocus size="small" label="Full name" sx={{ flex: 2 }}
              value={form.full_name} onChange={set('full_name')}
            />
            <TextField
              required size="small" label="Employee number" sx={{ flex: 1 }}
              value={form.employee_number} onChange={set('employee_number')}
              placeholder="E006"
            />
          </Stack>
          <TextField
            required size="small" type="email" label="Email"
            value={form.email} onChange={set('email')}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              required size="small" label="Department" sx={{ flex: 1 }}
              value={form.department} onChange={set('department')}
            />
            <TextField
              size="small" label="Job title" sx={{ flex: 1 }}
              value={form.job_title} onChange={set('job_title')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select size="small" label="Employment type" sx={{ flex: 1 }}
              value={form.employment_type} onChange={set('employment_type')}
            >
              {EMPLOYMENT_TYPES.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              required size="small" type="number" label="Hours per week" sx={{ flex: 1 }}
              value={form.weekly_capacity_hours} onChange={set('weekly_capacity_hours')}
              slotProps={{ htmlInput: { min: 1, max: 60, step: 1 } }}
              helperText="What 100% commitment means for this person"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" form="new-employee-form" variant="contained" disabled={saving}>
          {saving ? 'Adding…' : 'Add employee'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

NewEmployeeDialog.propTypes = {
  /** Whether the dialog is open. */
  open: PropTypes.bool.isRequired,
  /** Called when the dialog should close. */
  onClose: PropTypes.func.isRequired,
  /** Called with the created employee so the caller can select them. */
  onCreated: PropTypes.func.isRequired,
};
