import type { Tokens } from "./tokens";

// "rejected": the server refused the refresh token (401): the session is over. Anything else that
// goes wrong (no answer, a server error) is thrown instead, because it says nothing about the session.
export type RefreshResult = { kind: "ok"; tokens: Tokens } | { kind: "rejected" };

export type AuthFetchDeps = {
  baseFetch: (request: Request) => Promise<Response>;
  loadTokens: () => Promise<Tokens | null>;
  saveTokens: (tokens: Tokens) => Promise<void>;
  clearTokens: () => Promise<void>;
  refreshTokens: (refreshToken: string) => Promise<RefreshResult>;
  onSessionExpired: () => void;
};

// A 401 on these is an answer, not an expired token (a wrong password, a spent refresh token).
const NEVER_REFRESH = ["/auth/login", "/auth/refresh", "/auth/logout"];

// The calls that are not about one studio: no `X-Tenant-Id` on them.
const NO_TENANT = (path: string) => path.startsWith("/auth/") || path === "/me" || path === "/health";

/**
 * A `fetch` that signs requests with the access token and, when the server answers 401, trades the
 * refresh token for new tokens and sends the request once more.
 *
 * Refresh tokens rotate: each works once, and showing a used one again makes the server end the
 * whole login. So the rules here matter: one refresh at a time (everyone who fails meanwhile waits
 * for it), and the new refresh token is saved before anything else uses the new access token.
 */
export function createAuthFetch(deps: AuthFetchDeps) {
  let accessToken: string | null = null;
  let tenantId: string | null = null;
  let refreshing: Promise<string | null> | null = null;

  function authorize(request: Request, token: string | null): Request {
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    if (tenantId && !NO_TENANT(new URL(request.url).pathname)) {
      request.headers.set("X-Tenant-Id", tenantId);
    }
    return request;
  }

  // The new access token, or null when the session is over (or there is nothing to refresh with).
  async function refresh(): Promise<string | null> {
    const tokens = await deps.loadTokens();
    if (!tokens) return null;
    const result = await deps.refreshTokens(tokens.refresh); // a thrown error leaves the tokens alone
    if (result.kind === "ok") {
      try {
        await deps.saveTokens(result.tokens); // before the new access token is used by anyone
        accessToken = result.tokens.access;
        return accessToken;
      } catch {
        // The server already retired the old refresh token and the new one cannot be kept, so the
        // next start could not sign in again: end the session cleanly instead.
      }
    }
    accessToken = null;
    await deps.clearTokens().catch(() => {});
    deps.onSessionExpired();
    return null;
  }

  function refreshOnce(): Promise<string | null> {
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function authFetch(request: Request): Promise<Response> {
    const canRefresh = !NEVER_REFRESH.some((path) => new URL(request.url).pathname.endsWith(path));
    const spare = canRefresh ? request.clone() : null; // a request body can be read only once
    const sentWith = accessToken;
    const response = await deps.baseFetch(authorize(request, sentWith));
    if (response.status !== 401 || !spare) return response;

    // If another request refreshed while this one was in flight, its token is already newer.
    const token = accessToken !== null && accessToken !== sentWith ? accessToken : await refreshOnce();
    if (!token) return response; // the caller sees the 401
    return deps.baseFetch(authorize(spare, token)); // once: whatever comes back is the answer
  }

  return {
    fetch: authFetch,
    setAccessToken(token: string | null) {
      accessToken = token;
    },
    setTenantId(id: string | null) {
      tenantId = id;
    },
  };
}
