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
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Crown, User, Mail, Lock, Eye, EyeOff, Check, Phone, MapPin, ShieldCheck, FileText, X, ChevronRight, KeyRound, ArrowLeft } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { callRpc, supabase, sendPhoneOtp } from '../lib/supabase';

function validateTWPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^09\d{8}$/.test(cleaned);
}

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [showTerms, setShowTerms] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [forgotStep, setForgotStep] = useState<'identify' | 'otp' | 'reset'>('identify');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotToken, setForgotToken] = useState<string | null>(null);
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotShowPassword, setForgotShowPassword] = useState(false);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

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
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);

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

  const handleRequestOtp = async () => {
    setError(null);
    if (!name.trim()) { setError('請填寫姓名'); return; }
    if (!email.trim()) { setError('請填寫電子郵箱'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('請輸入有效的電子郵箱'); return; }
    if (password.length < 8) { setError('密碼至少需要8個字元'); return; }
    if (password !== confirmPassword) { setError('密碼與確認密碼不符'); return; }
    if (!isBuyer && !isSeller) { setError('請至少選擇一種身份'); return; }
    if (!phone.trim()) { setError('請填寫聯絡電話'); return; }
    if (!validateTWPhone(phone)) { setError('請輸入有效的台灣手機號碼（格式：09xxxxxxxx）'); return; }
    if (!address.trim()) { setError('請填寫收貨地址'); return; }

    setOtpSending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        setError(otpError.message || '驗證碼發送失敗，請稍後再試');
        return;
      }
      setOtpCountdown(600);
      setStep('otp');
      setOtpCode('');
      setError(null);
    } catch {
      setError('驗證碼發送失敗，請檢查網路連線');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyAndRegister = async () => {
    setError(null);
    if (!otpCode.trim() || otpCode.length !== 6) {
      setError('請輸入6位驗證碼');
      return;
    }

    setOtpVerifying(true);
    try {
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otpCode,
        type: 'email',
      });

      if (verifyErr) {
        setError(verifyErr.message || '驗證碼驗證失敗');
        return;
      }

      const cleanedPhone = phone.replace(/[\s\-()]/g, '');
      const result = await register(name.trim(), email.trim(), password, isBuyer, isSeller, cleanedPhone, address.trim());
      if (result.error) {
        setError(result.error);
      }
    } catch {
      setError('驗證失敗，請稍後再試');
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    setError(null);
    setOtpSending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        setError(otpError.message || '重新發送失敗');
        return;
      }
      setOtpCountdown(600);
      setOtpCode('');
      setError(null);
    } catch {
      setError('重新發送失敗，請稍後再試');
    } finally {
      setOtpSending(false);
    }
  };

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const handleForgotRequest = async () => {
    setError(null);
    if (!forgotEmail.trim()) { setError('請輸入註冊時的郵箱'); return; }
    if (!/^[^s@]+@[^s@]+\.[^s@]+$/.test(forgotEmail.trim())) { setError('請輸入有效的電子郵箱'); return; }
    if (!validateTWPhone(forgotPhone)) { setError('請輸入有效的台灣手機號碼'); return; }

    setForgotSubmitting(true);
    try {
      const cleanedPhone = forgotPhone.replace(/[\s\-()]/g, '');
      const { data, error: rpcErr } = await callRpc('rpc_request_password_reset', {
        p_email: forgotEmail.trim().toLowerCase(),
        p_phone: cleanedPhone,
      });
      if (rpcErr || data?.error) {
        setError('申請失敗，請稍後再試');
        return;
      }

      // The one-time code is delivered by SMS to the phone number on the account.
      const { ok, error: otpError } = await sendPhoneOtp(cleanedPhone);
      if (!ok) {
        setError(otpError || '驗證碼發送失敗');
        return;
      }
      setOtpCountdown(600);
      setForgotStep('otp');
      setForgotOtp('');
    } catch {
      setError('申請失敗，請檢查網路連線');
    } finally {
      setForgotSubmitting(false);
    }
  };

  const handleForgotVerifyOtp = async () => {
    setError(null);
    if (forgotOtp.length !== 6) { setError('請輸入6位驗證碼'); return; }

    setForgotSubmitting(true);
    try {
      const { data, error: rpcErr } = await callRpc('rpc_verify_otp', {
        p_phone: forgotPhone.replace(/[\s\-()]/g, ''),
        p_code: forgotOtp.trim(),
      });
      if (rpcErr || data?.error || !data?.success) {
        setError(data?.error || '驗證碼錯誤');
        return;
      }
      setForgotToken(forgotOtp.trim());
      setForgotStep('reset');
    } catch {
      setError('驗證失敗，請稍後再試');
    } finally {
      setForgotSubmitting(false);
    }
  };

  const handleForgotResetPassword = async () => {
    setError(null);
    if (forgotNewPassword.length < 8) { setError('新密碼至少需要8個字元'); return; }
    if (forgotNewPassword !== forgotConfirmPassword) { setError('兩次輸入的密碼不一致'); return; }
    if (!forgotToken) { setError('重設資料已過期，請重新申請'); return; }

    setForgotSubmitting(true);
    try {
      const { data, error: rpcErr } = await callRpc('rpc_reset_password_v2', {
        p_email: forgotEmail.trim().toLowerCase(),
        p_phone: forgotPhone.replace(/[\s\-()]/g, ''),
        p_code: forgotToken,
        p_new_password: forgotNewPassword,
      });
      if (rpcErr || data?.error) {
        setError(data?.error || '重設失敗，請稍後再試');
        return;
      }
      setForgotSuccess(true);
      setTimeout(() => {
        setForgotPassword(false);
        setForgotSuccess(false);
        setForgotStep('identify');
        setForgotEmail('');
        setForgotPhone('');
        setForgotToken(null);
        setForgotOtp('');
        setForgotNewPassword('');
        setForgotConfirmPassword('');
        setIsLogin(true);
        setError(null);
      }, 2500);
    } catch {
      setError('重設失敗，請稍後再試');
    } finally {
      setForgotSubmitting(false);
    }
  };

  const handleForgotResendOtp = async () => {
    setError(null);
    setForgotSubmitting(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: forgotEmail.trim().toLowerCase(),
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        setError(otpError.message || '重新發送失敗');
        return;
      }
      setOtpCountdown(600);
      setForgotOtp('');
    } catch {
      setError('重新發送失敗');
    } finally {
      setForgotSubmitting(false);
    }
  };

  const resetForgotPassword = () => {
    setForgotPassword(false);
    setForgotStep('identify');
    setForgotEmail('');
    setForgotPhone('');
    setForgotToken(null);
    setForgotOtp('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setError(null);
  };

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
          {forgotPassword ? (
            <TouchableOpacity style={styles.backToLogin} onPress={resetForgotPassword}>
              <ArrowLeft size={20} color="#888" />
              <Text style={styles.backToLoginText}>返回登入</Text>
            </TouchableOpacity>
          ) : null}
          <Crown size={56} color="#00D4AA" />
          <Text style={styles.title}>暗標競標會</Text>
          <Text style={styles.subtitle}>
            {forgotPassword
              ? forgotSuccess ? '密碼已重設' : forgotStep === 'identify' ? '忘記密碼' : forgotStep === 'otp' ? '驗證手機' : '設定新密碼'
              : isLogin ? '登入您的帳戶' : step === 'otp' ? '驗證信箱' : '註冊新帳戶'}
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
                  <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="至少8個字元" placeholderTextColor="#444" secureTextEntry={!showPassword} autoCapitalize="none" />
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
                <Text style={styles.inputLabel}>聯絡手機 * <Text style={styles.requiredHint}>（用於競標通知與交付聯繫，驗證碼已改為 email 發送）</Text></Text>
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
                  <Text style={styles.otpInfoTitle}>信箱驗證</Text>
                  <Text style={styles.otpInfoText}>
                    驗證碼已發送至 {email}
                  </Text>
                </View>
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
                <TouchableOpacity onPress={handleResendOtp} disabled={otpSending}>
                  <Text style={[styles.resendText, otpSending && { opacity: 0.5 }]}>{otpSending ? '發送中...' : '重新取得'}</Text>
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

          {forgotPassword ? (
            <>
              {forgotSuccess ? (
                <View style={styles.forgotSuccessBox}>
                  <Check size={40} color="#00D4AA" />
                  <Text style={styles.forgotSuccessText}>密碼重設成功！</Text>
                  <Text style={styles.forgotSuccessSub}>即將返回登入頁面，請使用新密碼登入。</Text>
                </View>
              ) : forgotStep === 'identify' ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>註冊時的電子郵箱 *</Text>
                    <View style={styles.inputRow}>
                      <Mail size={20} color="#666" />
                      <TextInput
                        style={styles.input}
                        value={forgotEmail}
                        onChangeText={setForgotEmail}
                        placeholder="example@email.com"
                        placeholderTextColor="#444"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>註冊時的手機號碼 *</Text>
                    <View style={styles.inputRow}>
                      <Phone size={20} color="#666" />
                      <TextInput
                        style={styles.input}
                        value={forgotPhone}
                        onChangeText={setForgotPhone}
                        placeholder="09xxxxxxxx"
                        placeholderTextColor="#444"
                        keyboardType="phone-pad"
                        maxLength={10}
                      />
                      {validateTWPhone(forgotPhone) && <Check size={18} color="#00D4AA" />}
                    </View>
                    {forgotPhone.length > 0 && !validateTWPhone(forgotPhone) && (
                      <Text style={styles.fieldError}>格式：09xxxxxxxx（10位數字）</Text>
                    )}
                  </View>

                  <Text style={styles.forgotHint}>系統將發送驗證碼到您的電子郵箱，驗證後可設定新密碼。</Text>

n                  <TouchableOpacity
                    style={[styles.submitButton, forgotSubmitting && styles.disabled]}
                    onPress={handleForgotRequest}
                    disabled={forgotSubmitting}
                  >
                    {forgotSubmitting ? <ActivityIndicator color="#000" /> : (
                      <Text style={styles.submitButtonText}>發送驗證碼</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : forgotStep === 'otp' ? (
                <>
                  <View style={styles.otpInfoBox}>
                    <ShieldCheck size={28} color="#00D4AA" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.otpInfoTitle}>手機驗證</Text>
                      <Text style={styles.otpInfoText}>驗證碼已以簡訊發送至帳戶手機</Text>
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>輸入6位驗證碼 *</Text>
                    <View style={styles.inputRow}>
                      <ShieldCheck size={20} color="#666" />
                      <TextInput
                        style={[styles.input, styles.otpInput]}
                        value={forgotOtp}
                        onChangeText={v => setForgotOtp(v.replace(/\D/g, '').slice(0, 6))}
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
                    <TouchableOpacity onPress={handleForgotResendOtp} disabled={forgotSubmitting}>
                      <Text style={[styles.resendText, forgotSubmitting && { opacity: 0.5 }]}>{forgotSubmitting ? '發送中...' : '重新取得'}</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.submitButton, forgotSubmitting && styles.disabled]}
                    onPress={handleForgotVerifyOtp}
                    disabled={forgotSubmitting}
                  >
                    {forgotSubmitting ? <ActivityIndicator color="#000" /> : (
                      <Text style={styles.submitButtonText}>驗證</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>設定新密碼 *</Text>
                    <View style={styles.inputRow}>
                      <KeyRound size={20} color="#666" />
                      <TextInput
                        style={styles.input}
                        value={forgotNewPassword}
                        onChangeText={setForgotNewPassword}
                        placeholder="至少8個字元"
                        placeholderTextColor="#444"
                        secureTextEntry={!forgotShowPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity onPress={() => setForgotShowPassword(!forgotShowPassword)}>
                        {forgotShowPassword ? <EyeOff size={20} color="#666" /> : <Eye size={20} color="#666" />}
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>確認新密碼 *</Text>
                    <View style={styles.inputRow}>
                      <KeyRound size={20} color="#666" />
                      <TextInput
                        style={styles.input}
                        value={forgotConfirmPassword}
                        onChangeText={setForgotConfirmPassword}
                        placeholder="請再輸入一次新密碼"
                        placeholderTextColor="#444"
                        secureTextEntry={!forgotShowPassword}
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.submitButton, forgotSubmitting && styles.disabled]}
                    onPress={handleForgotResetPassword}
                    disabled={forgotSubmitting}
                  >
                    {forgotSubmitting ? <ActivityIndicator color="#000" /> : (
                      <Text style={styles.submitButtonText}>重設密碼</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.submitButton, (isLoggingIn || otpSending || otpVerifying) && styles.disabled]}
                onPress={isLogin ? handleLogin : step === 'form' ? handleRequestOtp : handleVerifyAndRegister}
                disabled={isLoggingIn || otpSending || otpVerifying}
              >
                {(isLoggingIn || otpSending || otpVerifying) ? (
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

              {isLogin && (
                <TouchableOpacity style={styles.forgotLink} onPress={() => { setForgotPassword(true); setError(null); }}>
                  <Text style={styles.forgotLinkText}>忘記密碼？</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <TouchableOpacity style={styles.termsButton} onPress={() => setShowTerms(true)}>
          <FileText size={16} color="#555" />
          <Text style={styles.termsButtonText}>查看使用規則與注意事項</Text>
          <ChevronRight size={14} color="#555" />
        </TouchableOpacity>
      </ScrollView>

      {/* Terms Modal */}
      <Modal
        visible={showTerms}
        animationType="slide"
        transparent
        onRequestClose={() => setShowTerms(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <FileText size={22} color="#00D4AA" />
                <Text style={styles.modalTitle}>使用規則與注意事項</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTerms(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={22} color="#888" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.termsUpdated}>最後更新：2026年7月</Text>

              <TermsSection title="一、平台說明">
                <TermsParagraph>
                  「暗標競標會」（以下簡稱「本平台」）為線上暗標（密封投標）競標平台。所有出價在競標結束前對其他參與者完全保密，僅由系統記錄，確保公平競標。
                </TermsParagraph>
              </TermsSection>

              <TermsSection title="二、帳戶規則">
                <TermsBullet>每位用戶限申請一個帳戶，嚴禁使用多帳戶參與同一商品競標。</TermsBullet>
                <TermsBullet>註冊時請填寫真實姓名、有效電子郵箱及台灣手機號碼，以便聯絡與交付。</TermsBullet>
                <TermsBullet>帳戶密碼請妥善保管，因密碼外洩導致的損失由用戶自行負責。</TermsBullet>
                <TermsBullet>帳戶資料如有變更（電話、地址），請立即於個人資料頁面更新。</TermsBullet>
              </TermsSection>

              <TermsSection title="三、暗標競標規則">
                <TermsBullet>競標採密封出價制，出價送出後不得修改或撤銷。</TermsBullet>
                <TermsBullet>競標期間所有出價金額對其他競標者保密，由系統統一記錄。</TermsBullet>
                <TermsBullet>競標結束時，出價最高者為得標者；若有最高出價相同，以先出價者優先。</TermsBullet>
                <TermsBullet>部分商品設有保留底價，未達底價則流標，無人得標。</TermsBullet>
                <TermsBullet>部分商品提供直接購買選項，可免競標直接以固定價格購入。</TermsBullet>
              </TermsSection>

              <TermsSection title="四、買家守則">
                <TermsBullet>出價前請確認商品資訊、圖片及說明，出價即視為同意以該金額購買。</TermsBullet>
                <TermsBullet>得標後請於 72 小時內完成付款，逾期視為棄標，帳戶可能受到處分。</TermsBullet>
                <TermsBullet>棄標紀錄累計達 2 次者，帳戶將被限制競標權限。</TermsBullet>
                <TermsBullet>商品以「現況」出售，請競標前確認您已閱讀並接受商品說明。</TermsBullet>
                <TermsBullet>交付地址請確保準確完整，因地址錯誤造成的遺失由買家負責。</TermsBullet>
              </TermsSection>

              <TermsSection title="五、賣家守則">
                <TermsBullet>刊登商品時，標題、說明及圖片須真實反映商品現況，不得虛假描述。</TermsBullet>
                <TermsBullet>商品圖片須為實際商品照片，禁止使用網路盜圖或誤導性圖片。</TermsBullet>
                <TermsBullet>競標結束後，賣家須於 5 個工作天內完成商品寄送或安排交付。</TermsBullet>
                <TermsBullet>禁止上架違禁品、仿冒品、違法商品，違者帳戶立即停用並依法追究。</TermsBullet>
                <TermsBullet>賣家可設定保留底價，但底價一旦設定不可於競標期間更改。</TermsBullet>
              </TermsSection>

              <TermsSection title="六、禁止行為">
                <TermsBullet>禁止虛假出價、假標（即得標後故意棄標以干擾競標）。</TermsBullet>
                <TermsBullet>禁止買賣雙方私下串通，操控競標結果。</TermsBullet>
                <TermsBullet>禁止騷擾、恐嚇或欺詐其他用戶。</TermsBullet>
                <TermsBullet>禁止上架任何侵犯智慧財產權之商品。</TermsBullet>
                <TermsBullet>禁止嘗試入侵或干擾平台系統正常運作。</TermsBullet>
              </TermsSection>

              <TermsSection title="七、違規處理">
                <TermsParagraph>
                  違反上述規則者，本平台得視情節輕重給予警告、暫停帳戶、或永久封鎖帳戶之處分。情節嚴重者，本平台保留追究法律責任之權利。
                </TermsParagraph>
              </TermsSection>

              <TermsSection title="八、隱私保護">
                <TermsParagraph>
                  您的個人資料（姓名、電話、地址）僅用於競標通知、帳戶管理及商品交付，不會出售或提供給第三方。平台採用加密技術保護您的資料安全。
                </TermsParagraph>
              </TermsSection>

              <TermsSection title="九、免責聲明">
                <TermsParagraph>
                  本平台為買賣媒介，對商品品質、真偽及交易結果不負擔保責任。如發生交易糾紛，本平台將協助調解，但最終責任由交易雙方自行承擔。
                </TermsParagraph>
              </TermsSection>

              <View style={styles.termsFooter}>
                <Text style={styles.termsFooterText}>
                  使用本平台即表示您已閱讀並同意以上所有規則。
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowTerms(false)}>
              <Text style={styles.modalCloseButtonText}>我已閱讀並了解</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function TermsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={termsSectionStyle}>
      <Text style={termsTitleStyle}>{title}</Text>
      {children}
    </View>
  );
}

function TermsBullet({ children }: { children: string }) {
  return (
    <View style={termsBulletRow}>
      <Text style={termsBulletDot}>•</Text>
      <Text style={termsBulletText}>{children}</Text>
    </View>
  );
}

function TermsParagraph({ children }: { children: string }) {
  return <Text style={termsParagraphStyle}>{children}</Text>;
}

const termsSectionStyle: object = { marginBottom: 20 };
const termsTitleStyle: object = { fontSize: 15, fontWeight: '700', color: '#00D4AA', marginBottom: 10 };
const termsBulletRow: object = { flexDirection: 'row', marginBottom: 7, paddingRight: 4 };
const termsBulletDot: object = { color: '#00D4AA', fontSize: 14, marginRight: 8, marginTop: 1 };
const termsBulletText: object = { flex: 1, color: '#aaa', fontSize: 14, lineHeight: 20 };
const termsParagraphStyle: object = { color: '#aaa', fontSize: 14, lineHeight: 20 };

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
  termsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 12,
  },
  termsButtonText: { color: '#555', fontSize: 13 },
  forgotLink: { alignItems: 'center', marginTop: 16 },
  forgotLinkText: { color: '#FFD700', fontSize: 14, fontWeight: '600' },
  forgotHint: { color: '#666', fontSize: 12, lineHeight: 18, marginBottom: 16, marginTop: -8 },
  forgotSuccessBox: { alignItems: 'center', paddingVertical: 40 },
  forgotSuccessText: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 12 },
  forgotSuccessSub: { color: '#aaa', fontSize: 14, marginTop: 8, textAlign: 'center' },
  backToLogin: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  backToLoginText: { color: '#888', fontSize: 14 },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#1A1A2E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    borderTopWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  modalScroll: { paddingHorizontal: 20, paddingTop: 16 },
  termsUpdated: { color: '#444', fontSize: 12, marginBottom: 20 },
  termsFooter: {
    marginTop: 8,
    marginBottom: 24,
    padding: 14,
    backgroundColor: 'rgba(0, 212, 170, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
  },
  termsFooterText: { color: '#00D4AA', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  modalCloseButton: {
    margin: 16,
    backgroundColor: '#00D4AA',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  modalCloseButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
