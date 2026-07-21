import PropTypes from 'prop-types';
import { Box, Typography, useTheme } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import BlockIcon from '@mui/icons-material/Block';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined';
import { statusColor } from '../theme/vizTokens';

const ICONS = {
  good: CheckCircleIcon,
  warning: WarningAmberIcon,
  serious: ErrorOutlineIcon,
  critical: BlockIcon,
  neutral: RemoveCircleOutlineIcon,
};

/**
 * A status indicator that pairs a reserved status color with an icon and label.
 *
 * The icon is not decoration. Two of the four status steps sit below 3:1
 * contrast on the light surface, and status hues are close enough to some
 * series hues that color alone cannot be trusted - so shape and text carry the
 * meaning and color reinforces it.
 *
 * @param {{role: string, label: string, dense?: boolean}} props Component props.
 * @returns {JSX.Element} The rendered indicator.
 */
export default function StatusChip({ role, label, dense = false }) {
  const theme = useTheme();
  const color = statusColor(role, theme.palette.mode);
  const Icon = ICONS[role] ?? RemoveCircleOutlineIcon;

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon aria-hidden sx={{ color, fontSize: dense ? 16 : 18 }} />
      <Typography
        component="span"
        variant={dense ? 'caption' : 'body2'}
        sx={{ color: 'text.primary', fontWeight: 500 }}
      >
        {label}
      </Typography>
    </Box>
  );
}

StatusChip.propTypes = {
  /** Status role: good, warning, serious, critical or neutral. */
  role: PropTypes.oneOf(['good', 'warning', 'serious', 'critical', 'neutral']).isRequired,
  /** Visible text. Never omit - color must not carry meaning alone. */
  label: PropTypes.string.isRequired,
  /** Renders at a smaller size for use inside table rows. */
  dense: PropTypes.bool,
};
