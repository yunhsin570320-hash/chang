import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase, Profile, PREDEFINED_USERS } from '@/lib/supabase';

interface UserContextType {
  currentUser: Profile | null;
  setCurrentUser: (user: Profile) => void;
  users: Profile[];
  loading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<Profile | null>(PREDEFINED_USERS[1]);
  const [users, setUsers] = useState<Profile[]>(PREDEFINED_USERS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadUsers() {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .order('name');

        if (data && data.length > 0) {
          setUsers(data);
          const defaultUser = data.find(u => u.role === 'buyer') || data[0];
          setCurrentUser(defaultUser);
        }
      } catch (error) {
        console.log('Using predefined users');
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  }, []);

  if (loading) {
    return null;
  }

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, users, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
