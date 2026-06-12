import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Profile, supabase } from '../lib/supabase';

type UserRole = 'buyer' | 'seller';

async function hashPassword(password: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto?.subtle?.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256JS(password);
}

// Pure-JS SHA-256 fallback for React Native environments without crypto.subtle
function sha256JS(message: string): string {
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // Encode message as UTF-8 bytes
  const msgBytes: number[] = [];
  for (let i = 0; i < message.length; i++) {
    let code = message.charCodeAt(i);
    if (code < 0x80) {
      msgBytes.push(code);
    } else if (code < 0x800) {
      msgBytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < message.length) {
      const next = message.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const codePoint = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        msgBytes.push(
          0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f),
        );
        i++;
      }
    } else {
      msgBytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  const bitLen = msgBytes.length * 8;
  msgBytes.push(0x80);
  while (msgBytes.length % 64 !== 56) msgBytes.push(0);
  for (let i = 7; i >= 0; i--) msgBytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);

  const words = new Uint32Array(64);
  for (let chunk = 0; chunk < msgBytes.length / 64; chunk++) {
    for (let i = 0; i < 16; i++) {
      words[i] = (msgBytes[chunk * 64 + i * 4] << 24) | (msgBytes[chunk * 64 + i * 4 + 1] << 16) |
                 (msgBytes[chunk * 64 + i * 4 + 2] << 8) | msgBytes[chunk * 64 + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((words[i-15] >>> 7) | (words[i-15] << 25)) ^ ((words[i-15] >>> 18) | (words[i-15] << 14)) ^ (words[i-15] >>> 3);
      const s1 = ((words[i-2] >>> 17) | (words[i-2] << 15)) ^ ((words[i-2] >>> 19) | (words[i-2] << 13)) ^ (words[i-2] >>> 10);
      words[i] = (words[i-16] + s0 + words[i-7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + words[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(n => n.toString(16).padStart(8, '0')).join('');
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
