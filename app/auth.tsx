import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Crown, User, Mail, Lock, Eye, EyeOff, Check, Phone, MapPin, ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';

function validateTWPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^09\d{8}$/.test(cleaned);
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState<'form' | 'otp'>('form');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [isBuyer, setIsBuyer] = useState(true);
  const [isSeller, setIsSeller] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // OTP state
  const [otpCode, setOtpCode] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpExpiry, setOtpExpiry] = useState<Date | null>(null);
  const [otpCountdown, setOtpCountdown] = useState(0);

  const [error, setError] = useState<string | null>(null);

  const { login, register, isLoggingIn, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace('/(tabs)');
    }
  }, [user]);

  // Countdown timer for OTP
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const t = setTimeout(() => setOtpCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCountdown]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('請輸入郵箱和密碼');
      return;
    }
    setError(null);
    const result = await login(email.trim(), password);
    if (result.error) {
      setError(result.error);
    }
  };

  const handleRequestOtp = () => {
    setError(null);
    if (!name.trim()) { setError('請填寫姓名'); return; }
    if (!email.trim()) { setError('請填寫電子郵箱'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('請輸入有效的電子郵箱'); return; }
    if (password.length < 4) { setError('密碼至少需要4個字元'); return; }
    if (password !== confirmPassword) { setError('密碼與確認密碼不符'); return; }
    if (!isBuyer && !isSeller) { setError('請至少選擇一種身份'); return; }
    if (!phone.trim()) { setError('請填寫聯絡電話'); return; }
    if (!validateTWPhone(phone)) { setError('請輸入有效的台灣手機號碼（格式：09xxxxxxxx）'); return; }
    if (!address.trim()) { setError('請填寫收貨地址'); return; }

    // Generate 6-digit OTP (in real app this would be sent via SMS)
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(code);
    setOtpExpiry(new Date(Date.now() + 10 * 60 * 1000));
    setOtpCountdown(600);
    setStep('otp');
    setOtpCode('');
    setError(null);
  };

  const handleVerifyAndRegister = async () => {
    setError(null);
    if (!otpCode.trim() || otpCode.length !== 6) {
      setError('請輸入6位驗證碼');
      return;
    }
    if (otpCode !== generatedOtp) {
      setError('驗證碼錯誤，請重新輸入');
      return;
    }
    if (otpExpiry && new Date() > otpExpiry) {
      setError('驗證碼已過期，請重新取得');
      setStep('form');
      return;
    }

    const cleanedPhone = phone.replace(/[\s\-()]/g, '');
    const result = await register(name.trim(), email.trim(), password, isBuyer, isSeller, cleanedPhone, address.trim());
    if (result.error) {
      setError(result.error);
    }
  };

  const handleResendOtp = () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(code);
    setOtpExpiry(new Date(Date.now() + 10 * 60 * 1000));
    setOtpCountdown(600);
    setOtpCode('');
    setError(null);
  };

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Crown size={56} color="#00D4AA" />
          <Text style={styles.title}>暗標競標會</Text>
          <Text style={styles.subtitle}>
            {isLogin ? '登入您的帳戶' : step === 'otp' ? '驗證手機號碼' : '註冊新帳戶'}
          </Text>
        </View>

        <View style={styles.form}>
          {/* ── Login ── */}
          {isLogin && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>電子郵箱 *</Text>
                <View style={styles.inputRow}>
                  <Mail size={20} color="#666" />
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="example@email.com"
                    placeholderTextColor="#444"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>密碼 *</Text>
                <View style={styles.inputRow}>
                  <Lock size={20} color="#666" />
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="輸入密碼"
                    placeholderTextColor="#444"
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={20} color="#666" /> : <Eye size={20} color="#666" />}
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}

          {/* ── Register Step 1: Form ── */}
          {!isLogin && step === 'form' && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>姓名 *</Text>
                <View style={styles.inputRow}>
                  <User size={20} color="#666" />
                  <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="您的真實姓名" placeholderTextColor="#444" autoCapitalize="words" />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>電子郵箱 *</Text>
                <View style={styles.inputRow}>
                  <Mail size={20} color="#666" />
                  <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="example@email.com" placeholderTextColor="#444" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>密碼 *</Text>
                <View style={styles.inputRow}>
                  <Lock size={20} color="#666" />
                  <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="至少4個字元" placeholderTextColor="#444" secureTextEntry={!showPassword} autoCapitalize="none" />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={20} color="#666" /> : <Eye size={20} color="#666" />}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>確認密碼 *</Text>
                <View style={styles.inputRow}>
                  <Lock size={20} color="#666" />
                  <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="請再輸入一次密碼" placeholderTextColor="#444" secureTextEntry={!showPassword} autoCapitalize="none" />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>聯絡手機 * <Text style={styles.requiredHint}>（用於競標通知與交付聯繫）</Text></Text>
                <View style={styles.inputRow}>
                  <Phone size={20} color="#666" />
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="09xxxxxxxx"
                    placeholderTextColor="#444"
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                  {validateTWPhone(phone) && <Check size={18} color="#00D4AA" />}
                </View>
                {phone.length > 0 && !validateTWPhone(phone) && (
                  <Text style={styles.fieldError}>格式：09xxxxxxxx（10位數字）</Text>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>收貨地址 * <Text style={styles.requiredHint}>（用於商品交付）</Text></Text>
                <View style={[styles.inputRow, styles.inputRowMultiline]}>
                  <MapPin size={20} color="#666" style={{ marginTop: 2 }} />
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={address}
                    onChangeText={setAddress}
                    placeholder="請填寫完整收貨地址"
                    placeholderTextColor="#444"
                    multiline
                    numberOfLines={2}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>選擇身份（可複選）*</Text>
                <View style={styles.roleSelection}>
                  <TouchableOpacity style={[styles.roleOption, isBuyer && styles.roleOptionActive]} onPress={() => setIsBuyer(!isBuyer)}>
                    {isBuyer && <Check size={16} color="#000" />}
                    <Text style={[styles.roleOptionText, isBuyer && styles.roleOptionTextActive]}>買家</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.roleOption, isSeller && styles.roleOptionActive]} onPress={() => setIsSeller(!isSeller)}>
                    {isSeller && <Check size={16} color="#000" />}
                    <Text style={[styles.roleOptionText, isSeller && styles.roleOptionTextActive]}>賣家</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.roleHint}>選擇賣家身份後可同時擔任買家與賣家角色</Text>
              </View>
            </>
          )}

          {/* ── Register Step 2: OTP ── */}
          {!isLogin && step === 'otp' && (
            <>
              <View style={styles.otpInfoBox}>
                <ShieldCheck size={28} color="#00D4AA" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.otpInfoTitle}>手機號碼驗證</Text>
                  <Text style={styles.otpInfoText}>
                    驗證碼已傳送至 {phone}（模擬）
                  </Text>
                </View>
              </View>

              {/* Demo: show the code */}
              <View style={styles.demoOtpBox}>
                <Text style={styles.demoOtpLabel}>測試用驗證碼（實際上會發送簡訊）</Text>
                <Text style={styles.demoOtpCode}>{generatedOtp}</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>輸入6位驗證碼 *</Text>
                <View style={styles.inputRow}>
                  <ShieldCheck size={20} color="#666" />
                  <TextInput
                    style={[styles.input, styles.otpInput]}
                    value={otpCode}
                    onChangeText={v => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="______"
                    placeholderTextColor="#444"
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
                </View>
              </View>

              <View style={styles.otpActions}>
                {otpCountdown > 0 ? (
                  <Text style={styles.countdownText}>驗證碼將於 {formatCountdown(otpCountdown)} 後過期</Text>
                ) : (
                  <Text style={styles.expiredText}>驗證碼已過期</Text>
                )}
                <TouchableOpacity onPress={handleResendOtp}>
                  <Text style={styles.resendText}>重新取得</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.backLink}
                onPress={() => { setStep('form'); setError(null); }}
              >
                <Text style={styles.backLinkText}>返回修改資料</Text>
              </TouchableOpacity>
            </>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, isLoggingIn && styles.disabled]}
            onPress={isLogin ? handleLogin : step === 'form' ? handleRequestOtp : handleVerifyAndRegister}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.submitButtonText}>
                {isLogin ? '登入' : step === 'form' ? '取得驗證碼' : '完成註冊'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.switchMode}>
            <Text style={styles.switchModeText}>
              {isLogin ? '還沒有帳戶？' : '已有帳戶？'}
            </Text>
            <TouchableOpacity onPress={() => { setIsLogin(!isLogin); setStep('form'); setError(null); }}>
              <Text style={styles.switchModeLink}>
                {isLogin ? '立即註冊' : '前往登入'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.demoAccounts}>
          <Text style={styles.demoTitle}>測試帳號</Text>
          <Text style={styles.demoText}>賣家: seller1@test.com</Text>
          <Text style={styles.demoText}>買家: buyer1@test.com</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  scrollContent: { padding: 24, paddingTop: 60, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 16 },
  subtitle: { fontSize: 16, color: '#888', marginTop: 8 },
  form: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
    marginBottom: 24,
  },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontSize: 14, color: '#888', marginBottom: 8 },
  requiredHint: { fontSize: 12, color: '#555' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D1A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  inputRowMultiline: { alignItems: 'flex-start', paddingVertical: 10 },
  input: { flex: 1, padding: 14, color: '#fff', fontSize: 16 },
  textArea: { minHeight: 60, textAlignVertical: 'top', paddingTop: 4 },
  otpInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '700' },
  fieldError: { color: '#FF6B6B', fontSize: 12, marginTop: 4 },
  roleSelection: { flexDirection: 'row', gap: 12 },
  roleOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 14, borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  roleOptionActive: { backgroundColor: '#00D4AA', borderColor: '#00D4AA' },
  roleOptionText: { color: '#888', fontSize: 15, fontWeight: '600' },
  roleOptionTextActive: { color: '#000' },
  roleHint: { fontSize: 12, color: '#666', marginTop: 8 },
  otpInfoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(0, 212, 170, 0.1)',
    borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: 'rgba(0, 212, 170, 0.3)',
    marginBottom: 20,
  },
  otpInfoTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 2 },
  otpInfoText: { color: '#888', fontSize: 13 },
  demoOtpBox: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.3)',
    alignItems: 'center', marginBottom: 20,
  },
  demoOtpLabel: { color: '#888', fontSize: 12, marginBottom: 6 },
  demoOtpCode: { color: '#FFD700', fontSize: 32, fontWeight: '800', letterSpacing: 8 },
  otpActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  countdownText: { color: '#888', fontSize: 13 },
  expiredText: { color: '#FF6B6B', fontSize: 13, fontWeight: '600' },
  resendText: { color: '#00D4AA', fontSize: 13, fontWeight: '600' },
  backLink: { alignItems: 'center', marginBottom: 16 },
  backLinkText: { color: '#888', fontSize: 13 },
  errorBox: {
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderRadius: 8, padding: 14,
    marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(255, 107, 107, 0.3)',
  },
  errorText: { color: '#FF6B6B', fontSize: 14, textAlign: 'center' },
  submitButton: {
    backgroundColor: '#00D4AA', borderRadius: 12, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  disabled: { opacity: 0.6 },
  submitButtonText: { color: '#000', fontSize: 18, fontWeight: '700' },
  switchMode: { flexDirection: 'row', justifyContent: 'center', marginTop: 20, gap: 4 },
  switchModeText: { color: '#888', fontSize: 14 },
  switchModeLink: { color: '#00D4AA', fontSize: 14, fontWeight: '600' },
  demoAccounts: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.2)',
  },
  demoTitle: { color: '#FFD700', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  demoText: { color: '#888', fontSize: 12, marginBottom: 4 },
});
