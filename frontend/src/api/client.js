/**
 * HTTP client for the initiative services.
 *
 * All requests go through the API base URL rather than a Lambda URL directly.
 * Locally that is bin/proxy-server.js on :3001, which splits /api/{service} and
 * forwards the remainder; deployed it is CloudFront, which routes /api/{service}*
 * to the matching function. The backend normalises both shapes, so the frontend
 * only ever has to speak one.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const TOKEN_KEY = 'acme.auth.token';

/**
 * Reads the stored bearer token.
 *
 * @returns {string|null} The token, or null when signed out.
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Stores or clears the bearer token.
 *
 * @param {string|null} token The token to keep, or null to sign out.
 * @returns {void}
 */
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Called when a request comes back 401, so the app can drop to the login
// screen from anywhere - a component deep in the tree does not have to know
// how to react to an expired token.
let onUnauthorized = () => {};

/**
 * Registers the handler invoked when any request is rejected as unauthorized.
 *
 * @param {Function} handler Called with no arguments on a 401.
 * @returns {void}
 */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/**
 * Error carrying the HTTP status alongside the server's explanation.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status code.
   * @param {string} message Human-readable detail from the server.
   */
  constructor(statusCode, message) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Extracts a readable message from an error body.
 *
 * FastAPI returns `detail` as a string for raised HTTPExceptions but as an
 * array of per-field objects for request validation failures, so both shapes
 * have to be handled or the UI shows "[object Object]".
 *
 * @param {unknown} body Parsed response body.
 * @param {number} statusCode HTTP status, used for the fallback message.
 * @returns {string} A message suitable for display.
 */
function readError(body, statusCode) {
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.at(-1) : null;
        return field ? `${field}: ${item.msg}` : item.msg;
      })
      .join('; ');
  }
  return `Request failed (${statusCode})`;
}

/**
 * Performs a JSON request against a service endpoint.
 *
 * @param {string} path Path below the API base, e.g. "/initiatives/status".
 * @param {object} [options] Fetch options; `body` is serialised automatically.
 * @returns {Promise<unknown>} The parsed response, or null for 204.
 * @throws {ApiError} When the response status is not ok.
 */
