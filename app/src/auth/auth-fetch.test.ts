import { createAuthFetch, type RefreshResult } from "./auth-fetch";
import type { Tokens } from "./tokens";

const URL_BASE = "http://api.test";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fake API and storage. The server accepts only the access token in `valid`, and, like the real
 * one, a refresh token works once. `log` records what happened, in order. */
function setup(options: { refresh?: "ok" | "rejected" | "unreachable"; saveFails?: boolean; empty?: boolean } = {}) {
  const log: string[] = [];
  const tenants: (string | null)[] = []; // the X-Tenant-Id of each request that reached the server
  let stored: Tokens | null = options.empty ? null : { access: "a0", refresh: "r1" };
  let valid = "a1";
  let usedRefresh = false;
  let gate: Promise<void> = Promise.resolve();
  let hold: ((request: Request) => Promise<void> | undefined) | null = null;
  const expired = jest.fn();

  const auth = createAuthFetch({
    baseFetch: async (request) => {
      const path = new URL(request.url).pathname;
      log.push(`${request.method} ${path} ${request.headers.get("Authorization")}`);
      tenants.push(request.headers.get("X-Tenant-Id"));
      const wait = hold?.(request);
      if (wait) await wait;
      if (path.startsWith("/auth/")) return new Response(null, { status: 401 });
      const ok = request.headers.get("Authorization") === `Bearer ${valid}`;
      return new Response(await request.text(), { status: ok ? 200 : 401 });
    },
    loadTokens: async () => stored,
    saveTokens: async (tokens) => {
      await tick(); // storage takes a moment, so a save that is not waited for shows up late
      if (options.saveFails) throw new Error("storage is full");
      log.push(`save ${tokens.refresh}`);
      stored = tokens;
    },
    clearTokens: async () => {
      log.push("clear");
      stored = null;
    },
    refreshTokens: async (refreshToken): Promise<RefreshResult> => {
      log.push(`refresh ${refreshToken}`);
      await gate;
      if (options.refresh === "unreachable") throw new Error("network down");
      if (options.refresh === "rejected" || usedRefresh) return { kind: "rejected" };
      usedRefresh = true;
      return { kind: "ok", tokens: { access: "a1", refresh: "r2" } };
    },
    onSessionExpired: expired,
  });
  auth.setAccessToken("a0"); // the access token has expired: the server only accepts a1

  return {
    log,
    tenants,
    expired,
    auth,
    get stored() {
      return stored;
    },
    refreshCalls: () => log.filter((line) => line.startsWith("refresh ")).length,
    serverAccepts(token: string) {
      valid = token;
    },
    holdRefresh() {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return release;
    },
    holdRequests(fn: (request: Request) => Promise<void> | undefined) {
      hold = fn;
    },
  };
}

const get = (path = "/sessions") => new Request(`${URL_BASE}${path}`);

test("a request carries the access token", async () => {
  const t = setup();
  t.auth.setAccessToken("a1");

  const response = await t.auth.fetch(get());

  expect(response.status).toBe(200);
  expect(t.log).toEqual(["GET /sessions Bearer a1"]);
});

test("a 401 is refreshed and the request is sent again with the new token", async () => {
  const t = setup();

  const response = await t.auth.fetch(get());

  expect(response.status).toBe(200);
  expect(t.log).toEqual(["GET /sessions Bearer a0", "refresh r1", "save r2", "GET /sessions Bearer a1"]);
});

test("the new refresh token is saved before the request is sent again", async () => {
  const t = setup();

  await t.auth.fetch(get());

  expect(t.log.indexOf("save r2")).toBeLessThan(t.log.lastIndexOf("GET /sessions Bearer a1"));
  expect(t.stored).toEqual({ access: "a1", refresh: "r2" });
});

test("a request body survives the retry", async () => {
  const t = setup();
  const post = new Request(`${URL_BASE}/sessions`, { method: "POST", body: '{"capacity":5}' });

  const response = await t.auth.fetch(post);

  expect(response.status).toBe(200);
  expect(await response.text()).toBe('{"capacity":5}'); // the fake echoes the body it received
});

