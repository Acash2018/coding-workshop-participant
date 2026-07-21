import PropTypes from 'prop-types';
import { Box, Typography, useTheme } from '@mui/material';
import { statusColor, chrome, riskRoles } from '../theme/vizTokens';

const ORDER = ['OVERDUE', 'AT_RISK', 'ON_TRACK', 'CLOSED'];

/**
 * Portfolio risk mix, drawn as a single horizontal stacked bar.
 *
 * Part-to-whole across a few named classes is a stacked bar's job. It runs
 * horizontally because the class names are words rather than dates, and worst
 * risk sits leftmost so the reader meets the problem first.
 *
 * Segments are separated by a 2px gap in the surface color rather than a
 * border, so adjacent fills stay legible without a stroke competing with the
 * data. Every segment is direct-labeled and repeated in the legend, so the
 * chart never relies on hue alone.
 *
 * @param {{counts: Record<string, number>}} props Component props.
 * @returns {JSX.Element} The rendered distribution.
 */
export default function RiskDistribution({ counts }) {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const ink = chrome[mode];

  const present = ORDER.filter((key) => (counts[key] ?? 0) > 0);
  const total = present.reduce((sum, key) => sum + counts[key], 0);

  if (total === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        No initiatives to summarise yet.
      </Typography>
    );
  }

  return (
    <Box>
      <Box
        sx={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', gap: '2px' }}
        role="img"
        aria-label={present
          .map((key) => `${riskRoles[key].label}: ${counts[key]}`)
          .join(', ')}
      >
        {present.map((key) => (
          <Box
            key={key}
            sx={{
              width: `${(counts[key] / total) * 100}%`,
              backgroundColor: statusColor(riskRoles[key].role, mode),
            }}
          />
        ))}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1.5 }}>
        {ORDER.map((key) => (
          <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '2px',
                flexShrink: 0,
                backgroundColor: statusColor(riskRoles[key].role, mode),
                outline: `1px solid ${ink.border}`,
              }}
            />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {riskRoles[key].label}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: 'text.primary', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
            >
              {counts[key] ?? 0}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

RiskDistribution.propTypes = {
  /** Count of initiatives keyed by risk_status. */
  counts: PropTypes.objectOf(PropTypes.number).isRequired,
};
