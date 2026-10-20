import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setApiKey, type Merchant } from "./api";

const STORAGE_KEY = "payflow_api_key";

interface AuthContextValue {
  merchant: Merchant | null;
  loading: boolean;
  login: (key: string) => Promise<void>;
  demoLogin: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setLoading(false);
      return;
    }

    setApiKey(stored);
    api
      .me()
      .then((me) => {
        if (!cancelled) setMerchant(me);
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem(STORAGE_KEY);
          setApiKey(null);
          setMerchant(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (raw: string) => {
    const key = raw.trim();
    if (!key) throw new Error("Paste an API key to continue.");

    setApiKey(key);
    try {
      const me = await api.me();
      localStorage.setItem(STORAGE_KEY, key);
      setMerchant(me);
    } catch (error) {
      setApiKey(null);
      throw error;
    }
  }, []);

  const demoLogin = useCallback(async () => {
    const session = await api.demoSession();
    await login(session.api_key);
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
    setMerchant(null);
  }, []);

  const value = useMemo(
    () => ({ merchant, loading, login, demoLogin, logout }),
    [merchant, loading, login, demoLogin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
