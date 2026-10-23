// Never run, only compiled by `npm run typecheck`. Each call below is wrong on purpose and marked
// as an expected error: if the client ever stops checking routes and bodies, TypeScript reports
// an unused expectation and the typecheck (and CI) fails.
import { api } from "./client";

export async function contractCheck() {
  // @ts-expect-error: there is no such route
  await api.GET("/no-such-route");

  await api.PATCH("/sessions/{session_id}", {
    params: { path: { session_id: "x" } },
    // @ts-expect-error: capacity is a number
    body: { capacity: "five" },
  });

  // @ts-expect-error: this route needs its session_id path parameter
  await api.GET("/sessions/{session_id}");
}
