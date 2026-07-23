import { useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Box, IconButton, MenuItem, Stack, TableCell, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import initiativesApi from '../api/client';
import StatusChip from './StatusChip';
import { milestoneRoles } from '../theme/vizTokens';

const STATUS_OPTIONS = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'STARTED', label: 'Started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'COMPLETED', label: 'Completed' },
];

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
 * One milestone, editable in place by a manager.
 *
 * Status and both dates are editable because that is what a delivery review
 * revises. Marking a milestone completed requires an actual date; the field
 * appears the moment COMPLETED is chosen, and the server rejects the change
 * otherwise, so the two never disagree.
 *
 * @param {{row: object, initiativeId: number, onChanged: Function,
 *          editable?: boolean}} props Component props.
 * @returns {JSX.Element} The rendered row.
 */
export default function MilestoneRow({ row, initiativeId, onChanged, editable = true }) {
  const [editing, setEditing] = useState(false);
  const [statusValue, setStatusValue] = useState(row.status);
  const [plannedDate, setPlannedDate] = useState(row.planned_date ?? '');
  const [actualDate, setActualDate] = useState(row.actual_date ?? '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const completing = statusValue === 'COMPLETED';

  /**
   * Persists the edited milestone.
   *
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await initiativesApi.updateMilestone(initiativeId, row.id, {
        status: statusValue,
        planned_date: plannedDate,
        actual_date: actualDate || null,
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
    setStatusValue(row.status);
    setPlannedDate(row.planned_date ?? '');
    setActualDate(row.actual_date ?? '');
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <TableRow>
        <TableCell>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
        </TableCell>
        <TableCell>
          <TextField
            select size="small" value={statusValue}
            onChange={(event) => setStatusValue(event.target.value)}
            sx={{ minWidth: 140 }}
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </TextField>
        </TableCell>
        <TableCell>
          <TextField
            size="small" type="date" label="Planned" value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </TableCell>
        <TableCell>
          <TextField
            size="small" type="date" label="Actual" value={actualDate}
            onChange={(event) => setActualDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            required={completing}
            helperText={completing && !actualDate ? 'Required to complete' : ' '}
          />
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Tooltip title="Save">
              <span>
                <IconButton
                  size="small" onClick={handleSave}
                  disabled={saving || (completing && !actualDate)}
                  aria-label="Save milestone"
                >
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
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
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
          icon={row.status === 'COMPLETED' ? undefined : RadioButtonUncheckedIcon}
        />
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(row.planned_date)}</TableCell>
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
      <TableCell align="right">
        {editable && (
          <Tooltip title="Edit status and dates">
            <IconButton
              size="small" onClick={() => setEditing(true)}
              aria-label={`Edit ${row.name}`}
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
}

MilestoneRow.propTypes = {
  /** One row from the milestones endpoint. */
  row: PropTypes.object.isRequired,
  /** Initiative the milestone belongs to. */
  initiativeId: PropTypes.number.isRequired,
  /** Called after a successful edit so health and dates refresh. */
  onChanged: PropTypes.func.isRequired,
  /** Whether to show the edit control. */
  editable: PropTypes.bool,
};
