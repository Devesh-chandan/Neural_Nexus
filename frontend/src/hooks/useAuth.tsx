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
    const applySession = async (accessToken: string | null) => {
      if (!accessToken) {
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
        if (mounted) {
          setToken(accessToken);
          setRole(response.role);
          setUser(response.user);
        }
      } catch {
        await client.auth.signOut();
        if (mounted) {
          setToken(null);
          setRole(null);
          setUser(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void client.auth.getSession().then(({ data }) => {
      void applySession(data.session?.access_token ?? null);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        void applySession(null);
      } else {
        setToken(session.access_token);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const applyLogin = useCallback((response: LoginResponse) => {
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
