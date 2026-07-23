import {
  createContext, useContext, useEffect, useMemo, useState,
} from 'react';
import PropTypes from 'prop-types';
import initiativesApi, { getToken, setToken, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);

// Which roles may perform each kind of write. Mirrors the backend guards in
// core/security.py - the server enforces these, the client uses them only to
// hide controls a user cannot use, so the UI never dangles a button that 403s.
const MANAGERS = ['ADMIN', 'PROJECT_MANAGER'];
const STAFFERS = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEAD'];

/**
 * Provides the signed-in user and auth actions to the tree.
 *
 * On mount it validates any stored token against /auth/me rather than trusting
 * it blindly, so a token that expired while the tab was closed drops straight
 * to the login screen instead of letting the dashboard load and then fail.
 *
 * @param {{children: React.ReactNode}} props Component props.
 * @returns {JSX.Element} The provider.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Any 401 from anywhere clears the session.
    setUnauthorizedHandler(() => setUser(null));

    if (!getToken()) {
      setLoading(false);
      return;
    }
    initiativesApi
      .me()
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,

    /**
     * Signs in and stores the resulting token.
     *
     * @param {string} email Account email.
     * @param {string} password Account password.
     * @returns {Promise<void>} Resolves once signed in.
     */
    login: async (email, password) => {
      const result = await initiativesApi.login(email, password);
      setToken(result.access_token);
      setUser({
        email,
        role: result.role,
        display_name: result.display_name,
      });
    },

    /**
     * Signs out and clears the stored token.
     *
     * @returns {void}
     */
    logout: () => {
      setToken(null);
      setUser(null);
    },

    /** Whether the current user is an administrator. */
    isAdmin: !!user && user.role === 'ADMIN',
    /** Whether the current user may edit initiatives, budgets and costs. */
    canManage: !!user && MANAGERS.includes(user.role),
    /** Whether the current user may add, edit or remove allocations. */
    canStaff: !!user && STAFFERS.includes(user.role),
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = {
  /** The subtree that consumes auth state. */
  children: PropTypes.node.isRequired,
};

/**
 * Reads the auth context.
 *
 * @returns {object} The current user and auth actions.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
