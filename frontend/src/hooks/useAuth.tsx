import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { loginRM, loginClient, logout as apiLogout, getMe } from '../api/auth';
import type { AuthUser, LoginResponse } from '../api/auth';

const TOKEN_KEY = 'nn_auth_token';
const ROLE_KEY = 'nn_auth_role';

export interface AuthContextValue {
  token: string | null;
  role: 'rm' | 'client' | null;
  user: AuthUser | null;
  loading: boolean;
  loginAsRM: (email: string, employeeId: string) => Promise<void>;
  loginAsClient: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [role, setRole] = useState<'rm' | 'client' | null>(
    () => (localStorage.getItem(ROLE_KEY) as 'rm' | 'client' | null)
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // On mount, validate existing token
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (!savedToken) {
      setLoading(false);
      return;
    }
    getMe(savedToken)
      .then((res) => {
        setToken(savedToken);
        setRole(res.role);
        setUser(res.user);
      })
      .catch(() => {
        // Token invalid/expired
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ROLE_KEY);
        setToken(null);
        setRole(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const applyLogin = useCallback((res: LoginResponse) => {
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(ROLE_KEY, res.role);
    setToken(res.token);
    setRole(res.role);
    setUser(res.user);
  }, []);

  const loginAsRM = useCallback(
    async (email: string, employeeId: string) => {
      const res = await loginRM({ corporate_email: email, employee_id: employeeId });
      applyLogin(res);
    },
    [applyLogin]
  );

  const loginAsClient = useCallback(
    async (email: string, password: string) => {
      const res = await loginClient({ email, password });
      applyLogin(res);
    },
    [applyLogin]
  );

  const logout = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      try { await apiLogout(t); } catch { /* ignore */ }
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
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
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
