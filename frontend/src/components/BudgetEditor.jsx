import { useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import initiativesApi from '../api/client';
import Meter from './Meter';

/**
 * Formats an amount as whole currency.
 *
 * @param {number} value The amount.
 * @returns {string} Formatted currency, no decimal places.
 */
function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Displays planned budget against consumption, and allows editing the plan.
 *
 * Only the *planned* figure is editable. Consumption is derived from
 * allocations at the standard rate, so it is a consequence of who is committed
 * and for how long - editing it directly would let the two disagree.
 *
 * @param {{initiative: object, onSaved: Function}} props Component props.
 * @returns {JSX.Element} The rendered panel.
 */
export default function BudgetEditor({ initiative, onSaved, editable = true }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(initiative.planned_budget ?? ''));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const consumedPercent = Number(initiative.percent_consumed ?? 0);
  const planned = Number(initiative.planned_budget ?? 0);
  // Read the absolute figure rather than multiplying the percentage back out,
  // which would compound rounding and read as zero whenever the plan is zero.
  const consumed = Number(initiative.total_consumed ?? 0);

  /**
   * Persists the new planned budget.
   *
   * @param {React.FormEvent} event The submit event.
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await initiativesApi.update(initiative.id, { planned_budget: Number(value) });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
          BUDGET
        </Typography>
        {!editing && editable && (
          <Tooltip title="Edit planned budget">
            <IconButton size="small" onClick={() => setEditing(true)} aria-label="Edit planned budget">
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {editing ? (
        <Box component="form" onSubmit={handleSubmit}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <TextField
              required
              autoFocus
              size="small"
              type="number"
              label="Planned budget"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              slotProps={{
                htmlInput: { min: 0, step: 1000 },
                input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
              }}
              helperText="Consumption is calculated from allocations at $100/hr"
            />
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              onClick={() => {
                setValue(String(initiative.planned_budget ?? ''));
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </Stack>
        </Box>
      ) : (
        <Box>
          <Stack direction="row" spacing={3} sx={{ mb: 1.5 }}>
            <Box>
              <Typography variant="h2" sx={{ fontSize: '1.75rem' }}>
                {money(planned)}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                planned
              </Typography>
            </Box>
            <Box>
              <Typography variant="h2" sx={{ fontSize: '1.75rem' }}>
                {money(consumed)}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                consumed to date
              </Typography>
            </Box>
          </Stack>
          <Meter
            label="Consumed against plan"
            value={consumedPercent}
            caption={`${consumedPercent.toFixed(0)}%`}
          />
          {initiative.forecast_overrun && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
              Committed allocations project spend beyond the planned budget
              before this initiative ends.
            </Alert>
          )}
        </Box>
      )}
    </Box>
  );
}

BudgetEditor.propTypes = {
  /** The selected row from v_initiative_status. */
  initiative: PropTypes.object.isRequired,
  /** Called after a successful save so the parent can refresh. */
  onSaved: PropTypes.func.isRequired,
  /** Whether to show the edit control. */
  editable: PropTypes.bool,
};
