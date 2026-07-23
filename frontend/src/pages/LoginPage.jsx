import { useState } from 'react';
import {
  Alert, Box, Button, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { useAuth } from '../auth/AuthContext';

/**
 * Sign-in screen.
 *
 * Shown whenever there is no valid session. It is the whole viewport rather
 * than a dialog because there is nothing behind it to return to - the rest of
 * the application requires authentication.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Attempts to sign in with the entered credentials.
   *
   * @param {React.FormEvent} event The submit event.
   * @returns {Promise<void>} Resolves once the attempt settles.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Paper elevation={0} sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 400 }}>
        <Typography variant="body1" sx={{ fontWeight: 700, mb: 0.5 }}>
          ACME&nbsp;
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
            Initiative Tracker
          </Box>
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          Sign in to continue.
        </Typography>

        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              required autoFocus size="small" type="email" label="Email"
              value={email} onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
            <TextField
              required size="small" type="password" label="Password"
              value={password} onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            <Button type="submit" variant="contained" size="large" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