test("requests that fail together share one refresh", async () => {
  const t = setup();
  const release = t.holdRefresh();

  const all = Promise.all([t.auth.fetch(get("/a")), t.auth.fetch(get("/b")), t.auth.fetch(get("/c"))]);
  await tick(); // all three have been told 401 and are waiting for the refresh
  release();
  const responses = await all;

  expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(t.refreshCalls()).toBe(1);
});

test("a request that failed with an old token uses the newer one instead of refreshing again", async () => {
  const t = setup();
  let letSlowOneAnswer!: () => void;
  const slowOneWaits = new Promise<void>((resolve) => (letSlowOneAnswer = resolve));
  t.holdRequests((request) =>
    request.url.endsWith("/slow") && request.headers.get("Authorization") === "Bearer a0"
      ? slowOneWaits
      : undefined,
  );

  const slow = t.auth.fetch(get("/slow")); // sent with a0, its answer is delayed
  await tick();
  await t.auth.fetch(get("/fast")); // meanwhile this one fails, refreshes and succeeds
  letSlowOneAnswer();
  const response = await slow;

  expect(response.status).toBe(200);
  expect(t.refreshCalls()).toBe(1);
});

test("a request is sent again only once", async () => {
  const t = setup();
  t.serverAccepts("nothing"); // even the new token is refused

  const response = await t.auth.fetch(get());

  expect(response.status).toBe(401);
  expect(t.refreshCalls()).toBe(1);
  expect(t.log.filter((line) => line.startsWith("GET"))).toHaveLength(2);
  expect(t.expired).not.toHaveBeenCalled();
});

test.each(["/auth/login", "/auth/refresh", "/auth/logout"])("a 401 on %s never triggers a refresh", async (path) => {
  const t = setup();

  const response = await t.auth.fetch(new Request(`${URL_BASE}${path}`, { method: "POST" }));

  expect(response.status).toBe(401);
  expect(t.refreshCalls()).toBe(0);
  expect(t.log).toHaveLength(1);
});

test("a refresh token the server refuses ends the session", async () => {
  const t = setup({ refresh: "rejected" });

  const response = await t.auth.fetch(get());

  expect(response.status).toBe(401);
  expect(t.expired).toHaveBeenCalledTimes(1);
  expect(t.stored).toBeNull();
});

test("a refresh that cannot reach the server fails the request and keeps the session", async () => {
  const t = setup({ refresh: "unreachable" });

  await expect(t.auth.fetch(get())).rejects.toThrow("network down");

  expect(t.expired).not.toHaveBeenCalled();
  expect(t.stored).toEqual({ access: "a0", refresh: "r1" });
});

test("when the new tokens cannot be saved the session ends instead of using them", async () => {
  const t = setup({ saveFails: true });

  const response = await t.auth.fetch(get());

  expect(response.status).toBe(401);
  expect(t.expired).toHaveBeenCalledTimes(1);
  expect(t.stored).toBeNull();
  expect(t.log.filter((line) => line.startsWith("GET"))).toHaveLength(1); // never retried with them
});

test("with no stored tokens a 401 is just returned", async () => {
  const t = setup({ empty: true });

  const response = await t.auth.fetch(get());

  expect(response.status).toBe(401);
  expect(t.refreshCalls()).toBe(0);
  expect(t.expired).not.toHaveBeenCalled();
});

test("a request about a studio carries X-Tenant-Id, and none after the studio is cleared", async () => {
  const t = setup();
  t.auth.setAccessToken("a1");
  t.auth.setTenantId("studio-1");

  await t.auth.fetch(get());
  t.auth.setTenantId(null);
  await t.auth.fetch(get());

  expect(t.tenants).toEqual(["studio-1", null]);
});

test("calls that are not about one studio never carry X-Tenant-Id", async () => {
  const t = setup();
  t.auth.setAccessToken("a1");
  t.auth.setTenantId("studio-1");

  for (const path of ["/me", "/health", "/auth/login", "/auth/refresh", "/auth/logout"]) {
    await t.auth.fetch(get(path));
  }

  expect(t.tenants).toEqual([null, null, null, null, null]);
});

test("the request sent again after a refresh still carries X-Tenant-Id", async () => {
  const t = setup();
  t.auth.setTenantId("studio-1");

  await t.auth.fetch(get());

  expect(t.tenants).toEqual(["studio-1", "studio-1"]); // the first try (401) and the retry
});