async function request(path, options = {}) {
  const { body, ...rest } = options;
  const token = getToken();

  const response = await fetch(`${BASE_URL}/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...rest,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // An expired or rejected token invalidates the whole session, not just this
  // call - clear it and let the app fall back to the login screen. Login
  // itself is exempt: a 401 there is a wrong password, not a dead session.
  if (response.status === 401 && !path.startsWith('/initiatives/auth/login')) {
    setToken(null);
    onUnauthorized();
  }

  if (response.status === 204) return null;

  const text = await response.text();

  // The body is not always JSON. A Lambda that fails to boot returns the plain
  // string "Internal Server Error", and parsing that blindly throws
  // "Unexpected token 'I'" - which hides the real failure behind a parse error.
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      throw new ApiError(response.status, text.trim() || `Request failed (${response.status})`);
    }
    throw new ApiError(response.status, 'Server returned a malformed response');
  }

  if (!response.ok) {
    throw new ApiError(response.status, readError(parsed, response.status));
  }
  return parsed;
}

/**
 * Builds a query string, omitting empty values so absent filters stay absent.
 *
 * @param {Record<string, unknown>} params Candidate query parameters.
 * @returns {string} A leading-"?" query string, or an empty string.
 */
function toQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const initiativesApi = {
  /**
   * Fetches the portfolio dashboard projection.
   *
   * @param {{riskStatus?: string, department?: string}} [filters] Optional filters.
   * @returns {Promise<Array<object>>} One row per initiative.
   */
  status: (filters = {}) =>
    request(`/initiatives/status${toQuery({
      risk_status: filters.riskStatus,
      department: filters.department,
    })}`),

  /**
   * Lists initiatives with search, filtering and pagination.
   *
   * @param {{q?: string, status?: string, department?: string,
   *          limit?: number, offset?: number}} [params] Query parameters.
   * @returns {Promise<{items: Array<object>, total: number}>} A page of results.
   */
  list: (params = {}) => request(`/initiatives/${toQuery(params)}`),

  /**
   * Lists everyone allocated to an initiative, past and present.
   *
   * @param {number} id Initiative id.
   * @returns {Promise<Array<object>>} Allocations, current ones first.
   */
  team: (id) => request(`/initiatives/${id}/team`),

  /**
   * Lists an initiative's milestones with derived health.
   *
   * @param {number} id Initiative id.
   * @returns {Promise<Array<object>>} Milestones in delivery order.
   */
  milestones: (id) => request(`/initiatives/${id}/milestones`),

  /**
   * Edits a milestone's status or dates.
   *
   * @param {number} id Initiative id.
   * @param {number} milestoneId Milestone to change.
   * @param {object} payload Fields to change.
   * @returns {Promise<object>} The milestone with recomputed health.
   * @throws {ApiError} 400 if marked complete with no actual date.
   */
  updateMilestone: (id, milestoneId, payload) =>
    request(`/initiatives/${id}/milestones/${milestoneId}`, {
      method: 'PATCH',
      body: payload,
    }),

  /**
   * Lists employees with spare capacity during a proposed allocation window.
   *
   * @param {number} id Initiative id.
   * @param {{start: string, end?: string}} window Proposed period.
   * @returns {Promise<Array<object>>} Employees, most headroom first.
   */
  candidates: (id, window) =>
    request(`/initiatives/${id}/candidates${toQuery(window)}`),

  /**
   * Commits an employee to an initiative.
   *
   * @param {number} id Initiative id.
   * @param {object} payload Employee, percentage and period.
   * @returns {Promise<object>} The stored allocation.
   * @throws {ApiError} 409 when the 100% capacity rule would be breached.
   */
  addAllocation: (id, payload) =>
    request(`/initiatives/${id}/allocations`, { method: 'POST', body: payload }),

  /**
   * Changes an existing commitment's percentage, period or role.
   *
   * @param {number} id Initiative id.
   * @param {number} allocationId Allocation to change.
   * @param {object} payload Fields to change.
   * @returns {Promise<object>} The updated allocation.
   * @throws {ApiError} 409 when the change would breach the 100% rule.
   */
  updateAllocation: (id, allocationId, payload) =>
    request(`/initiatives/${id}/allocations/${allocationId}`, {
      method: 'PATCH',
      body: payload,
    }),

  /**
   * Removes an employee's commitment to an initiative.
   *
   * @param {number} id Initiative id.
   * @param {number} allocationId Allocation to remove.
   * @returns {Promise<null>} Resolves once removed.
   */
  removeAllocation: (id, allocationId) =>
    request(`/initiatives/${id}/allocations/${allocationId}`, { method: 'DELETE' }),

  /**
   * Adds a person to the resource pool.
   *
   * @param {object} payload The new employee.
   * @returns {Promise<object>} The stored record.
   * @throws {ApiError} 409 on a duplicate employee number or email.
   */
  createEmployee: (payload) =>
    request('/initiatives/employees', { method: 'POST', body: payload }),

  /**
   * Lists active employees, used to pick an initiative owner.
   *
   * @returns {Promise<Array<object>>} Active employees in name order.
   */
  employees: () => request('/initiatives/employees'),

  /**
   * Lists an initiative's non-labour costs.
   *
   * @param {number} id Initiative id.
   * @returns {Promise<Array<object>>} Recorded costs, most recent first.
   */
  costs: (id) => request(`/initiatives/${id}/costs`),

  /**
   * Records a non-labour cost against an initiative.
   *
   * @param {number} id Initiative id.
   * @param {object} payload The cost.
   * @returns {Promise<object>} The stored record.
   */
  addCost: (id, payload) =>
    request(`/initiatives/${id}/costs`, { method: 'POST', body: payload }),

  /**
   * Removes a recorded cost.
   *
   * @param {number} id Initiative id.
   * @param {number} costId Cost to remove.
   * @returns {Promise<null>} Resolves once removed.
   */
  removeCost: (id, costId) =>
    request(`/initiatives/${id}/costs/${costId}`, { method: 'DELETE' }),

  /**
   * Creates an initiative.
   *
   * @param {object} payload The new initiative.
   * @returns {Promise<object>} The stored record.
   */
  create: (payload) => request('/initiatives/', { method: 'POST', body: payload }),

  /**
   * Applies a partial update.
   *
   * @param {number} id Initiative id.
   * @param {object} payload Fields to change.
   * @returns {Promise<object>} The updated record.
   */
  update: (id, payload) => request(`/initiatives/${id}`, { method: 'PATCH', body: payload }),

  /**
   * Deletes an initiative.
   *
   * @param {number} id Initiative id.
   * @returns {Promise<null>} Resolves once removed.
   */
  remove: (id) => request(`/initiatives/${id}`, { method: 'DELETE' }),

  /**
   * Exchanges credentials for an access token.
   *
   * @param {string} email The account email.
   * @param {string} password The account password.
   * @returns {Promise<object>} Token payload with role and display name.
   */
  login: (email, password) =>
    request('/initiatives/auth/login', { method: 'POST', body: { email, password } }),

  /**
   * Returns the caller described by the stored token, validating it.
   *
   * @returns {Promise<object>} The caller's identity and role.
   */
  me: () => request('/initiatives/auth/me'),

  /**
   * Returns the database's current date, used to align date defaults.
   *
   * @returns {Promise<string>} The server date as an ISO string.
   */
  serverDate: () => request('/initiatives/health').then((h) => h.server_date),

  /**
   * Checks service and database reachability.
   *
   * @returns {Promise<object>} Health payload.
   */
  health: () => request('/initiatives/health'),
};

export default initiativesApi;
