import { createTheme } from '@mui/material/styles';
import { chrome, sequentialBlue } from './vizTokens';

/**
 * Builds the Material UI theme for a color mode.
 *
 * Surfaces, ink and hairlines come from the same tokens the charts use, so a
 * meter fill and the card it sits on are guaranteed to agree.
 *
 * @param {'light'|'dark'} mode Active color mode.
 * @returns {import('@mui/material/styles').Theme} The configured theme.
 */
export default function buildTheme(mode) {
  const ink = chrome[mode];

  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? sequentialBlue[450] : sequentialBlue[400] },
      background: { default: ink.plane, paper: ink.surface },
      text: { primary: ink.textPrimary, secondary: ink.textSecondary },
      divider: ink.border,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      // Large standalone numbers keep proportional figures; tabular-nums is
      // applied only to table columns that must align vertically.
      h1: { fontSize: '3rem', fontWeight: 600, letterSpacing: '-0.02em' },
      h2: { fontSize: '1.5rem', fontWeight: 600 },
      subtitle2: { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em' },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none', border: `1px solid ${ink.border}` },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: ink.gridline },
          head: { color: ink.muted, fontWeight: 600, whiteSpace: 'nowrap' },
        },
      },
    },
  });
}
