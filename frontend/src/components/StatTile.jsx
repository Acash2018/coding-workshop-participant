import PropTypes from 'prop-types';
import { Paper, Box, Typography, useTheme } from '@mui/material';
import { statusColor } from '../theme/vizTokens';

/**
 * A single headline number with its label.
 *
 * A handful of these forms the KPI row - the right form for a few unrelated
 * current values, where a grouped bar chart would imply a comparison that does
 * not exist between them.
 *
 * Exactly one tile per view should set `hero`. The value keeps proportional
 * figures: tabular-nums gives every digit the width of a zero, which reads
 * loose at display sizes and is reserved for columns that must align.
 *
 * @param {{label: string, value: string|number, caption?: string,
 *          role?: string, hero?: boolean}} props Component props.
 * @returns {JSX.Element} The rendered tile.
 */
export default function StatTile({ label, value, caption = '', role = null, hero = false }) {
  const theme = useTheme();
  const valueColor = role ? statusColor(role, theme.palette.mode) : theme.palette.text.primary;

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, sm: 2.5 },
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 1,
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{ color: 'text.secondary', textTransform: 'uppercase' }}
      >
        {label}
      </Typography>

      <Box>
        <Typography
          sx={{
            color: valueColor,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            fontSize: hero ? { xs: '2.75rem', sm: '3.25rem' } : { xs: '1.75rem', sm: '2rem' },
          }}
        >
          {value}
        </Typography>
        {caption && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {caption}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

StatTile.propTypes = {
  /** Short uppercase label above the value. */
  label: PropTypes.string.isRequired,
  /** The headline figure. */
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  /** Optional supporting text below the value. */
  caption: PropTypes.string,
  /** Optional status role, tinting the value. Pair with a label that says why. */
  role: PropTypes.oneOf(['good', 'warning', 'serious', 'critical', 'neutral']),
  /** Renders at hero size. Use on at most one tile per view. */
  hero: PropTypes.bool,
};
