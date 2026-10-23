import createClient from "openapi-fetch";

import type { paths } from "./schema";

// EXPO_PUBLIC_ variables are copied into the app when it is built: public, never put a secret here.
// On a phone "localhost" is the phone itself, so there it must be the Mac's address (.env.example).
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = createClient<paths>({ baseUrl });
