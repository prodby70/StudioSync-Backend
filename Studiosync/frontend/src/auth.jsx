import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, consumeSessionId, getToken, setToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setError("");
      try {
        const sessionId = consumeSessionId();
        if (sessionId) {
          const data = await api("/api/auth/session", {
            method: "POST",
            body: { session_id: sessionId },
            auth: false,
          });
          setToken(data.session_token);
          if (!cancelled) setUser(data.user);
          return;
        }

        if (!getToken()) return;
        const me = await api("/api/auth/me");
        if (!cancelled) setUser(me.user);
      } catch (err) {
        setToken(null);
        if (!cancelled) {
          setUser(null);
          setError(err.message);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      error,
      setError,
      login: async (email, password) => {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: { email, password },
          auth: false,
        });
        setToken(data.session_token);
        setUser(data.user);
        return data.user;
      },
      register: async (name, email, password) => {
        const data = await api("/api/auth/register", {
          method: "POST",
          body: { name, email, password },
          auth: false,
        });
        setToken(data.session_token);
        setUser(data.user);
        return data.user;
      },
      logout: async () => {
        try {
          await api("/api/auth/logout", { method: "POST" });
        } finally {
          setToken(null);
          setUser(null);
        }
      },
    }),
    [user, ready, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
