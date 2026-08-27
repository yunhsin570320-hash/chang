import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Alert,
  Image,
  Platform,
} from 'react-native';
import {
  User, Package, Crown, Bell, BellOff, Phone, CreditCard,
  MapPin, Building2, Edit3, Check, X, ChevronRight, Trophy, ShieldCheck, ShieldAlert,
  Lock, Unlock, AlertCircle, Zap, Camera, Upload, Clock, ScrollText, Users,
} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { supabase, callRpc, Bid, Product, Notification, uploadPaymentProof, sendPhoneOtp, PaymentRequest, getMemberStats, MemberStats } from '../../lib/supabase';
import { WebCamera } from '../../components/WebCamera';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

interface BidWithProduct extends Bid {
  product?: Product;
}

type ProfileTab = 'info' | 'bids' | 'notifications';

const PAYMENT_OPTIONS = ['銀行匯款', 'Line Pay', 'Apple Pay', '現金'];

function validateTWPhone(phone: string): boolean {
  return /^09\d{8}$/.test(phone.replace(/[\s\-()]/g, ''));
}

export default function ProfilePage() {
  const [myBids, setMyBids] = useState<BidWithProduct[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('info');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [editPhone, setEditPhone] = useState('');
  const [editPayment, setEditPayment] = useState('');
  const [editBankAccount, setEditBankAccount] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Phone OTP state
  const [phoneChanged, setPhoneChanged] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [otpVerified, setOtpVerified] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const { user, currentRole, switchRole, logout, canSwitchRoles, refreshUser, sessionToken } = useAuth();
  const router = useRouter();

  // Payment request state
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentType, setPaymentType] = useState<'vip_upgrade' | 'vip_deposit'>('vip_upgrade');
  const [paymentProof, setPaymentProof] = useState<string | null>(null);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [siteSettings, setSiteSettings] = useState<Record<string, string>>({});
  const [complaintModal, setComplaintModal] = useState(false);
  const [complaintReason, setComplaintReason] = useState('');
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);
  const [complaintError, setComplaintError] = useState<string | null>(null);
  const [complaintSuccess, setComplaintSuccess] = useState(false);
  const [rulesModalVisible, setRulesModalVisible] = useState(false);
  const [memberStats, setMemberStats] = useState<MemberStats | null>(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const profileComplete = !!(user?.phone && user?.shipping_address);

  // OTP countdown
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const t = setTimeout(() => setOtpCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCountdown]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [notifResult, paymentResult, settingsResult, statsResult, myBidsResult] = await Promise.all([
        supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('payment_requests')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        callRpc('rpc_get_site_settings').then(({ data }) => data?.settings as Record<string, string> || {}),
        getMemberStats(),
        callRpc<BidWithProduct[]>('rpc_get_my_bids', { p_token: sessionToken }),
      ]);
      setMyBids(myBidsResult.data || []);
      setNotifications(notifResult.data || []);
      setPaymentRequests((paymentResult.data || []) as PaymentRequest[]);
      if (settingsResult) {
        setSiteSettings(settingsResult as Record<string, string>);
      }
      if (statsResult) setMemberStats(statsResult);
    } catch (error) {
      console.error('Error fetching profile data:', error);
    } finally {
      setLoading(false);
    }
  }, [user, sessionToken]);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        setLoading(true);
        fetchData();
      }
    }, [user, fetchData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const openEditModal = () => {
    setEditPhone(user?.phone || '');
    setEditPayment(user?.payment_method || '');
    setEditBankAccount(user?.bank_account || '');
    setEditAddress(user?.shipping_address || '');
    setEditError(null);
    setPhoneChanged(false);
    setOtpStep(false);
    setOtpVerified(false);
    setOtpCode('');
    setDevCode(null);
    setEditModalVisible(true);
  };

  const handlePhoneChange = (val: string) => {
    const cleaned = val.replace(/[^\d]/g, '').slice(0, 10);
    setEditPhone(cleaned);
    setPhoneChanged(cleaned !== (user?.phone || ''));
    setOtpVerified(false);
    setOtpStep(false);
  };

  // Need verification if phone changed, or phone exists but not yet verified
  const needsOtpVerification =
    (phoneChanged && !otpVerified) ||
    (!phoneChanged && !!editPhone && !user?.phone_verified && !otpVerified);

  // The code is generated and checked on the server and delivered by SMS; the
  // browser never sees it.
  const sendOtp = async () => {
    if (!validateTWPhone(editPhone)) {
      setEditError('請輸入有效的台灣手機號碼（格式：09xxxxxxxx）');
      return;
    }
    setEditError(null);
    const { ok, error, devCode: dc } = await sendPhoneOtp(editPhone);
    if (!ok) {
      setEditError(error || '驗證碼發送失敗，請稍後再試');
      return;
    }
    setDevCode(dc ?? null);
    setOtpCountdown(600);
    setOtpStep(true);
    setOtpCode('');
  };

  const verifyOtp = async () => {
    if (otpCountdown <= 0) {
      setEditError('驗證碼已過期，請重新取得');
      return;
    }
    const { data, error } = await callRpc('rpc_verify_otp', {
      p_phone: editPhone,
      p_code: otpCode.trim(),
    });
    if (error || data?.error || !data?.success) {
      setEditError(data?.error || '驗證碼錯誤，請重新輸入');
      return;
    }
    setOtpVerified(true);
    setOtpStep(false);
    setEditError(null);
  };

  const saveProfile = async () => {
    if (!user) return;
    setEditError(null);

    // Enforce required fields
    if (!editPhone.trim()) {
      setEditError('聯絡電話為必填欄位');
      return;
    }
    if (!validateTWPhone(editPhone)) {
      setEditError('請輸入有效的台灣手機號碼（格式：09xxxxxxxx）');
      return;
    }
    if (!editAddress.trim()) {
      setEditError('收貨地址為必填欄位');
      return;
    }


    setSaving(true);
    try {
      const { data: result, error: rpcError } = await callRpc('rpc_update_profile', {
        p_token: sessionToken,
        p_phone: editPhone.trim(),
        p_payment_method: editPayment.trim() || null,
        p_bank_account: editBankAccount.trim() || null,
        p_shipping_address: editAddress.trim(),
      });
      if (rpcError) {
        setEditError(rpcError.message);
        return;
      }
      if (result?.error) {
        setEditError(result.error);
        return;
      }
      await refreshUser();
      setEditModalVisible(false);
    } catch (e) {
      setEditError('儲存失敗，請稍後再試');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const markAllRead = async () => {
    if (!user || unreadCount === 0) return;
    await callRpc('rpc_mark_notifications_read', { p_token: sessionToken, p_all: true });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const openPaymentModal = (type: 'vip_upgrade' | 'vip_deposit') => {
    setPaymentType(type);
    setPaymentProof(null);
    setPaymentError(null);
    setPaymentModalVisible(true);
  };

  const handleCaptureProof = (dataUrl: string) => {
    setPaymentProof(dataUrl);
    setCameraVisible(false);
  };

  const handleFileSelect = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setPaymentProof(reader.result as string);
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleSubmitPayment = async () => {
    if (!sessionToken || !paymentProof) return;
    setSubmittingPayment(true);
    setPaymentError(null);
    try {
      const proofUrl = await uploadPaymentProof(paymentProof, sessionToken);
      const { data, error } = await callRpc('rpc_submit_payment_request', {
        p_token: sessionToken,
        p_type: paymentType,
        p_payment_method: user?.payment_method || null,
        p_proof_image_url: proofUrl,
      });
      if (error || data?.error) {
        setPaymentError(data?.error || '提交失敗，請稍後再試');
        return;
      }
      setPaymentModalVisible(false);
      await fetchData();
      Alert.alert('已提交', '繳費申請已送出，請等候管理員審核。審核通過後將自動升級。');
    } catch (e: any) {
      console.error('payment request failed', e);
      setPaymentError('提交失敗，請稍後再試');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const getPendingRequest = (type: 'vip_upgrade' | 'vip_deposit') =>
    paymentRequests.find(r => r.type === type && r.status === 'pending');

  const handleFileComplaint = async () => {
    if (!sessionToken || !complaintReason.trim()) return;
    setComplaintSubmitting(true);
    setComplaintError(null);
    try {
      const { data, error } = await callRpc('rpc_file_complaint', {
        p_token: sessionToken,
        p_reason: complaintReason.trim(),
      });
      if (error || data?.error) {
        setComplaintError(data?.error || '提交失敗，請稍後再試');
        return;
      }
      setComplaintSuccess(true);
      await refreshUser();
    } catch {
      setComplaintError('提交失敗，請稍後再試');
    } finally {
      setComplaintSubmitting(false);
    }
  };

  const markRead = async (id: string) => {
    await callRpc('rpc_mark_notifications_read', { p_token: sessionToken, p_notification_id: id });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const renderBidItem = ({ item }: { item: BidWithProduct }) => {
    const isWinner = item.product?.winner_id === user?.id;
    const isEnded = item.product?.status === 'ended';

    return (
      <TouchableOpacity
        style={styles.bidCard}
        onPress={() => item.product?.id && router.push(`/product/${item.product.id}`)}
      >
        <View style={styles.bidHeader}>
          <Text style={styles.productName} numberOfLines={1}>{item.product?.name || '未知商品'}</Text>
          <View style={[styles.resultBadge, !isEnded ? styles.activeBadge : isWinner ? styles.winnerBadge : styles.endedBadge]}>
            <Text style={[styles.resultText, isEnded && isWinner && styles.winnerResultText]}>
              {!isEnded ? '競標中' : isWinner ? '得標' : '未得標'}
            </Text>
          </View>
        </View>
        <View style={styles.bidAmountRow}>
          <Text style={styles.bidLabel}>您的出價</Text>
          <Text style={styles.bidAmount}>NT$ {item.amount.toLocaleString()}</Text>
        </View>
        {isEnded && item.product && (
          <Text style={styles.winningAmountText}>
            得標金額: NT$ {item.product.winning_amount?.toLocaleString() || 0}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderNotification = ({ item }: { item: Notification }) => {
    const isWon = item.type === 'won';
    return (
      <TouchableOpacity
        style={[styles.notifCard, !item.is_read && styles.notifCardUnread]}
        onPress={() => { markRead(item.id); if (item.product_id) router.push(`/product/${item.product_id}`); }}
      >
        <View style={[styles.notifIcon, { backgroundColor: isWon ? 'rgba(255,215,0,0.15)' : 'rgba(255,107,107,0.15)' }]}>
          {isWon ? <Trophy size={20} color="#FFD700" /> : <BellOff size={20} color="#FF6B6B" />}
        </View>
        <View style={styles.notifBody}>
          <View style={styles.notifTitleRow}>
            <Text style={styles.notifTitle}>{item.title}</Text>
            {!item.is_read && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.notifMessage} numberOfLines={2}>{item.message}</Text>
          <Text style={styles.notifTime}>
            {new Date(item.created_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (!user) return null;

  const phoneVerified = user.phone_verified;
  const needsPhone = !user.phone || !validateTWPhone(user.phone);
  const needsAddress = !user.shipping_address;

  return (
    <View style={styles.container}>
      {/* Header — compact single row */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.avatarContainer}>
            <User size={20} color="#00D4AA" />
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user.email}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.rolesContainer}>
              {user.is_buyer && (
                <View style={styles.roleBadge}>
                  <User size={11} color="#00D4AA" />
                  <Text style={styles.roleText}>買家</Text>
                </View>
              )}
              {user.is_seller && (
                <View style={[styles.roleBadge, styles.sellerBadge]}>
                  <Crown size={11} color="#FFD700" />
                  <Text style={[styles.roleText, styles.sellerText]}>賣家</Text>
                </View>
              )}
            </View>
            {canSwitchRoles() && (
              <View style={styles.roleSwitcherInline}>
                <TouchableOpacity style={[styles.roleButton, currentRole === 'buyer' && styles.roleButtonActive]} onPress={() => switchRole('buyer')}>
                  <User size={13} color={currentRole === 'buyer' ? '#000' : '#00D4AA'} />
                  <Text style={[styles.roleButtonText, currentRole === 'buyer' && styles.roleButtonTextActive]}>買家</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.roleButton, currentRole === 'seller' && styles.roleButtonActiveSeller]} onPress={() => switchRole('seller')}>
                  <Crown size={13} color={currentRole === 'seller' ? '#000' : '#FFD700'} />
                  <Text style={[styles.roleButtonText, currentRole === 'seller' && styles.roleButtonTextActive]}>賣家</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {(!profileComplete || !phoneVerified) && (
          <TouchableOpacity style={styles.incompleteBanner} onPress={() => { setActiveTab('info'); openEditModal(); }}>
            <ShieldAlert size={14} color="#FFD700" />
            <Text style={styles.incompleteBannerText}>
              {needsPhone ? '請填寫並驗證手機號碼' : !phoneVerified ? '手機號碼尚未驗證' : '請填寫收貨地址'}
            </Text>
            <ChevronRight size={14} color="#FFD700" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, activeTab === 'info' && styles.tabActive]} onPress={() => setActiveTab('info')}>
          <Text style={[styles.tabText, activeTab === 'info' && styles.tabTextActive]}>個人資料</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'bids' && styles.tabActive]} onPress={() => setActiveTab('bids')}>
          <Text style={[styles.tabText, activeTab === 'bids' && styles.tabTextActive]}>出價紀錄</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'notifications' && styles.tabActive]} onPress={() => setActiveTab('notifications')}>
          <View style={styles.tabWithBadge}>
            <Text style={[styles.tabText, activeTab === 'notifications' && styles.tabTextActive]}>通知</Text>
            {unreadCount > 0 && (
              <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{unreadCount}</Text></View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Info tab */}
      {activeTab === 'info' && (
        <ScrollView style={styles.tabContent} contentContainerStyle={{ paddingBottom: 100 }}>
          <View style={styles.infoSection}>
            <View style={styles.infoSectionHeader}>
              <Text style={styles.infoSectionTitle}>聯絡與付款資料</Text>
              <TouchableOpacity style={styles.editBtn} onPress={openEditModal}>
                <Edit3 size={16} color="#00D4AA" />
                <Text style={styles.editBtnText}>編輯</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              {/* Phone */}
              <View style={styles.infoRow}>
                <Phone size={18} color="#888" />
                <Text style={styles.infoLabel}>聯絡電話 *</Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.infoValue, (!user.phone) && styles.infoValueEmpty]} numberOfLines={1}>
                    {user.phone || '未填寫（必填）'}
                  </Text>
                  {user.phone && phoneVerified && <ShieldCheck size={15} color="#00D4AA" />}
                  {user.phone && !phoneVerified && <ShieldAlert size={15} color="#FFD700" />}
                </View>
              </View>
              {user.phone && !phoneVerified && (
                <Text style={styles.unverifiedNote}>手機號碼尚未驗證，請點擊編輯完成驗證</Text>
              )}

              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <CreditCard size={18} color="#888" />
                <Text style={styles.infoLabel}>付款方式</Text>
                <Text style={[styles.infoValue, !user.payment_method && styles.infoValueEmpty]}>
                  {user.payment_method || '未填寫'}
                </Text>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Building2 size={18} color="#888" />
                <Text style={styles.infoLabel}>收款帳號</Text>
                <Text style={[styles.infoValue, !user.bank_account && styles.infoValueEmpty]}>
                  {user.bank_account || '未填寫'}
                </Text>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <MapPin size={18} color="#888" />
                <Text style={styles.infoLabel}>收貨地址 *</Text>
                <Text style={[styles.infoValue, !user.shipping_address && styles.infoValueEmpty]} numberOfLines={2}>
                  {user.shipping_address || '未填寫（必填）'}
                </Text>
              </View>
            </View>

            {(!profileComplete || !phoneVerified) && (
              <View style={styles.requiredNote}>
                <ShieldAlert size={14} color="#FFD700" />
                <Text style={styles.requiredNoteText}>
                  聯絡電話（需驗證）與收貨地址為必填欄位，請完善以利交付聯繫。
                </Text>
              </View>
            )}
          </View>

          {/* Member stats */}
          {memberStats && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>平台統計</Text>
              <View style={styles.statsRow}>
                <View style={styles.statsCard}>
                  <Users size={18} color="#00D4AA" />
                  <Text style={styles.statsValue}>{memberStats.total_users.toLocaleString()}</Text>
                  <Text style={styles.statsLabel}>會員人數</Text>
                </View>
                <View style={styles.statsCard}>
                  <View style={[styles.onlineDot, styles.onlineDotPulse]} />
                  <Text style={styles.statsValue}>{memberStats.online_count.toLocaleString()}</Text>
                  <Text style={styles.statsLabel}>在線人數</Text>
                </View>
              </View>
              {memberStats.lifetime_members > 0 && (
                <Text style={styles.lifetimeNote}>
                  前 1000 名付費會員為終身制，目前已加入 {memberStats.lifetime_members.toLocaleString()} 人
                </Text>
              )}
            </View>
          )}

          {/* Membership section */}
          {!user.is_admin && (
            <View style={styles.infoSection}>
              <Text style={styles.infoSectionTitle}>會員等級</Text>

              {user.is_blocked ? (
                <View style={styles.lockedCard}>
                  <Lock size={28} color="#FF6B6B" />
                  <Text style={styles.lockedTitle}>帳號已鎖定</Text>
                  <Text style={styles.lockedReason}>
                    {user.lock_reason || user.blocked_reason || '違反平台規範'}
                  </Text>
                  {user.unlock_requested_at ? (
                    <Text style={styles.pendingText}>申訴審核中，請耐心等候管理員處理。</Text>
                  ) : (
                    <TouchableOpacity
                      style={styles.complaintBtn}
                      onPress={() => { setComplaintModal(true); setComplaintReason(''); setComplaintError(null); setComplaintSuccess(false); }}
                    >
                      <Unlock size={16} color="#FFD700" />
                      <Text style={styles.complaintBtnText}>提出申訴</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <View style={styles.membershipCard}>
                  {/* Tier badge */}
                  <View style={styles.tierRow}>
                    <View style={[styles.tierBadge, user.membership_tier === 'vip' ? styles.tierBadgeVip : styles.tierBadgeFree]}>
                      {user.membership_tier === 'vip' ? <Crown size={14} color="#FFD700" /> : <User size={14} color="#888" />}
                      <Text style={[styles.tierBadgeText, user.membership_tier === 'vip' && styles.tierBadgeTextVip]}>
                        {user.membership_tier === 'vip' ? (user.is_lifetime ? '終身會員' : '付費會員') : '免費會員'}
                      </Text>
                    </View>
                    {user.vip_deposit_paid && (
                      <View style={styles.depositBadge}>
                        <ShieldCheck size={12} color="#00D4AA" />
                        <Text style={styles.depositBadgeText}>競標保證金已繳</Text>
                      </View>
                    )}
                  </View>

                  {/* Benefits summary */}
                  <View style={styles.benefitsList}>
                    <View style={styles.benefitRow}>
                      <Text style={styles.benefitLabel}>直購廳</Text>
                      <Text style={styles.benefitValue}>可用</Text>
                    </View>
                    <View style={styles.benefitRow}>
                      <Text style={styles.benefitLabel}>商品上架</Text>
                      <Text style={styles.benefitValue}>{user.membership_tier === 'vip' ? '無限制' : '最多 5 件'}</Text>
                    </View>
                    <View style={styles.benefitRow}>
                      <Text style={styles.benefitLabel}>競價廳競標</Text>
                      <Text style={[styles.benefitValue, !user.vip_deposit_paid && styles.benefitLocked]}>
                        {user.vip_deposit_paid ? '可用' : '需繳保證金'}
                      </Text>
                    </View>
                  </View>

                  {/* Upgrade / deposit buttons */}
                  {user.membership_tier !== 'vip' && (
                    (() => {
                      const pending = getPendingRequest('vip_upgrade');
                      if (pending) {
                        return (
                          <View style={styles.pendingBox}>
                            <Clock size={16} color="#FFD700" />
                            <Text style={styles.pendingBoxText}>平台維護費 NT$500 — 審核中</Text>
                          </View>
                        );
                      }
                      return (
                        <TouchableOpacity
                          style={styles.upgradeBtn}
                          onPress={() => openPaymentModal('vip_upgrade')}
                        >
                          <Zap size={16} color="#000" />
                          <Text style={styles.upgradeBtnText}>繳交平台維護費 · NT$500</Text>
                        </TouchableOpacity>
                      );
                    })()
                  )}
                  {!user.vip_deposit_paid && (
                    (() => {
                      const pending = getPendingRequest('vip_deposit');
                      if (pending) {
                        return (
                          <View style={styles.pendingBox}>
                            <Clock size={16} color="#FFD700" />
                            <Text style={styles.pendingBoxText}>競標保證金 NT$1000 — 審核中</Text>
                          </View>
                        );
                      }
                      return (
                        <TouchableOpacity
                          style={styles.depositBtn}
                          onPress={() => openPaymentModal('vip_deposit')}
                        >
                          <ShieldCheck size={16} color="#FFD700" />
                          <Text style={styles.depositBtnText}>繳納競標保證金 · NT$1000</Text>
                        </TouchableOpacity>
                      );
                    })()
                  )}
                  {user.membership_tier === 'vip' && user.vip_deposit_paid && (
                    <View style={styles.allUnlocked}>
                      <Check size={16} color="#00D4AA" />
                      <Text style={styles.allUnlockedText}>已享有全部會員權益</Text>
                    </View>
                  )}
                  {paymentRequests.filter(r => r.status === 'rejected').length > 0 && (
                    <View style={styles.rejectedNotice}>
                      <AlertCircle size={14} color="#FF6B6B" />
                      <Text style={styles.rejectedNoticeText}>
                        有繳費申請未通過，請重新提交{'\n'}
                        {paymentRequests.filter(r => r.status === 'rejected').slice(-1)[0]?.admin_note || ''}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          <TouchableOpacity style={styles.rulesButton} onPress={() => setRulesModalVisible(true)}>
            <ScrollText size={18} color="#00D4AA" />
            <Text style={styles.rulesButtonText}>使用規則與注意事項</Text>
            <ChevronRight size={16} color="#555" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>登出</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Payment modal */}
      <Modal visible={paymentModalVisible} transparent animationType="slide" onRequestClose={() => setPaymentModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {paymentType === 'vip_upgrade' ? '繳交平台維護費' : '繳納競標保證金'}
              </Text>
              <TouchableOpacity onPress={() => setPaymentModalVisible(false)}>
                <X size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Amount */}
              <View style={styles.paymentAmountBox}>
                <Text style={styles.paymentAmountLabel}>應繳金額</Text>
                <Text style={styles.paymentAmountValue}>
                  NT${paymentType === 'vip_upgrade' ? '500' : '1,000'}
                </Text>
              </View>

              {/* Payment instructions */}
              <View style={styles.paymentInstructions}>
                <Text style={styles.paymentInstructionsTitle}>繳費方式</Text>
                <Text style={styles.paymentAccountLine}>
                  銀行：{siteSettings.payment_bank_name || '待設定'}{'\n'}
                  帳號：{siteSettings.payment_account || '待設定'}{'\n'}
                  戶名：{siteSettings.payment_holder || '待設定'}
                </Text>

                {(siteSettings.payment_bank_name && siteSettings.payment_account) ? (
                  <View style={styles.qrCodeContainer}>
                    <Text style={styles.qrCodeHint}>開啟銀行 App 掃描以下 QR Code 即可快速轉帳</Text>
                    <View style={styles.qrCodeBox}>
                      <QRCode
                        value={`TWQRP://BANK${siteSettings.payment_bank_name}?ACCT=${siteSettings.payment_account}&NAME=${siteSettings.payment_holder || ''}`}
                        size={160}
                        color="#0D0D1A"
                        backgroundColor="#fff"
                      />
                    </View>
                    <Text style={styles.qrCodeAmount}>
                      繳費金額：NT${paymentType === 'vip_upgrade' ? '500' : '1,000'}
                    </Text>
                  </View>
                ) : null}

                {siteSettings.payment_instructions ? (
                  <Text style={styles.paymentInstructionsText}>
                    {siteSettings.payment_instructions.split('\n').map((line, i) => <Text key={i}>{line}{'\n'}</Text>)}
                  </Text>
                ) : (
                  <Text style={styles.paymentInstructionsText}>
                    {'1. 銀行匯款 / 轉帳至以上帳戶\n2. 繳費後請拍攝 / 截圖付款證明\n3. 上傳證明並送出，等候管理員審核'}
                  </Text>
                )}
                <Text style={styles.paymentInstructionsNote}>
                  審核通過後將自動升級，無需額外操作。
                </Text>
              </View>

              {/* Upload proof */}
              <Text style={styles.modalLabel}>上傳付款證明 *</Text>
              {paymentProof ? (
                <View style={styles.proofPreview}>
                  <Image source={{ uri: paymentProof }} style={styles.proofImage} resizeMode="cover" />
                  <TouchableOpacity style={styles.proofRetakeBtn} onPress={() => setPaymentProof(null)}>
                    <X size={16} color="#FF6B6B" />
                    <Text style={styles.proofRetakeText}>重新拍攝</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.uploadOptions}>
                  <TouchableOpacity style={styles.uploadBtn} onPress={() => setCameraVisible(true)}>
                    <Camera size={20} color="#00D4AA" />
                    <Text style={styles.uploadBtnText}>拍照</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.uploadBtn} onPress={handleFileSelect}>
                    <Upload size={20} color="#00D4AA" />
                    <Text style={styles.uploadBtnText}>上傳檔案</Text>
                  </TouchableOpacity>
                </View>
              )}

              {paymentError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{paymentError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, (!paymentProof || submittingPayment) && { opacity: 0.5 }]}
                onPress={handleSubmitPayment}
                disabled={!paymentProof || submittingPayment}
              >
                {submittingPayment ? <ActivityIndicator color="#000" /> : (
                  <><Check size={18} color="#000" /><Text style={styles.saveBtnText}>送出繳費申請</Text></>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* WebCamera for payment proof */}
      <WebCamera
        visible={cameraVisible}
        onCapture={handleCaptureProof}
        onClose={() => setCameraVisible(false)}
      />

      {/* Complaint modal */}
      <Modal visible={complaintModal} transparent animationType="slide" onRequestClose={() => setComplaintModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>帳號申訴</Text>
              <TouchableOpacity onPress={() => setComplaintModal(false)}>
                <X size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            {complaintSuccess ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Check size={40} color="#00D4AA" />
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 12 }}>申訴已提交</Text>
                <Text style={{ color: '#aaa', fontSize: 14, marginTop: 8, textAlign: 'center' }}>管理員將盡快審核您的申訴，請耐心等候。</Text>
                <TouchableOpacity style={styles.saveBtn} onPress={() => setComplaintModal(false)}>
                  <Text style={styles.saveBtnText}>確認</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.modalField}>
                  <View style={styles.modalFieldLabel}>
                    <AlertCircle size={16} color="#FFD700" />
                    <Text style={styles.modalLabel}>請說明申訴理由</Text>
                  </View>
                  <TextInput
                    style={[styles.modalInput, { minHeight: 100, textAlignVertical: 'top' }]}
                    value={complaintReason}
                    onChangeText={setComplaintReason}
                    placeholder="請詳細說明您認為帳號被鎖定的原因，以及您的說明"
                    placeholderTextColor="#444"
                    multiline
                    numberOfLines={5}
                  />
                </View>
                {complaintError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{complaintError}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, (!complaintReason.trim() || complaintSubmitting) && { opacity: 0.6 }]}
                  onPress={handleFileComplaint}
                  disabled={!complaintReason.trim() || complaintSubmitting}
                >
                  {complaintSubmitting ? <ActivityIndicator color="#000" /> : (
                    <><Check size={18} color="#000" /><Text style={styles.saveBtnText}>提交申訴</Text></>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {activeTab === 'bids' && (
        <FlatList
          data={myBids}
          renderItem={renderBidItem}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D4AA" colors={['#00D4AA']} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Package size={48} color="#333" />
              <Text style={styles.emptyText}>尚未參與任何競標</Text>
            </View>
          }
        />
      )}

      {activeTab === 'notifications' && (
        <View style={styles.tabContent}>
          {unreadCount > 0 && (
            <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
              <Check size={14} color="#00D4AA" />
              <Text style={styles.markAllText}>全部標為已讀</Text>
            </TouchableOpacity>
          )}
          <FlatList
            data={notifications}
            renderItem={renderNotification}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D4AA" colors={['#00D4AA']} />}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Bell size={48} color="#333" />
                <Text style={styles.emptyText}>目前沒有通知</Text>
              </View>
            }
          />
        </View>
      )}

      {/* Rules modal */}
      <Modal visible={rulesModalVisible} transparent animationType="slide" onRequestClose={() => setRulesModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>使用規則與注意事項</Text>
              <TouchableOpacity onPress={() => setRulesModalVisible(false)}>
                <X size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              {/* Section: 競標廳規則 */}
              <View style={styles.rulesSection}>
                <View style={styles.rulesSectionHeader}>
                  <Trophy size={16} color="#FFD700" />
                  <Text style={styles.rulesSectionTitle}>競標廳規則</Text>
                </View>
                <Text style={styles.rulesText}>
                  {'1. 每人每件商品僅能出價一次，請審慎評估後再下標。\n2. 出價金額必須不低於賣家設定的底價。\n3. 結標時，以「最高出價」者得標；若最高金額有二人以上相同，以「先出價者」優先得標。\n4. 參與競標需先繳納保證金 NT$1,000，未繳納者無法出價。\n5. 得標後請依賣家指示完成付款與交付，無故不取將記點處分。\n6. 賣家不得對自己的商品出價。\n7. 競標商品結標後由賣家手動結標並通知得標者。'}
                </Text>
              </View>

              {/* Section: 直購廳規則 */}
              <View style={styles.rulesSection}>
                <View style={styles.rulesSectionHeader}>
                  <Package size={16} color="#00D4AA" />
                  <Text style={styles.rulesSectionTitle}>直購廳規則</Text>
                </View>
                <Text style={styles.rulesText}>
                  {'1. 直購商品以固定價格即買即成交，無需競標。\n2. 購買時請確認數量，庫存數量以實際庫存為準，售完為止。\n3. 系統會自動扣減庫存，多人同時購買時以實際成交順序為準，未成功者會收到「商品已被購買」提示。\n4. 賣家不得購買自己的商品。\n5. 購買成功後系統會自動建立交付紀錄，請等候賣家聯繫出貨。'}
                </Text>
              </View>

              {/* Section: 會員規範 */}
              <View style={styles.rulesSection}>
                <View style={styles.rulesSectionHeader}>
                  <ShieldCheck size={16} color="#00D4AA" />
                  <Text style={styles.rulesSectionTitle}>會員規範</Text>
                </View>
                <Text style={styles.rulesText}>
                  {'1. 會員註冊後須填寫並驗證手機號碼，以及填寫收貨地址，才能完整使用平台功能。\n2. 免費會員可使用直購廳，上架商品最多 5 件；繳交平台維護費（NT$500）後無上架數量限制。\n3. 前 1000 名繳交平台維護費之會員為終身制，無需再次繳費。\n4. 帳號若違反平台規範（如棄標、惡意檢舉、詐欺等），管理員可予以鎖定，鎖定後可提出申訴。\n5. 請勿使用他人帳號或冒名頂替，一經查證將立即鎖定帳號。\n6. 請妥善保管帳號密碼，因帳號遭盜用所造成的損失由帳號持有人自行承擔。'}
                </Text>
              </View>

              {/* Section: 交易與交付 */}
              <View style={styles.rulesSection}>
                <View style={styles.rulesSectionHeader}>
                  <CreditCard size={16} color="#FFD700" />
                  <Text style={styles.rulesSectionTitle}>交易與交付注意事項</Text>
                </View>
                <Text style={styles.rulesText}>
                  {'1. 得標或直購後，請至「會員中心」確認付款方式與收貨地址是否正確。\n2. 付款方式與收款帳號請於個人資料中設定，以利賣家聯繫收款。\n3. 交付進度可至交付紀錄頁面查看，賣家會更新出貨與追蹤編號。\n4. 如對交易有疑慮，可透過商品頁面的檢舉功能向管理員反映。\n5. 平台僅提供交易媒介，不介入買賣雙方的金流與物流，請雙方自行確認交易細節。'}
                </Text>
              </View>

              {/* Section: 禁止事項 */}
              <View style={styles.rulesSection}>
                <View style={styles.rulesSectionHeader}>
                  <ShieldAlert size={16} color="#FF6B6B" />
                  <Text style={styles.rulesSectionTitle}>禁止事項</Text>
                </View>
                <Text style={styles.rulesText}>
                  {'1. 禁止刊登違法、仿冒、色情或暴力相關商品。\n2. 禁止惡意棄標、哄抬價格或與賣家串通圍標。\n3. 禁止在商品描述中留下外部交易連結或個人聯絡方式引導私下交易。\n4. 禁止惡意檢舉其他會員或濫用申訴功能。\n5. 違反以上規定者，管理員有權予以警告、鎖定帳號或刪除商品，情節嚴重者將永久停權。'}
                </Text>
              </View>

              <View style={styles.rulesFooter}>
                <Text style={styles.rulesFooterText}>
                  {'本平台保留修改使用規則之權利，修改後將於此頁面更新。\n使用本平台即視為同意以上規則與注意事項。'}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit profile modal */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>編輯個人資料</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <X size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Phone field */}
              <View style={styles.modalField}>
                <View style={styles.modalFieldLabel}>
                  <Phone size={16} color="#888" />
                  <Text style={styles.modalLabel}>聯絡電話 <Text style={styles.requiredStar}>*</Text></Text>
                  {(user.phone_verified && !phoneChanged && !needsOtpVerification) || otpVerified ? (
                    <View style={styles.verifiedBadge}>
                      <ShieldCheck size={13} color="#00D4AA" />
                      <Text style={styles.verifiedBadgeText}>已驗證</Text>
                    </View>
                  ) : needsOtpVerification ? (
                    <View style={styles.unverifiedBadge}>
                      <ShieldAlert size={13} color="#FFD700" />
                      <Text style={styles.unverifiedBadgeText}>{phoneChanged ? '需重新驗證' : '尚未驗證'}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.phoneRow}>
                  <TextInput
                    style={[styles.modalInput, styles.phoneInput, !validateTWPhone(editPhone) && editPhone.length > 0 && styles.inputError]}
                    value={editPhone}
                    onChangeText={handlePhoneChange}
                    placeholder="09xxxxxxxx"
                    placeholderTextColor="#444"
                    keyboardType="phone-pad"
                    maxLength={10}
                    editable={!otpStep}
                  />
                  {needsOtpVerification && !otpStep && validateTWPhone(editPhone) && (
                    <TouchableOpacity style={styles.otpSendBtn} onPress={sendOtp}>
                      <Text style={styles.otpSendBtnText}>取得驗證碼</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {editPhone.length > 0 && !validateTWPhone(editPhone) && (
                  <Text style={styles.fieldError}>格式：09xxxxxxxx（10位數字）</Text>
                )}

                {/* OTP input area */}
                {otpStep && (
                  <View style={styles.otpContainer}>
                    <View style={styles.demoOtpBox}>
                      <Text style={styles.demoOtpLabel}>驗證碼已以簡訊發送到此號碼</Text>
                    </View>
                    {devCode && (
                      <View style={styles.devCodeBox}>
                        <Text style={styles.devCodeText}>測試模式驗證碼：{devCode}</Text>
                      </View>
                    )}
                    <View style={styles.otpInputRow}>
                      <TextInput
                        style={styles.otpInput}
                        value={otpCode}
                        onChangeText={v => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                        placeholder="輸入6位驗證碼"
                        placeholderTextColor="#444"
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                      />
                      <TouchableOpacity style={styles.otpVerifyBtn} onPress={verifyOtp}>
                        <Text style={styles.otpVerifyBtnText}>確認</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.otpMeta}>
                      {otpCountdown > 0
                        ? <Text style={styles.countdownText}>驗證碼於 {formatCountdown(otpCountdown)} 後過期</Text>
                        : <Text style={styles.expiredText}>驗證碼已過期</Text>
                      }
                      <TouchableOpacity onPress={sendOtp}>
                        <Text style={styles.resendText}>重新取得</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              {/* Payment */}
              <View style={styles.modalField}>
                <View style={styles.modalFieldLabel}>
                  <CreditCard size={16} color="#888" />
                  <Text style={styles.modalLabel}>偏好付款方式</Text>
                </View>
                <View style={styles.paymentOptions}>
                  {PAYMENT_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.paymentOption, editPayment === opt && styles.paymentOptionActive]}
                      onPress={() => setEditPayment(opt)}
                    >
                      <Text style={[styles.paymentOptionText, editPayment === opt && styles.paymentOptionTextActive]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Bank */}
              <View style={styles.modalField}>
                <View style={styles.modalFieldLabel}>
                  <Building2 size={16} color="#888" />
                  <Text style={styles.modalLabel}>收款帳號（選填，賣家用）</Text>
                </View>
                <TextInput
                  style={styles.modalInput}
                  value={editBankAccount}
                  onChangeText={setEditBankAccount}
                  placeholder="銀行代碼 + 帳號"
                  placeholderTextColor="#444"
                />
              </View>

              {/* Address */}
              <View style={styles.modalField}>
                <View style={styles.modalFieldLabel}>
                  <MapPin size={16} color="#888" />
                  <Text style={styles.modalLabel}>收貨地址 <Text style={styles.requiredStar}>*</Text></Text>
                </View>
                <TextInput
                  style={[styles.modalInput, { minHeight: 72, textAlignVertical: 'top' }]}
                  value={editAddress}
                  onChangeText={setEditAddress}
                  placeholder="完整收貨地址（必填）"
                  placeholderTextColor="#444"
                  multiline
                />
              </View>

              {editError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{editError}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={saveProfile}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#000" /> : (
                  <>
                    <Check size={18} color="#000" />
                    <Text style={styles.saveBtnText}>儲存</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  header: {
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0, 212, 170, 0.1)',
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  avatarContainer: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0, 212, 170, 0.15)',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  headerInfo: { flex: 1, minWidth: 0 },
  userName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  userEmail: { fontSize: 11, color: '#666', marginTop: 1 },
  headerRight: { alignItems: 'flex-end', gap: 5, flexShrink: 0 },
  rolesContainer: { flexDirection: 'row', gap: 5 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0, 212, 170, 0.2)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  sellerBadge: { backgroundColor: 'rgba(255, 215, 0, 0.2)' },
  roleText: { color: '#00D4AA', fontSize: 11, fontWeight: '600' },
  sellerText: { color: '#FFD700' },
  roleSwitcher: { alignItems: 'center', marginBottom: 8 },
  roleSwitcherLabel: { fontSize: 11, color: '#888', marginBottom: 6 },
  roleSwitcherButtons: { flexDirection: 'row', gap: 6 },
  roleSwitcherInline: { flexDirection: 'row', gap: 5 },
  roleButton: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1, borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  roleButtonActive: { backgroundColor: '#00D4AA', borderColor: '#00D4AA' },
  roleButtonActiveSeller: { backgroundColor: '#FFD700', borderColor: '#FFD700' },
  roleButtonText: { fontSize: 11, fontWeight: '600', color: '#00D4AA' },
  roleButtonTextActive: { color: '#000' },
  incompleteBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,215,0,0.08)', paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 7, borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
    marginTop: 8,
  },
  incompleteBannerText: { color: '#FFD700', fontSize: 11, flex: 1 },
  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#00D4AA' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#666' },
  tabTextActive: { color: '#00D4AA' },
  tabWithBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBadge: {
    backgroundColor: '#FF6B6B', borderRadius: 8,
    minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4,
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  tabContent: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  infoSection: { padding: 16 },
  infoSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  infoSectionTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editBtnText: { color: '#00D4AA', fontSize: 14, fontWeight: '600' },
  infoCard: {
    backgroundColor: '#1A1A2E', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  infoLabel: { color: '#888', fontSize: 14, width: 72 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  infoValueEmpty: { color: '#FF6B6B' },
  infoDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 16 },
  unverifiedNote: { color: '#FFD700', fontSize: 12, paddingHorizontal: 16, paddingBottom: 10 },
  requiredNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,215,0,0.08)', borderRadius: 10, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
  },
  requiredNoteText: { color: '#aaa', fontSize: 13, flex: 1, lineHeight: 19 },
  logoutButton: {
    margin: 16, marginTop: 24, padding: 16, borderRadius: 10,
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderWidth: 1, borderColor: 'rgba(255, 107, 107, 0.3)', alignItems: 'center',
  },
  logoutText: { color: '#FF6B6B', fontSize: 16, fontWeight: '600' },
  bidCard: {
    backgroundColor: '#1A1A2E', borderRadius: 12, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  bidHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  productName: { fontSize: 15, fontWeight: '600', color: '#fff', flex: 1, marginRight: 12 },
  resultBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  activeBadge: { backgroundColor: 'rgba(0, 212, 170, 0.2)' },
  endedBadge: { backgroundColor: 'rgba(255, 107, 107, 0.2)' },
  winnerBadge: { backgroundColor: 'rgba(255, 215, 0, 0.2)' },
  resultText: { fontSize: 12, fontWeight: '700', color: '#FF6B6B' },
  winnerResultText: { color: '#FFD700' },
  bidAmountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bidLabel: { fontSize: 13, color: '#888' },
  bidAmount: { fontSize: 18, fontWeight: '700', color: '#00D4AA' },
  winningAmountText: { fontSize: 13, color: '#888', marginTop: 8 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: '#666', fontSize: 15, marginTop: 12 },
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  markAllText: { color: '#00D4AA', fontSize: 13 },
  notifCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#1A1A2E', borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  notifCardUnread: { borderColor: 'rgba(0,212,170,0.25)', backgroundColor: 'rgba(0,212,170,0.05)' },
  notifIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  notifBody: { flex: 1 },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  notifTitle: { color: '#fff', fontSize: 14, fontWeight: '700', flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00D4AA' },
  notifMessage: { color: '#aaa', fontSize: 13, lineHeight: 18, marginBottom: 6 },
  notifTime: { color: '#555', fontSize: 11 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1A1A2E', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%', padding: 20,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  modalField: { marginBottom: 20 },
  modalFieldLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  modalLabel: { fontSize: 13, color: '#888', fontWeight: '500', flex: 1 },
  requiredStar: { color: '#FF6B6B' },
  modalInput: {
    backgroundColor: '#0D0D1A', borderRadius: 8, padding: 14,
    color: '#fff', fontSize: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  inputError: { borderColor: 'rgba(255,107,107,0.6)' },
  phoneRow: { flexDirection: 'row', gap: 8 },
  phoneInput: { flex: 1 },
  otpSendBtn: {
    backgroundColor: 'rgba(0,212,170,0.2)', borderRadius: 8, paddingHorizontal: 12,
    justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,212,170,0.4)',
  },
  otpSendBtnText: { color: '#00D4AA', fontSize: 13, fontWeight: '600' },
  otpContainer: { marginTop: 12 },
  demoOtpBox: {
    backgroundColor: 'rgba(255,215,0,0.1)', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)', alignItems: 'center', marginBottom: 12,
  },
  demoOtpLabel: { color: '#888', fontSize: 11, marginBottom: 4 },
  devCodeBox: {
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    borderRadius: 8, padding: 10,
    marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.4)',
  },
  devCodeText: { color: '#FFD700', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  demoOtpCode: { color: '#FFD700', fontSize: 28, fontWeight: '800', letterSpacing: 6 },
  otpInputRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  otpInput: {
    flex: 1, backgroundColor: '#0D0D1A', borderRadius: 8, padding: 12,
    color: '#fff', fontSize: 20, borderWidth: 1, borderColor: 'rgba(0,212,170,0.4)',
    textAlign: 'center', letterSpacing: 6, fontWeight: '700',
  },
  otpVerifyBtn: {
    backgroundColor: '#00D4AA', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center',
  },
  otpVerifyBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },
  otpMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countdownText: { color: '#888', fontSize: 12 },
  expiredText: { color: '#FF6B6B', fontSize: 12, fontWeight: '600' },
  resendText: { color: '#00D4AA', fontSize: 12, fontWeight: '600' },
  fieldError: { color: '#FF6B6B', fontSize: 12, marginTop: 4 },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,212,170,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  verifiedBadgeText: { color: '#00D4AA', fontSize: 11, fontWeight: '700' },
  unverifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,215,0,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  unverifiedBadgeText: { color: '#FFD700', fontSize: 11, fontWeight: '700' },
  paymentOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paymentOption: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  paymentOptionActive: { backgroundColor: '#00D4AA', borderColor: '#00D4AA' },
  paymentOptionText: { color: '#888', fontSize: 13, fontWeight: '500' },
  paymentOptionTextActive: { color: '#000', fontWeight: '700' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#00D4AA', padding: 16, borderRadius: 12, marginTop: 8, marginBottom: 20,
  },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  // Membership styles
  membershipCard: {
    backgroundColor: '#1A1A2E', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.15)',
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  tierBadgeFree: { backgroundColor: 'rgba(255,255,255,0.08)' },
  tierBadgeVip: { backgroundColor: 'rgba(255,215,0,0.2)' },
  tierBadgeText: { fontSize: 13, fontWeight: '700', color: '#888' },
  tierBadgeTextVip: { color: '#FFD700' },
  depositBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,212,170,0.15)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
  },
  depositBadgeText: { color: '#00D4AA', fontSize: 11, fontWeight: '600' },
  benefitsList: { gap: 10, marginBottom: 16 },
  benefitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  benefitLabel: { color: '#888', fontSize: 14 },
  benefitValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  benefitLocked: { color: '#FF6B6B' },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFD700', padding: 14, borderRadius: 12, marginBottom: 10,
  },
  upgradeBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  depositBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,215,0,0.1)', padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.4)',
  },
  depositBtnText: { color: '#FFD700', fontSize: 15, fontWeight: '700' },
  allUnlocked: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8,
  },
  allUnlockedText: { color: '#00D4AA', fontSize: 14, fontWeight: '600' },
  lockedCard: {
    backgroundColor: 'rgba(255,107,107,0.08)', borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: 'rgba(255,107,107,0.2)', alignItems: 'center', gap: 10,
  },
  lockedTitle: { color: '#FF6B6B', fontSize: 17, fontWeight: '700' },
  lockedReason: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  pendingText: { color: '#FFD700', fontSize: 13, marginTop: 4 },
  complaintBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,215,0,0.1)', padding: 12, borderRadius: 10, marginTop: 8,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  complaintBtnText: { color: '#FFD700', fontSize: 14, fontWeight: '600' },
  errorBox: {
    backgroundColor: 'rgba(255,107,107,0.15)', borderRadius: 8, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,107,107,0.3)',
  },
  errorText: { color: '#FF6B6B', fontSize: 13, textAlign: 'center' },
  // Payment modal styles
  paymentAmountBox: {
    alignItems: 'center', paddingVertical: 16, marginBottom: 16,
    backgroundColor: 'rgba(255,215,0,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
  },
  paymentAmountLabel: { color: '#888', fontSize: 13, marginBottom: 4 },
  paymentAmountValue: { color: '#FFD700', fontSize: 28, fontWeight: '800' },
  paymentInstructions: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  paymentInstructionsTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  paymentInstructionsText: { color: '#aaa', fontSize: 13, lineHeight: 22 },
  paymentAccountLine: { color: '#00D4AA', fontSize: 13 },
  paymentInstructionsNote: { color: '#FFD700', fontSize: 12, marginTop: 8 },
  qrCodeContainer: { alignItems: 'center', marginVertical: 12, padding: 16, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(0,212,170,0.15)' },
  qrCodeHint: { color: '#aaa', fontSize: 12, textAlign: 'center', marginBottom: 12 },
  qrCodeBox: { padding: 12, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  qrCodeAmount: { color: '#00D4AA', fontSize: 14, fontWeight: '700', marginTop: 12 },
  uploadOptions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  uploadBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(0,212,170,0.1)', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: 'rgba(0,212,170,0.3)',
  },
  uploadBtnText: { color: '#00D4AA', fontSize: 14, fontWeight: '600' },
  proofPreview: { marginBottom: 16, alignItems: 'center' },
  proofImage: { width: '100%', height: 200, borderRadius: 12, marginBottom: 8 },
  proofRetakeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  proofRetakeText: { color: '#FF6B6B', fontSize: 13, fontWeight: '600' },
  pendingBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,215,0,0.1)', padding: 14, borderRadius: 12, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
  },
  pendingBoxText: { color: '#FFD700', fontSize: 14, fontWeight: '600' },
  rejectedNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10,
    backgroundColor: 'rgba(255,107,107,0.08)', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: 'rgba(255,107,107,0.2)',
  },
  rejectedNoticeText: { color: '#FF6B6B', fontSize: 12, flex: 1, lineHeight: 18 },
  rulesButton: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, marginTop: 8, padding: 16, borderRadius: 12,
    backgroundColor: 'rgba(0,212,170,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,212,170,0.2)',
  },
  rulesButtonText: { color: '#00D4AA', fontSize: 15, fontWeight: '600', flex: 1 },
  rulesSection: {
    marginBottom: 20, padding: 16, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  rulesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rulesSectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rulesText: { color: '#aaa', fontSize: 13, lineHeight: 22 },
  rulesFooter: {
    padding: 14, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  rulesFooterText: { color: '#666', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 12 },
  statsCard: {
    flex: 1, backgroundColor: '#1A1A2E', borderRadius: 14, padding: 16,
    alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(0,212,170,0.15)',
  },
  statsValue: { color: '#fff', fontSize: 24, fontWeight: '800' },
  statsLabel: { color: '#888', fontSize: 12 },
  onlineDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#00D4AA',
  },
  onlineDotPulse: {
    shadowColor: '#00D4AA', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 6, elevation: 4,
  },
  lifetimeNote: {
    color: '#FFD700', fontSize: 12, marginTop: 10, lineHeight: 18,
    backgroundColor: 'rgba(255,215,0,0.08)', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
  },
});
