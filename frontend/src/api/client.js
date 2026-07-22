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

  const response = await fetch(`${BASE_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...rest,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

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
   * Checks service and database reachability.
   *
   * @returns {Promise<object>} Health payload.
   */
  health: () => request('/initiatives/health'),
};

export default initiativesApi;
