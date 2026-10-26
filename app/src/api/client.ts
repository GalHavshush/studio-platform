import createClient from "openapi-fetch";

import type { paths } from "./schema";

// EXPO_PUBLIC_ variables are copied into the app when it is built: public, never put a secret here.
// On a phone "localhost" is the phone itself, so there it must be the Mac's address (.env.example).
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = createClient<paths>({ baseUrl });

// Kept in memory so adding the header does not read the secure storage on every request. The
// session provider sets it at sign-in and at startup, and clears it at sign-out.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

api.use({
  onRequest({ request }) {
    if (accessToken) request.headers.set("Authorization", `Bearer ${accessToken}`);
    return request;
  },
});
