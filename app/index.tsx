import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import PromoScreen from './promo';

export default function RootIndex() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/(tabs)');
    }
  }, [isLoading, user, router]);

  if (isLoading) return null;

  return <PromoScreen />;
}

export const unstable_settings = {
  title: '暗標競標會 — 密封競標平台',
};
