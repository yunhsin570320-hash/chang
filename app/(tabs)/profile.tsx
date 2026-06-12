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
} from 'react-native';
import {
  User, Package, Crown, Bell, BellOff, Phone, CreditCard,
  MapPin, Building2, Edit3, Check, X, ChevronRight, Trophy, ShieldCheck, ShieldAlert,
} from 'lucide-react-native';
import { supabase, Bid, Product, Notification } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

interface BidWithProduct extends Bid {
  product?: Product;
}

type ProfileTab = 'info' | 'bids' | 'notifications';

const PAYMENT_OPTIONS = ['銀行匯款', 'Line Pay', 'Apple Pay', '超商代碼繳費', '現金'];

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
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [otpVerified, setOtpVerified] = useState(false);

  const { user, currentRole, switchRole, logout, canSwitchRoles, refreshUser } = useAuth();
  const router = useRouter();

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
      const [bidsResult, notifResult] = await Promise.all([
        supabase
          .from('bids')
          .select('*, product:products(id, name, status, end_time, winner_id, winning_amount, image_url)')
          .eq('bidder_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      setMyBids(bidsResult.data || []);
      setNotifications(notifResult.data || []);
    } catch (error) {
      console.error('Error fetching profile data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

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

  const sendOtp = () => {
    if (!validateTWPhone(editPhone)) {
      setEditError('請輸入有效的台灣手機號碼（格式：09xxxxxxxx）');
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(code);
    setOtpCountdown(600);
    setOtpStep(true);
    setOtpCode('');
    setEditError(null);
  };

  const verifyOtp = () => {
    if (otpCode !== generatedOtp) {
      setEditError('驗證碼錯誤，請重新輸入');
      return;
    }
    if (otpCountdown <= 0) {
      setEditError('驗證碼已過期，請重新取得');
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

    // Phone must be verified (either newly verified or already was)
    if (needsOtpVerification && !otpVerified) {
      setEditError('請先完成手機號碼驗證');
      return;
    }

    // Check phone uniqueness if changed
    if (phoneChanged) {
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone', editPhone)
        .neq('id', user.id)
        .maybeSingle();
      if (existing) {
        setEditError('此手機號碼已被其他帳戶使用');
        return;
      }
    }

    setSaving(true);
    try {
      const updatePayload: Record<string, any> = {
        phone: editPhone.trim(),
        payment_method: editPayment.trim() || null,
        bank_account: editBankAccount.trim() || null,
        shipping_address: editAddress.trim(),
      };

      if (otpVerified) {
        updatePayload.phone_verified = true;
        updatePayload.phone_verified_at = new Date().toISOString();
      }

      await supabase.from('profiles').update(updatePayload).eq('id', user.id);
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
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
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

          <TouchableOpacity style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>登出</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

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
                      <Text style={styles.demoOtpLabel}>測試用驗證碼（實際會發送簡訊）</Text>
                      <Text style={styles.demoOtpCode}>{generatedOtp}</Text>
                    </View>
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
  errorBox: {
    backgroundColor: 'rgba(255,107,107,0.15)', borderRadius: 8, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,107,107,0.3)',
  },
  errorText: { color: '#FF6B6B', fontSize: 13, textAlign: 'center' },
});
