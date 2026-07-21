/**
 * Visualization design tokens.
 *
 * Values are the validated reference palette: a single sequential blue ramp for
 * magnitude, and a reserved four-role status palette for state. Status colors
 * are never reused as series colors, and never carry meaning without an
 * accompanying icon and label - on the light surface `warning` and `serious`
 * sit below 3:1 contrast by design, so the pairing is the mitigation.
 */

/** Chart surfaces and ink, per mode. */
export const chrome = {
  light: {
    surface: '#fcfcfb',
    plane: '#f9f9f7',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    muted: '#898781',
    gridline: '#e1e0d9',
    baseline: '#c3c2b7',
    successText: '#006300',
    border: 'rgba(11,11,11,0.10)',
  },
  dark: {
    surface: '#1a1a19',
    plane: '#0d0d0d',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    muted: '#898781',
    gridline: '#2c2c2a',
    baseline: '#383835',
    successText: '#0ca30c',
    border: 'rgba(255,255,255,0.10)',
  },
};

/**
 * Status palette. Fixed across modes - these four steps are deliberately
 * distinct from any series color so a status can never impersonate a series.
 */
export const status = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/** Sequential blue ramp, light to dark. Used for magnitude (meters, fills). */
export const sequentialBlue = {
  100: '#cde2fb',
  150: '#b7d3f6',
  200: '#9ec5f4',
  250: '#86b6ef',
  300: '#6da7ec',
  350: '#5598e7',
  400: '#3987e5',
  450: '#2a78d6',
  500: '#256abf',
  550: '#1c5cab',
  600: '#184f95',
  650: '#104281',
  700: '#0d366b',
};

/**
 * Maps a risk_status value from v_initiative_status onto a status role.
 *
 * CLOSED is intentionally not a status color: a finished initiative is not a
 * health state, so it takes muted ink and sits visually behind live work.
 */
export const riskRoles = {
  ON_TRACK: { role: 'good', label: 'On track' },
  AT_RISK: { role: 'warning', label: 'At risk' },
  OVERDUE: { role: 'critical', label: 'Overdue' },
  CLOSED: { role: 'neutral', label: 'Closed' },
};

/** Milestone health roles, sharing the same reserved status palette. */
export const milestoneRoles = {
  COMPLETE_ON_TIME: { role: 'good', label: 'Complete' },
  COMPLETE_LATE: { role: 'good', label: 'Complete (late)' },
  ON_TRACK: { role: 'good', label: 'On track' },
  AT_RISK: { role: 'warning', label: 'At risk' },
  BEHIND: { role: 'serious', label: 'Behind' },
  BLOCKED: { role: 'critical', label: 'Blocked' },
};

/**
 * Resolves a status role name to its hex value for the given mode.
 *
 * @param {string} role One of good, warning, serious, critical, neutral.
 * @param {'light'|'dark'} mode Active color mode.
 * @returns {string} The hex color for that role.
 */
export function statusColor(role, mode) {
  if (role === 'neutral') return chrome[mode].muted;
  return status[role] ?? chrome[mode].muted;
}
