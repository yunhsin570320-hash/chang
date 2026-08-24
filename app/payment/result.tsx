import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Check, X, ArrowLeft } from 'lucide-react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function PaymentResultPage() {
  const { status, trade_no } = useLocalSearchParams<{ status: string; trade_no: string }>();
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.replace('/(tabs)/profile');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const isSuccess = status === 'success';

  return (
    <>
      <Stack.Screen
        options={{
          title: '付款結果',
          headerShown: true,
          headerStyle: { backgroundColor: '#0D0D1A' },
          headerTintColor: '#fff',
          headerTitleStyle: { color: '#fff' },
        }}
      />
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          {isSuccess ? (
            <View style={styles.successIcon}>
              <Check size={48} color="#000" />
            </View>
          ) : (
            <View style={styles.failIcon}>
              <X size={48} color="#fff" />
            </View>
          )}
        </View>

        <Text style={styles.title}>
          {isSuccess ? '付款成功' : '付款失敗'}
        </Text>

        {trade_no ? (
          <Text style={styles.tradeNo}>交易編號：{trade_no}</Text>
        ) : null}

        <Text style={styles.message}>
          {isSuccess
            ? '您的付款已完成，賣家將會確認後安排出貨。'
            : '付款未完成，請稍後再試或聯繫賣家安排其他付款方式。'}
        </Text>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.replace('/(tabs)/profile')}
          >
            <Text style={styles.primaryButtonText}>查看我的訂單</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.secondaryButtonText}>返回首頁</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.countdownText}>
          {countdown > 0 ? `${countdown} 秒後自動返回...` : ''}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: { marginBottom: 24 },
  successIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#00D4AA',
    justifyContent: 'center', alignItems: 'center',
  },
  failIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#FF6B6B',
    justifyContent: 'center', alignItems: 'center',
  },
  title: {
    fontSize: 28, fontWeight: '700', color: '#fff',
    marginBottom: 12,
  },
  tradeNo: {
    fontSize: 14, color: '#666', marginBottom: 16,
  },
  message: {
    fontSize: 16, color: '#888', textAlign: 'center',
    lineHeight: 24, marginBottom: 32,
  },
  buttonContainer: { gap: 12, width: '100%', maxWidth: 320 },
  primaryButton: {
    backgroundColor: '#00D4AA', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: 'transparent', paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  secondaryButtonText: { color: '#888', fontSize: 16 },
  countdownText: { color: '#444', fontSize: 13, marginTop: 24 },
});
