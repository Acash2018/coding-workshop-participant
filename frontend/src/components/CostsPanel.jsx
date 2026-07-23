import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Box, Button, IconButton, InputAdornment, MenuItem, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import initiativesApi from '../api/client';

const CATEGORIES = [
  { value: 'SOFTWARE_LICENSE', label: 'Software licence' },
  { value: 'HARDWARE', label: 'Hardware' },
  { value: 'TRAVEL', label: 'Travel' },
  { value: 'TRAINING', label: 'Training' },
  { value: 'OTHER', label: 'Other' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

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
 * Lists and manages an initiative's non-labour costs.
 *
 * These are the expenses that are not people - licences, hardware, travel. They
 * feed the same consumed-budget figure that labour does, so adding one here
 * moves the budget meter above. A cost dated in the future is recorded but does
 * not count as consumed until its date arrives, mirroring how elapsed labour is
 * measured.
 *
 * @param {{initiativeId: number, serverDate: string, canManage: boolean,
 *          onChanged: Function}} props Component props.
 * @returns {JSX.Element} The rendered panel.
 */
export default function CostsPanel({ initiativeId, serverDate, canManage, onChanged }) {
  const [costs, setCosts] = useState([]);
  const [category, setCategory] = useState('SOFTWARE_LICENSE');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(serverDate);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setIncurredOn(serverDate || ''), [serverDate]);

  useEffect(() => {
    let active = true;
    initiativesApi.costs(initiativeId)
      .then((rows) => active && setCosts(rows))
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [initiativeId]);

  const total = costs.reduce((sum, row) => sum + Number(row.amount), 0);

  /**
   * Reloads the cost list and notifies the parent so the budget refreshes.
   *
   * @returns {Promise<void>} Resolves once reloaded.
   */
  const refresh = async () => {
    setCosts(await initiativesApi.costs(initiativeId));
    onChanged();
  };

  /**
   * Records a new cost.
   *
   * @param {React.FormEvent} event The submit event.
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleAdd = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await initiativesApi.addCost(initiativeId, {
        category,
        description,
        amount: Number(amount),
        incurred_on: incurredOn,
      });
      setDescription('');
      setAmount('');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Removes a cost after confirming intent.
   *
   * @param {object} row The cost to remove.
   * @returns {Promise<void>} Resolves once the request settles.
   */
  const handleRemove = async (row) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${row.description}"?`)) return;
    try {
      await initiativesApi.removeCost(initiativeId, row.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
          NON-LABOUR COSTS
        </Typography>
        {costs.length > 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            · {money(total)} total
          </Typography>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      {costs.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          No licences, hardware or other costs recorded yet.
        </Typography>
      ) : (
        <Box sx={{ overflowX: 'auto', mb: 2 }}>
          <Table size="small" sx={{ minWidth: 420 }}>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Date</TableCell>
                {canManage && <TableCell align="right" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {costs.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {row.description}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {CATEGORY_LABEL[row.category] ?? row.category}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {money(Number(row.amount))}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(row.incurred_on)}</TableCell>
                  {canManage && (
                    <TableCell align="right">
                      <Tooltip title="Remove cost">
                        <IconButton
                          size="small" onClick={() => handleRemove(row)}
                          aria-label={`Remove ${row.description}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {canManage && (
        <Box component="form" onSubmit={handleAdd}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <TextField
              required size="small" label="Item" value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. Fraud detection SDK" sx={{ flex: 2, minWidth: 160 }}
            />
            <TextField
              select size="small" label="Category" value={category}
              onChange={(event) => setCategory(event.target.value)} sx={{ minWidth: 150 }}
            >
              {CATEGORIES.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              required size="small" type="number" label="Amount" value={amount}
              onChange={(event) => setAmount(event.target.value)}
              slotProps={{
                htmlInput: { min: 0, step: 100 },
                input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
              }}
              sx={{ minWidth: 130 }}
            />
            <TextField
              required size="small" type="date" label="Date" value={incurredOn}
              onChange={(event) => setIncurredOn(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Adding…' : 'Add cost'}
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

CostsPanel.propTypes = {
  /** Initiative these costs belong to. */
  initiativeId: PropTypes.number.isRequired,
  /** The database's today, for defaulting the cost date. */
  serverDate: PropTypes.string.isRequired,
  /** Whether the current user may add or remove costs. */
  canManage: PropTypes.bool.isRequired,
  /** Called after a change so the budget above refreshes. */
  onChanged: PropTypes.func.isRequired,
};
