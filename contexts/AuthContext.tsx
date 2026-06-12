import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Profile, supabase } from '../lib/supabase';

type UserRole = 'buyer' | 'seller';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function isHashed(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

interface AuthContextType {
  user: Profile | null;
  currentRole: UserRole;
  isLoading: boolean;
  isLoggingIn: boolean;
  isAdmin: boolean;
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
      try {
        storedUser = await AsyncStorage.getItem('auction_user');
        storedRole = await AsyncStorage.getItem('auction_role');
      } catch {}

      if (storedUser) {
        const parsedUser = JSON.parse(storedUser) as Profile;
        setUser(parsedUser);
        if (storedRole === 'seller' || storedRole === 'buyer') {
          setCurrentRole(storedRole as UserRole);
        } else {
          setCurrentRole(parsedUser.is_seller ? 'seller' : 'buyer');
        }
        setIsLoading(false);

        // Refresh from DB in background
        supabase
          .from('profiles')
          .select('*')
          .eq('id', parsedUser.id)
          .maybeSingle()
          .then(({ data: freshUser }) => {
            if (freshUser) {
              setUser(freshUser);
              AsyncStorage.setItem('auction_user', JSON.stringify(freshUser)).catch(() => {});
            }
          });
      } else {
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Session check error:', error);
      try {
        await AsyncStorage.removeItem('auction_user');
        await AsyncStorage.removeItem('auction_role');
      } catch {}
      setIsLoading(false);
    }
  };

  const refreshUser = useCallback(async () => {
    if (!user) return;
    try {
      const { data: freshUser } = await supabase
        .from('profiles')
        .select('*')
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
      const { data: profiles, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email.toLowerCase().trim());

      if (fetchError) return { error: '登入失敗，請稍後再試' };
      if (!profiles || profiles.length === 0) return { error: '郵箱或密碼錯誤' };

      const hashed = await hashPassword(password);
      const matchedUser = profiles.find(p => {
        const stored = p.password_hash || '';
        return isHashed(stored) ? stored === hashed : stored === password;
      });
      if (!matchedUser) return { error: '郵箱或密碼錯誤' };

      // Upgrade legacy plaintext password to hash (fire-and-forget)
      if (matchedUser.password_hash && !isHashed(matchedUser.password_hash)) {
        supabase.from('profiles').update({ password_hash: hashed }).eq('id', matchedUser.id).then(() => {});
      }

      if (matchedUser.is_blocked) {
        return { error: `此帳號已被停用。原因：${matchedUser.blocked_reason || '違反使用規範'}` };
      }

      const defaultRole: UserRole = matchedUser.is_seller ? 'seller' : 'buyer';
      setUser(matchedUser);
      setCurrentRole(defaultRole);
      try {
        await AsyncStorage.setItem('auction_user', JSON.stringify(matchedUser));
        await AsyncStorage.setItem('auction_role', defaultRole);
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
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();

      if (existingUser) return { error: '此郵箱已被註冊' };

      // Check if phone is already taken (if provided)
      if (phone) {
        const { data: existingPhone } = await supabase
          .from('profiles')
          .select('id')
          .eq('phone', phone)
          .maybeSingle();
        if (existingPhone) return { error: '此手機號碼已被其他帳戶使用' };
      }

      const hashedPassword = await hashPassword(password);
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password_hash: hashedPassword,
          is_buyer: isBuyer,
          is_seller: isSeller,
          role: isSeller ? 'seller' : 'buyer',
          phone: phone || null,
          phone_verified: phone ? true : false,
          phone_verified_at: phone ? new Date().toISOString() : null,
          shipping_address: shippingAddress || null,
        })
        .select()
        .single();

      if (error || !data) {
        console.error('Register error:', error);
        return { error: '註冊失敗，請稍後再試' };
      }

      const defaultRole: UserRole = isSeller ? 'seller' : 'buyer';
      setUser(data);
      setCurrentRole(defaultRole);
      try {
        await AsyncStorage.setItem('auction_user', JSON.stringify(data));
        await AsyncStorage.setItem('auction_role', defaultRole);
      } catch {}

      return { error: null };
    } catch {
      return { error: '註冊失敗，請稍後再試' };
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setCurrentRole('buyer');
    AsyncStorage.removeItem('auction_user').catch(() => {});
    AsyncStorage.removeItem('auction_role').catch(() => {});
  }, []);

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
