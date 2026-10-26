import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, setAccessToken, setSessionExpiredListener, setTenantId } from "@/api/client";
import type { components } from "@/api/schema";

import { clearTenantId, loadTenantId, saveTenantId } from "./tenant-id";
import { clearTokens, loadTokens, saveTokens } from "./tokens";

type Me = components["schemas"]["MeResponse"];

export type Status = "loading" | "signedOut" | "signedIn";
// What a sign-in attempt can end in; the login screen turns each into a message.
export type SignInResult = "ok" | "invalid" | "unreachable" | "error";

// The studio the user is working in: who they are there, and what it has switched on.
export type Studio = { id: string; name: string; role: string; modules: string[] };
// What choosing a studio can end in; the picker turns a failure into a message.
export type SelectResult = "ok" | "unreachable" | "error";

type Session = {
  status: Status;
  user: Me | null;
  studio: Studio | null;
  selectStudio: (id: string) => Promise<SelectResult>;
  leaveStudio: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

// "unauthorized": the server did not accept the token. "failed": no answer, or an error that is
// not about the token, so the stored session may still be good.
async function fetchMe(): Promise<Me | "unauthorized" | "failed"> {
  try {
    const { data, response } = await api.GET("/me");
    if (data) return data;
    return response.status === 401 ? "unauthorized" : "failed";
  } catch {
    return "failed";
  }
}

// Asks the API for the studio's details with the studio set as current, so the header is sent.
async function fetchStudio(me: Me, id: string): Promise<Studio | SelectResult> {
  const membership = me.memberships.find((m) => m.tenant.id === id);
  if (!membership) return "error";
  setTenantId(id);
  try {
    const { data } = await api.GET("/tenant");
    if (data) {
      return { id, name: data.name, role: membership.role, modules: data.modules };
    }
  } catch {
    setTenantId(null);
    return "unreachable";
  }
  setTenantId(null);
  return "error";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<Me | null>(null);
  const [studio, setStudio] = useState<Studio | null>(null);

  // Right after we know who the user is: a single membership is chosen for them, otherwise the
  // studio used last time is picked again if they still belong to it. Failing that, the picker.
  const enterStudioAutomatically = useCallback(async (me: Me) => {
    let id = me.memberships.length === 1 ? me.memberships[0].tenant.id : null;
    if (!id) {
      const saved = await loadTenantId().catch(() => null);
      if (saved && me.memberships.some((m) => m.tenant.id === saved)) id = saved;
    }
    if (!id) return;
    const result = await fetchStudio(me, id);
    if (typeof result !== "string") setStudio(result);
  }, []);

  // A refresh the server refuses (the login was revoked, or the refresh token expired) ends the
  // session wherever it happens: back to the login screen.
  useEffect(() => {
    setSessionExpiredListener(() => {
      setUser(null);
      setStudio(null);
      setTenantId(null);
      setStatus("signedOut");
    });
    return () => setSessionExpiredListener(null);
  }, []);

  // Restore the session at app start: stored token, then ask the API who it belongs to.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let me: Me | null = null;
      try {
        const tokens = await loadTokens();
        if (tokens) {
          setAccessToken(tokens.access);
          const result = await fetchMe();
          if (typeof result !== "string") me = result;
          // Only a rejected token ends the stored session. If the API simply cannot be reached
          // the tokens stay, so the next start can restore it.
          else if (result === "unauthorized") await clearTokens();
        }
      } catch {
        // secure storage unreadable: start signed out
      }
      if (cancelled) return;
      if (!me) setAccessToken(null);
      else await enterStudioAutomatically(me);
      if (cancelled) return;
      setUser(me);
      setStatus(me ? "signedIn" : "signedOut");
    })();
    return () => {
      cancelled = true;
    };
  }, [enterStudioAutomatically]);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    try {
      const { data, response } = await api.POST("/auth/login", { body: { email, password } });
      if (!data) return response.status === 401 || response.status === 422 ? "invalid" : "error";
      await saveTokens({ access: data.access_token, refresh: data.refresh_token });
      setAccessToken(data.access_token);
      const me = await fetchMe();
      if (typeof me === "string") {
        setAccessToken(null);
        await clearTokens();
        return me === "failed" ? "unreachable" : "error";
      }
      await enterStudioAutomatically(me);
      setUser(me);
      setStatus("signedIn");
      return "ok";
    } catch {
      return "unreachable"; // fetch throws when there is no answer at all
    }
  }, [enterStudioAutomatically]);

  const selectStudio = useCallback(
    async (id: string): Promise<SelectResult> => {
      if (!user) return "error";
      const result = await fetchStudio(user, id);
      if (typeof result === "string") return result;
      await saveTenantId(id).catch(() => {}); // only a convenience: failing to remember is fine
      setStudio(result);
      return "ok";
    },
    [user],
  );

  const leaveStudio = useCallback(async () => {
    setTenantId(null);
    setStudio(null);
    await clearTenantId().catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    const tokens = await loadTokens().catch(() => null);
    // Sign out locally first: it must work with no network, and the screen should not wait.
    setAccessToken(null);
    setTenantId(null);
    await Promise.all([clearTokens().catch(() => {}), clearTenantId().catch(() => {})]);
    setUser(null);
    setStudio(null);
    setStatus("signedOut");
    if (tokens) {
      // Best effort: tell the server to end this login (revokes its refresh tokens).
      await api
        .POST("/auth/logout", { body: { refresh_token: tokens.refresh } })
        .catch(() => {});
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, studio, selectStudio, leaveStudio, signIn, signOut }),
    [status, user, studio, selectStudio, leaveStudio, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}
