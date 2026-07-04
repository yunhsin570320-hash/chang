import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FlaskConical, Mail, Lock, Eye, EyeOff, User } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', text: '#E6EDF3', textMuted: '#8B949E',
};

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login, register, isLoggingIn, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace('/(tabs)');
  }, [user]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { setError('請輸入郵箱和密碼'); return; }
    setError(null);
    const result = await login(email.trim(), password);
    if (result.error) setError(result.error);
  };

  const handleRegister = async () => {
    if (!name.trim()) { setError('請填寫姓名'); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('請輸入有效的電子郵箱'); return;
    }
    if (password.length < 4) { setError('密碼至少需要4個字元'); return; }
    if (password !== confirmPassword) { setError('密碼與確認密碼不符'); return; }
    setError(null);
    const result = await register(name.trim(), email.trim(), password);
    if (result.error) setError(result.error);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <FlaskConical size={40} color={C.primary} />
          </View>
          <Text style={styles.title}>化工生產 ERP</Text>
          <Text style={styles.subtitle}>{isLogin ? '員工登入' : '建立帳號'}</Text>
        </View>

        <View style={styles.card}>
          {!isLogin && (
            <Field label="姓名" icon={<User size={18} color={C.textMuted} />}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="您的姓名"
                placeholderTextColor={C.textMuted}
                autoCapitalize="words"
              />
            </Field>
          )}

          <Field label="電子郵箱" icon={<Mail size={18} color={C.textMuted} />}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="employee@company.com"
              placeholderTextColor={C.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          <Field label="密碼" icon={<Lock size={18} color={C.textMuted} />}
            right={
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {showPassword ? <EyeOff size={18} color={C.textMuted} /> : <Eye size={18} color={C.textMuted} />}
              </TouchableOpacity>
            }>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="輸入密碼"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
          </Field>

          {!isLogin && (
            <Field label="確認密碼" icon={<Lock size={18} color={C.textMuted} />}>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="再輸入一次密碼"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
            </Field>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.btn, isLoggingIn && styles.btnDisabled]}
            onPress={isLogin ? handleLogin : handleRegister}
            disabled={isLoggingIn}
          >
            {isLoggingIn
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>{isLogin ? '登入系統' : '建立帳號'}</Text>
            }
          </TouchableOpacity>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{isLogin ? '還沒有帳號？' : '已有帳號？'}</Text>
            <TouchableOpacity onPress={() => { setIsLogin(v => !v); setError(null); }}>
              <Text style={styles.switchLink}>{isLogin ? '申請帳號' : '前往登入'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.note}>僅限公司授權員工使用</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, icon, right, children }: {
  label: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <View style={fieldStyles.group}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={fieldStyles.row}>
        {icon}
        {children}
        {right}
      </View>
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  group: { marginBottom: 16 },
  label: { fontSize: 13, color: C.textMuted, marginBottom: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0D1117', borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 2,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingVertical: 60 },
  header: { alignItems: 'center', marginBottom: 32 },
  iconWrap: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: '#161B22', borderWidth: 1, borderColor: '#30363D',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { fontSize: 26, fontWeight: '700', color: C.text, marginBottom: 4 },
  subtitle: { fontSize: 15, color: C.textMuted },
  card: {
    backgroundColor: '#161B22', borderRadius: 16,
    borderWidth: 1, borderColor: '#30363D',
    padding: 24,
  },
  input: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, color: C.text, fontSize: 15 },
  errorBox: {
    backgroundColor: 'rgba(248,81,73,0.12)', borderRadius: 8,
    padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(248,81,73,0.3)',
  },
  errorText: { color: '#F85149', fontSize: 14, textAlign: 'center' },
  btn: {
    backgroundColor: C.primary, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20, gap: 4 },
  switchText: { color: C.textMuted, fontSize: 14 },
  switchLink: { color: C.primary, fontSize: 14, fontWeight: '600' },
  note: { textAlign: 'center', color: '#484F58', fontSize: 12, marginTop: 24 },
});
