import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { loginRM, loginClient, logout as supabaseLogout, getMe } from '../api/auth';
import type { AuthUser, LoginResponse } from '../api/auth';
import { supabase } from '../lib/supabase';

export interface AuthContextValue {
  token: string | null;
  role: 'rm' | 'client' | null;
  user: AuthUser | null;
  loading: boolean;
  loginAsRM: (email: string, password: string) => Promise<void>;
  loginAsClient: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Last verified identity, so a reload survives a slow/unreachable backend.
const CACHE_KEY = 'nx_auth_cache';
type Cached = { role: 'rm' | 'client'; user: AuthUser };
const readCache = (): Cached | null => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const writeCache = (c: Cached | null) => {
  try {
    if (c) localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<'rm' | 'client' | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }

    let mounted = true;
    let inflight: { token: string; promise: Promise<void> } | null = null;
    const applySession = (accessToken: string | null): Promise<void> => {
      // getSession() and INITIAL_SESSION both fire on load; verify each token only once.
      if (accessToken && inflight?.token === accessToken) return inflight.promise;
      const promise = verifySession(accessToken);
      if (accessToken) {
        inflight = { token: accessToken, promise };
        void promise.finally(() => {
          if (inflight?.promise === promise) inflight = null;
        });
      }
      return promise;
    };
    const verifySession = async (accessToken: string | null) => {
      if (!accessToken) {
        writeCache(null);
        if (mounted) {
          setToken(null);
          setRole(null);
          setUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const response = await getMe(accessToken);
        writeCache({ role: response.role, user: response.user });
        if (mounted) {
          setToken(accessToken);
          setRole(response.role);
          setUser(response.user);
        }
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const cached = readCache();
        if (status !== 401 && status !== 403 && cached) {
          // Backend hiccup, not a bad session: stay signed in with the cached identity.
          if (mounted) {
            setToken(accessToken);
            setRole(cached.role);
            setUser(cached.user);
          }
        } else if (status === 401 || status === 403) {
          writeCache(null);
          await client.auth.signOut();
          if (mounted) {
            setToken(null);
            setRole(null);
            setUser(null);
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void client.auth.getSession().then(({ data }) => {
      const accessToken = data.session?.access_token ?? null;
      const cached = readCache();
      if (accessToken && cached && mounted) {
        // Show the app immediately from the last verified identity; re-verify in the background.
        setToken(accessToken);
        setRole(cached.role);
        setUser(cached.user);
        setLoading(false);
      }
      void applySession(accessToken);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.access_token ?? null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const applyLogin = useCallback((response: LoginResponse) => {
    writeCache({ role: response.role, user: response.user });
    setToken(response.token);
    setRole(response.role);
    setUser(response.user);
  }, []);

  const loginAsRM = useCallback(async (email: string, password: string) => {
    applyLogin(await loginRM({ email, password }));
  }, [applyLogin]);

  const loginAsClient = useCallback(async (email: string, password: string) => {
    applyLogin(await loginClient({ email, password }));
  }, [applyLogin]);

  const logout = useCallback(async () => {
    writeCache(null);
    await supabaseLogout();
    setToken(null);
    setRole(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ token, role, user, loading, loginAsRM, loginAsClient, logout }),
    [token, role, user, loading, loginAsRM, loginAsClient, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
