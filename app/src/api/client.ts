import createClient from "openapi-fetch";

import { createAuthFetch } from "@/auth/auth-fetch";
import { clearTokens, loadTokens, saveTokens } from "@/auth/tokens";

import type { paths } from "./schema";

// EXPO_PUBLIC_ variables are copied into the app when it is built: public, never put a secret here.
// On a phone "localhost" is the phone itself, so there it must be the Mac's address (.env.example).
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

let sessionExpiredListener: (() => void) | null = null;

// The refresh call itself uses a client without the wrapper below, which would otherwise try to
// refresh a refresh that failed.
const bare = createClient<paths>({ baseUrl });

const auth = createAuthFetch({
  baseFetch: (request) => globalThis.fetch(request),
  loadTokens,
  saveTokens,
  clearTokens,
  refreshTokens: async (refreshToken) => {
    const { data, response } = await bare.POST("/auth/refresh", {
      body: { refresh_token: refreshToken },
    });
    if (data) {
      return { kind: "ok", tokens: { access: data.access_token, refresh: data.refresh_token } };
    }
    if (response.status === 401) return { kind: "rejected" };
    throw new Error(`refresh failed with status ${response.status}`);
  },
  onSessionExpired: () => sessionExpiredListener?.(),
});

// Signs every request with the access token and refreshes it when the server says it has expired.
export const api = createClient<paths>({ baseUrl, fetch: auth.fetch });

// Kept in memory so adding the header does not read the secure storage on every request. The
// session provider sets it at sign-in and at startup, and clears it at sign-out.
export const setAccessToken = auth.setAccessToken;

// The studio the user is working in: sent as `X-Tenant-Id` on every call that is about one studio.
export const setTenantId = auth.setTenantId;

// The session provider listens here to go back to the login screen when a refresh is refused.
export function setSessionExpiredListener(listener: (() => void) | null): void {
  sessionExpiredListener = listener;
}
