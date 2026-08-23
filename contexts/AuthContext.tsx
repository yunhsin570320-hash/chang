import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Profile, supabase, callRpc } from '../lib/supabase';

type UserRole = 'buyer' | 'seller';

interface AuthContextType {
  user: Profile | null;
  currentRole: UserRole;
  isLoading: boolean;
  isLoggingIn: boolean;
  isAdmin: boolean;
  sessionToken: string | null;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  register: (
    name: string,
    email: string,
    password: string,
    isBuyer: boolean,
    isSeller: boolean,
    phone?: string,
    shippingAddress?: string
  ) => Promise<{ error: string | null }>;
  logout: () => void;
  switchRole: (role: UserRole) => void;
  canSwitchRoles: () => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole>('buyer');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      let storedUser: string | null = null;
      let storedRole: string | null = null;
      let storedToken: string | null = null;
      try {
        storedUser = await AsyncStorage.getItem('auction_user');
        storedRole = await AsyncStorage.getItem('auction_role');
        storedToken = await AsyncStorage.getItem('auction_session_token');
      } catch {}

      if (storedUser && storedToken) {
        const parsedUser = JSON.parse(storedUser) as Profile;

        const { data: validatedUser } = await callRpc('rpc_validate_session', { p_token: storedToken });
        if (validatedUser) {
          setUser(validatedUser as Profile);
          setSessionToken(storedToken);
          if (storedRole === 'seller' || storedRole === 'buyer') {
            setCurrentRole(storedRole as UserRole);
          } else {
            setCurrentRole((validatedUser as Profile).is_seller ? 'seller' : 'buyer');
          }
          AsyncStorage.setItem('auction_user', JSON.stringify(validatedUser)).catch(() => {});
        } else {
          // Token expired — clear session, require re-login
          AsyncStorage.removeItem('auction_user').catch(() => {});
          AsyncStorage.removeItem('auction_role').catch(() => {});
          AsyncStorage.removeItem('auction_session_token').catch(() => {});
          // Keep parsedUser to avoid flash but don't set token — they'll be redirected
          setUser(parsedUser);
          setCurrentRole(parsedUser.is_seller ? 'seller' : 'buyer');
        }
        setIsLoading(false);
      } else {
        // No user or no token — clear any stale storage
        if (storedUser || storedToken) {
          AsyncStorage.removeItem('auction_user').catch(() => {});
          AsyncStorage.removeItem('auction_role').catch(() => {});
          AsyncStorage.removeItem('auction_session_token').catch(() => {});
        }
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Session check error:', error);
      try {
        await AsyncStorage.removeItem('auction_user');
        await AsyncStorage.removeItem('auction_role');
        await AsyncStorage.removeItem('auction_session_token');
      } catch {}
      setIsLoading(false);
    }
  };

  const refreshUser = useCallback(async () => {
    if (!user) return;
    try {
      const { data: freshUser } = await supabase
        .from('profiles')
        .select('id, name, email, role, is_buyer, is_seller, is_admin, is_blocked, blocked_reason, blocked_at, warning_count, phone, phone_verified, phone_verified_at, payment_method, bank_account, shipping_address, created_at')
        .eq('id', user.id)
        .maybeSingle();
      if (freshUser) {
        setUser(freshUser);
        AsyncStorage.setItem('auction_user', JSON.stringify(freshUser)).catch(() => {});
      }
    } catch {}
  }, [user]);

  const login = useCallback(async (email: string, password: string): Promise<{ error: string | null }> => {
    setIsLoggingIn(true);
    try {
      const { data, error: rpcError } = await callRpc('rpc_login', {
        p_email: email.toLowerCase().trim(),
        p_password_hash: '',
        p_password_original: password,
      });

      if (rpcError) return { error: '登入失敗，請稍後再試' };
      if (data?.error) return { error: data.error };

      const matchedUser = data.user as Profile;
      const token = data.token as string;
      const defaultRole: UserRole = matchedUser.is_seller ? 'seller' : 'buyer';

      setUser(matchedUser);
      setCurrentRole(defaultRole);
      setSessionToken(token);

      try {
        await AsyncStorage.setItem('auction_user', JSON.stringify(matchedUser));
        await AsyncStorage.setItem('auction_role', defaultRole);
        await AsyncStorage.setItem('auction_session_token', token);
      } catch {}

      return { error: null };
    } catch {
      return { error: '登入失敗，請稍後再試' };
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const register = useCallback(async (
    name: string,
    email: string,
    password: string,
    isBuyer: boolean,
    isSeller: boolean,
    phone?: string,
    shippingAddress?: string
  ): Promise<{ error: string | null }> => {
    setIsLoggingIn(true);
    try {
      const { data, error: rpcError } = await callRpc('rpc_register', {
        p_name: name.trim(),
        p_email: email.toLowerCase().trim(),
        p_password_hash: '',
        p_is_buyer: isBuyer,
        p_is_seller: isSeller,
        p_phone: phone ? phone.replace(/[\s\-()]/g, '') : null,
        p_shipping_address: shippingAddress || null,
        p_password_plain: password,
      });

      if (rpcError) return { error: '註冊失敗，請稍後再試' };
      if (data?.error) return { error: data.error };

      const newUser = data.user as Profile;
      const token = data.token as string;
      const defaultRole: UserRole = isSeller ? 'seller' : 'buyer';

      setUser(newUser);
      setCurrentRole(defaultRole);
      setSessionToken(token);

      try {
        await AsyncStorage.setItem('auction_user', JSON.stringify(newUser));
        await AsyncStorage.setItem('auction_role', defaultRole);
        await AsyncStorage.setItem('auction_session_token', token);
      } catch {}

      return { error: null };
    } catch {
      return { error: '註冊失敗，請稍後再試' };
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const logout = useCallback(() => {
    if (sessionToken) {
      callRpc('rpc_logout', { p_token: sessionToken }).then(() => {}, () => {});
    }
    setUser(null);
    setCurrentRole('buyer');
    setSessionToken(null);
    AsyncStorage.removeItem('auction_user').catch(() => {});
    AsyncStorage.removeItem('auction_role').catch(() => {});
    AsyncStorage.removeItem('auction_session_token').catch(() => {});
  }, [sessionToken]);

  const switchRole = useCallback((role: UserRole) => {
    if (!user) return;
    if (role === 'seller' && !user.is_seller) return;
    if (role === 'buyer' && !user.is_buyer) return;
    setCurrentRole(role);
    AsyncStorage.setItem('auction_role', role).catch(() => {});
  }, [user]);

  const canSwitchRoles = useCallback((): boolean => {
    return user?.is_buyer === true && user?.is_seller === true;
  }, [user]);

  const isAdmin = user?.is_admin === true;

  return (
    <AuthContext.Provider value={{
      user,
      currentRole,
      isLoading,
      isLoggingIn,
      isAdmin,
      sessionToken,
      login,
      register,
      logout,
      switchRole,
      canSwitchRoles,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
