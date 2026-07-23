import { useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Box, Chip, IconButton, Stack, TableCell, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import initiativesApi from '../api/client';

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
 * One person's commitment to an initiative, editable in place.
 *
 * Percentage and period are both editable because they answer different
 * questions: how much of someone's week this takes, and for how long. Changing
 * either can breach the 100% rule, so both go back through the database and a
 * rejection is shown against this row rather than as a page-level error.
 *
 * @param {{row: object, initiativeId: number, onChanged: Function}} props Props.
 * @returns {JSX.Element} The rendered row.
 */
export default function AllocationRow({ row, initiativeId, onChanged, editable = true }) {
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState(String(Number(row.allocation_percent)));
  const [startDate, setStartDate] = useState(row.start_date ?? '');
  const [endDate, setEndDate] = useState(row.end_date ?? '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  /**
   * Persists the edited commitment.
   *
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await initiativesApi.updateAllocation(initiativeId, row.id, {
        allocation_percent: Number(percent),
        start_date: startDate,
        end_date: endDate || null,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Discards edits and restores the stored values.
   *
   * @returns {void}
   */
  const handleCancel = () => {
    setPercent(String(Number(row.allocation_percent)));
    setStartDate(row.start_date ?? '');
    setEndDate(row.end_date ?? '');
    setError(null);
    setEditing(false);
  };

  /**
   * Removes this commitment after confirming intent.
   *
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleRemove = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove ${row.full_name} from this initiative?`)) return;
    try {
      await initiativesApi.removeAllocation(initiativeId, row.id);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  if (editing) {
    return (
      <TableRow>
        <TableCell>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.full_name}</Typography>
        </TableCell>
        <TableCell sx={{ color: 'text.secondary' }}>{row.role_on_initiative ?? '—'}</TableCell>
        <TableCell align="right">
          <TextField
            size="small" type="number" value={percent}
            onChange={(event) => setPercent(event.target.value)}
            slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }}
            sx={{ width: 90 }}
          />
        </TableCell>
        <TableCell>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small" type="date" label="From" value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small" type="date" label="Until" value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Empty = open ended"
            />
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Tooltip title="Save">
              <span>
                <IconButton size="small" onClick={handleSave} disabled={saving} aria-label="Save changes">
                  <CheckIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Cancel">
              <IconButton size="small" onClick={handleCancel} aria-label="Cancel editing">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.full_name}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {row.employment_type.replace('_', ' ').toLowerCase()}
        </Typography>
      </TableCell>
      <TableCell sx={{ color: 'text.secondary' }}>{row.role_on_initiative ?? '—'}</TableCell>
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
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </TableCell>
      <TableCell align="right">
        {editable && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Tooltip title="Edit commitment and dates">
              <IconButton
                size="small" onClick={() => setEditing(true)}
                aria-label={`Edit ${row.full_name}'s commitment`}
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Remove from initiative">
              <IconButton
                size="small" onClick={handleRemove}
                aria-label={`Remove ${row.full_name} from this initiative`}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </TableCell>
    </TableRow>
  );
}

AllocationRow.propTypes = {
  /** One row from the team endpoint. */
  row: PropTypes.object.isRequired,
  /** Initiative the allocation belongs to. */
  initiativeId: PropTypes.number.isRequired,
  /** Called after a successful write so capacity everywhere refreshes. */
  onChanged: PropTypes.func.isRequired,
  /** Whether to show the edit and remove controls. */
  editable: PropTypes.bool,
};
