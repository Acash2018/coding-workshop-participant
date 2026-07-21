import PropTypes from 'prop-types';
import { Box, Typography, useTheme } from '@mui/material';
import { sequentialBlue, statusColor, chrome } from '../theme/vizTokens';

/**
 * A single ratio against a limit, drawn as a same-ramp meter.
 *
 * The track is a light step of the fill's own ramp rather than plain gray, so
 * the bar reads as one object across its whole length. A ratio like "budget
 * consumed" is one number against one limit, which is a meter's job - a
 * two-slice pie or a one-bar chart would both be heavier and less precise.
 *
 * Values above 100% clamp the fill but switch it to the critical status color
 * and surface the real figure in the label, so an overrun cannot hide behind a
 * full bar.
 *
 * @param {{value: number, max?: number, label: string, caption?: string,
 *          height?: number}} props Component props.
 * @returns {JSX.Element} The rendered meter.
 */
export default function Meter({ value, max = 100, label, caption = '', height = 8 }) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const ink = chrome[mode];

  const ratio = max > 0 ? value / max : 0;
  const isOver = ratio > 1;
  const filled = Math.max(0, Math.min(ratio, 1));

  const fill = isOver
    ? statusColor('critical', mode)
    : (mode === 'light' ? sequentialBlue[450] : sequentialBlue[400]);
  const track = mode === 'light' ? sequentialBlue[100] : sequentialBlue[700];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75, gap: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: isOver ? statusColor('critical', mode) : 'text.primary',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {caption}
        </Typography>
      </Box>

      <Box
        role="meter"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        sx={{
          position: 'relative',
          height,
          borderRadius: 999,
          backgroundColor: track,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: `${filled * 100}%`,
            height: '100%',
            backgroundColor: fill,
            // Rounded only on the free end; the filled end stays anchored flush
            // to the baseline so the bar cannot read as floating.
            borderRadius: '0 999px 999px 0',
            transition: 'width 240ms ease',
          }}
        />
        {/* A hairline at the limit, shown only when the bar has run past it. */}
        {isOver && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRight: `2px solid ${ink.surface}`,
              width: `${(1 / ratio) * 100}%`,
            }}
          />
        )}
      </Box>
    </Box>
  );
}

Meter.propTypes = {
  /** The measured value. */
  value: PropTypes.number.isRequired,
  /** The limit the value is measured against. */
  max: PropTypes.number,
  /** Accessible name, shown to the left of the bar. */
  label: PropTypes.string.isRequired,
  /** Formatted figure shown to the right of the bar. */
  caption: PropTypes.string,
  /** Bar thickness in pixels. */
  height: PropTypes.number,
};
