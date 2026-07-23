import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useMediaQuery } from 'react-responsive';
import {
  AppBar, Box, Button, Chip, CircularProgress, Container, CssBaseline,
  IconButton, Stack, Toolbar, Tooltip, Typography,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import buildTheme from './theme/theme';
import Dashboard from './pages/Dashboard';
import LoginPage from './pages/LoginPage';
import { AuthProvider, useAuth } from './auth/AuthContext';

const ROLE_LABELS = {
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Project manager',
  TEAM_LEAD: 'Team lead',
  VIEWER: 'Viewer',
};

/**
 * Application shell.
 *
 * The color mode follows the operating system by default and can be overridden
 * from the toolbar. Both the light and dark step sets are chosen against their
 * own surface rather than one being an automatic inversion of the other.
 *
 * @returns {JSX.Element} The rendered application.
 */
/**
 * The authenticated shell: toolbar, identity, and the dashboard.
 *
 * Rendered only once a session exists, so it can assume a user is present.
 *
 * @param {{mode: string, onToggleMode: Function}} props Component props.
 * @returns {JSX.Element} The signed-in application.
 */
function AppShell({ mode, onToggleMode }) {
  const { user, logout } = useAuth();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="sticky"
        elevation={0}
        color="transparent"
        sx={{
          backdropFilter: 'blur(8px)',
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="body1" sx={{ fontWeight: 700, flexGrow: 1 }}>
            ACME&nbsp;
            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              Initiative Tracker
            </Box>
          </Typography>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                {user.display_name}
              </Typography>
              <Chip
                label={ROLE_LABELS[user.role] ?? user.role}
                size="small"
                variant="outlined"
                sx={{ height: 18, fontSize: '0.68rem' }}
              />
            </Box>

            <Tooltip title={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}>
              <IconButton onClick={onToggleMode} aria-label="Toggle color mode" size="small">
                {mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
              </IconButton>
            </Tooltip>

            <Tooltip title="Sign out">
              <IconButton onClick={logout} aria-label="Sign out" size="small">
                <LogoutOutlinedIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 4 } }}>
        <Dashboard />
      </Container>
    </Box>
  );
}

AppShell.propTypes = {
  mode: PropTypes.oneOf(['light', 'dark']).isRequired,
  onToggleMode: PropTypes.func.isRequired,
};

/**
 * Chooses between the login screen and the app based on session state.
 *
 * @param {{mode: string, onToggleMode: Function}} props Component props.
 * @returns {JSX.Element} Login, a spinner, or the signed-in shell.
 */
function Gate({ mode, onToggleMode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      >
        <CircularProgress />
      </Box>
    );
  }
  if (!user) return <LoginPage />;
  return <AppShell mode={mode} onToggleMode={onToggleMode} />;
}

Gate.propTypes = {
  mode: PropTypes.oneOf(['light', 'dark']).isRequired,
  onToggleMode: PropTypes.func.isRequired,
};

/**
 * Application root: theme, auth provider, and the login/app gate.
 *
 * @returns {JSX.Element} The rendered application.
 */
export default function App() {
  const prefersDark = useMediaQuery({ query: '(prefers-color-scheme: dark)' });
  const [override, setOverride] = useState(null);

  const mode = override ?? (prefersDark ? 'dark' : 'light');
  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Gate mode={mode} onToggleMode={() => setOverride(mode === 'dark' ? 'light' : 'dark')} />
      </AuthProvider>
    </ThemeProvider>
  );
}
