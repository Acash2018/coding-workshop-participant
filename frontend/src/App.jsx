import { useMemo, useState } from 'react';
import { useMediaQuery } from 'react-responsive';
import {
  AppBar, Box, Container, CssBaseline, IconButton, Toolbar, Tooltip, Typography,
} from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import buildTheme from './theme/theme';
import Dashboard from './pages/Dashboard';

/**
 * Application shell.
 *
 * The color mode follows the operating system by default and can be overridden
 * from the toolbar. Both the light and dark step sets are chosen against their
 * own surface rather than one being an automatic inversion of the other.
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

            <Tooltip title={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}>
              <IconButton
                onClick={() => setOverride(mode === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle color mode"
                size="small"
              >
                {mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 4 } }}>
          <Dashboard />
        </Container>
      </Box>
    </ThemeProvider>
  );
}
