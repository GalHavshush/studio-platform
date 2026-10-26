import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, setAccessToken } from "@/api/client";
import type { components } from "@/api/schema";

import { clearTokens, loadTokens, saveTokens } from "./tokens";

type Me = components["schemas"]["MeResponse"];

export type Status = "loading" | "signedOut" | "signedIn";
// What a sign-in attempt can end in; the login screen turns each into a message.
export type SignInResult = "ok" | "invalid" | "unreachable" | "error";

type Session = {
  status: Status;
  user: Me | null;
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<Me | null>(null);

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
      setUser(me);
      setStatus(me ? "signedIn" : "signedOut");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setUser(me);
      setStatus("signedIn");
      return "ok";
    } catch {
      return "unreachable"; // fetch throws when there is no answer at all
    }
  }, []);

  const signOut = useCallback(async () => {
    const tokens = await loadTokens().catch(() => null);
    // Sign out locally first: it must work with no network, and the screen should not wait.
    setAccessToken(null);
    await clearTokens().catch(() => {});
    setUser(null);
    setStatus("signedOut");
    if (tokens) {
      // Best effort: tell the server to end this login (revokes its refresh tokens).
      await api
        .POST("/auth/logout", { body: { refresh_token: tokens.refresh } })
        .catch(() => {});
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}
