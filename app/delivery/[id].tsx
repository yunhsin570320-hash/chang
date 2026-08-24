import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { Truck, MapPin, Phone, User, Package, Check, Mail, CreditCard, Banknote, ShoppingCart, Globe, ChevronRight } from 'lucide-react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase, callRpc, Product, Profile, initiateECPayCheckout } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface DeliveryInfo {
  id: string;
  product_id: string;
  winner_id: string;
  seller_id: string;
  status: 'pending' | 'shipped' | 'delivered' | 'completed';
  tracking_number?: string;
  shipping_address?: string;
  contact_phone?: string;
  notes?: string;
  quantity: number;
  purchase_amount?: number;
  is_direct_buy: boolean;
  created_at: string;
  updated_at: string;
  payment_status?: 'unpaid' | 'paid' | 'confirmed';
  payment_method_chosen?: string;
  payment_reference?: string;
  payment_marked_at?: string;
  payment_confirmed_at?: string;
}

export default function DeliveryPage() {
  // `id` is the delivery UUID (deliveries.id), not the product id
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, sessionToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);
  const [buyer, setBuyer] = useState<Profile | null>(null);
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [updating, setUpdating] = useState(false);
  const [paymentUpdating, setPaymentUpdating] = useState(false);
  const [ecpayLoading, setEcpayLoading] = useState(false);
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (id) fetchDeliveryData();
  }, [id]);

  const fetchDeliveryData = async () => {
    try {
      const { data: deliveryData, error: deliveryError } = await supabase
        .from('deliveries')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (deliveryError) {
        setErrorMsg(`交付資料錯誤: ${deliveryError.message}`);
        setLoading(false);
        return;
      }
      if (!deliveryData) {
        setErrorMsg('找不到此交付記錄（ID 不存在）');
        setLoading(false);
        return;
      }

      setDelivery(deliveryData as DeliveryInfo);
      setTrackingNumber(deliveryData.tracking_number || '');
      setNotes(deliveryData.notes || '');

      const [productResult, buyerResult] = await Promise.all([
        supabase.from('products').select('*').eq('id', deliveryData.product_id).maybeSingle(),
        supabase.from('profiles').select('*').eq('id', deliveryData.winner_id).maybeSingle(),
      ]);

      if (productResult.error) {
        setErrorMsg(`商品資料錯誤: ${productResult.error.message}`);
        setLoading(false);
        return;
      }
      if (!productResult.data) {
        setErrorMsg('找不到商品資料');
        setLoading(false);
        return;
      }
      if (buyerResult.error) {
        setErrorMsg(`買家資料錯誤: ${buyerResult.error.message}`);
        setLoading(false);
        return;
      }
      if (!buyerResult.data) {
        setErrorMsg('找不到買家資料（winner_id 無對應 profile）');
        setLoading(false);
        return;
      }

      setProduct(productResult.data);
      setBuyer(buyerResult.data);
    } catch (error: any) {
      setErrorMsg(`載入失敗: ${error?.message || '未知錯誤'}`);
    } finally {
      setLoading(false);
    }
  };

  const isSeller = user?.id === delivery?.seller_id;

  const updateDeliveryStatus = async (newStatus: DeliveryInfo['status']) => {
    if (!delivery || !user || !product || !isSeller) return;

    setUpdating(true);
    try {
      const now = new Date().toISOString();
      let completedSummary: string | null = null;

      if (newStatus === 'completed' && buyer) {
        const completedAt = new Date().toLocaleString('zh-TW', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        });
        const amount = delivery.is_direct_buy
          ? (delivery.purchase_amount || 0)
          : (product.winning_amount || 0);
        completedSummary = [
          `【${product.name}】`,
          delivery.is_direct_buy ? `購買數量：${delivery.quantity} 件` : null,
          `買家：${buyer.name}`,
          `聯絡電話：${buyer.phone || '未提供'}`,
          `Email：${buyer.email || '未提供'}`,
          buyer.payment_method ? `付款方式：${buyer.payment_method}` : null,
          buyer.bank_account ? `銀行帳號：${buyer.bank_account}` : null,
          `交貨地址：${buyer.shipping_address || '未提供'}`,
          `金額：NT$ ${amount.toLocaleString()}`,
          trackingNumber.trim() ? `物流單號：${trackingNumber.trim()}` : null,
          notes.trim() ? `備註：${notes.trim()}` : null,
          `完成時間：${completedAt}`,
        ].filter(Boolean).join('\n');
      }

      const { data, error } = await callRpc('rpc_seller_update_delivery', {
        p_token: sessionToken,
        p_delivery_id: delivery.id,
        p_status: newStatus,
        p_tracking_number: trackingNumber.trim() || null,
        p_notes: notes.trim() || null,
        p_completed_summary: completedSummary,
        p_completed_at: newStatus === 'completed' ? now : null,
      });

      if (error || data?.error) throw error || new Error(data?.error);

      setDelivery({ ...delivery, status: newStatus,
        tracking_number: trackingNumber.trim() || delivery.tracking_number,
        notes: notes.trim() || delivery.notes,
        updated_at: now,
      });

      if (newStatus === 'completed') {
        Alert.alert(
          '交付完成',
          delivery.is_direct_buy
            ? '此筆訂單已完成交付。'
            : '此商品已完成交付並封存。\n您可在賣家後台的「已完成」紀錄中查閱。',
          [{ text: '返回後台', onPress: () => router.back() }]
        );
      } else {
        Alert.alert('成功', `交付狀態已更新為: ${getStatusText(newStatus)}`);
      }
    } catch (error) {
      console.error('Error updating delivery:', error);
      Alert.alert('錯誤', '更新失敗');
    } finally {
      setUpdating(false);
    }
  };

  const getPaymentStatusText = (status: string) => {
    switch (status) {
      case 'unpaid': return '待付款';
      case 'paid': return '已標記付款';
      case 'confirmed': return '付款已確認';
      default: return '待付款';
    }
  };

  const getPaymentColor = (status: string) => {
    switch (status) {
      case 'unpaid': return '#FF6B6B';
      case 'paid': return '#FFD700';
      case 'confirmed': return '#10B981';
      default: return '#FF6B6B';
    }
  };

  const handleECPayPayment = async () => {
    if (!delivery || !sessionToken || !product) return;
    setEcpayLoading(true);
    try {
      const amount = delivery.is_direct_buy
        ? (delivery.purchase_amount || 0)
        : (product.winning_amount || 0);

      const { data, error } = await callRpc('rpc_create_ecpay_order', {
        p_token: sessionToken,
        p_delivery_id: delivery.id,
        p_amount: Math.round(amount),
        p_item_name: product.name,
      });

      if (error || data?.error) {
        Alert.alert('錯誤', data?.error || error?.message || '建立付款訂單失敗');
        return;
      }

      const { checkoutUrl, error: checkoutError } = await initiateECPayCheckout(
        data.merchant_trade_no,
        data.total_amount,
        data.item_name,
        sessionToken
      );

      if (checkoutError || !checkoutUrl) {
        Alert.alert('錯誤', checkoutError || '無法前往付款頁面');
        return;
      }

      // Open ECPay checkout in new window
      if (typeof window !== 'undefined') {
        window.open(checkoutUrl, '_blank');
      }
    } catch {
      Alert.alert('錯誤', '付款流程啟動失敗');
    } finally {
      setEcpayLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!delivery || !sessionToken) return;
    setPaymentUpdating(true);
    try {
      const { data, error } = await callRpc('rpc_buyer_mark_paid', {
        p_token: sessionToken,
        p_delivery_id: delivery.id,
        p_method: user?.payment_method || null,
        p_reference: null,
      });
      if (error || data?.error) throw error || new Error(data?.error);
      setDelivery({ ...delivery, payment_status: 'paid', payment_marked_at: new Date().toISOString() });
      Alert.alert('成功', '已通知賣家您已完成付款');
    } catch {
      Alert.alert('錯誤', '標記付款失敗');
    } finally {
      setPaymentUpdating(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (!delivery || !sessionToken) return;
    setPaymentUpdating(true);
    try {
      const { data, error } = await callRpc('rpc_seller_confirm_payment', {
        p_token: sessionToken,
        p_delivery_id: delivery.id,
      });
      if (error || data?.error) throw error || new Error(data?.error);
      setDelivery({ ...delivery, payment_status: 'confirmed', payment_confirmed_at: new Date().toISOString() });
      Alert.alert('成功', '已確認收到款項');
    } catch {
      Alert.alert('錯誤', '確認付款失敗');
    } finally {
      setPaymentUpdating(false);
    }
  };

  const getStatusText = (status: DeliveryInfo['status']) => {
    switch (status) {
      case 'pending': return '待出貨';
      case 'shipped': return '已出貨';
      case 'delivered': return '已送達';
      case 'completed': return '已完成';
    }
  };

  const getStatusColor = (status: DeliveryInfo['status']) => {
    switch (status) {
      case 'pending': return '#FFD700';
      case 'shipped': return '#00D4AA';
      case 'delivered': return '#4A90E2';
      case 'completed': return '#10B981';
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00D4AA" />
        <Text style={styles.loadingText}>載入中...</Text>
      </View>
    );
  }

  if (!delivery || !product || !buyer) {
    return (
      <View style={styles.errorContainer}>
        <Package size={48} color="#FF6B6B" />
        <Text style={styles.errorText}>找不到交付資訊</Text>
        {errorMsg ? <Text style={styles.errorDetail}>{errorMsg}</Text> : null}
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>返回</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const displayAmount = delivery.is_direct_buy
    ? (delivery.purchase_amount || 0)
    : (product.winning_amount || 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: '交付管理',
          headerShown: true,
          headerStyle: { backgroundColor: '#0D0D1A' },
          headerTintColor: '#fff',
          headerTitleStyle: { color: '#fff' },
        }}
      />
      <ScrollView style={styles.container}>
        {/* Product Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>商品資訊</Text>
          <View style={styles.productCard}>
            <Image source={{ uri: product.image_url }} style={styles.productImage} />
            <View style={styles.productInfo}>
              <Text style={styles.productName}>{product.name}</Text>
              {delivery.is_direct_buy && (
                <View style={styles.qtyBadge}>
                  <ShoppingCart size={14} color="#00D4AA" />
                  <Text style={styles.qtyText}>直購 × {delivery.quantity} 件</Text>
                </View>
              )}
              <Text style={styles.productPrice}>
                {delivery.is_direct_buy ? '購買金額' : '得標金額'}: NT$ {displayAmount.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* Buyer Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{delivery.is_direct_buy ? '買家資訊' : '得標者資訊'}</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <User size={20} color="#00D4AA" />
              <Text style={styles.infoLabel}>姓名</Text>
              <Text style={styles.infoValue}>{buyer.name}</Text>
            </View>
            <View style={styles.infoRow}>
              <Phone size={20} color="#00D4AA" />
              <Text style={styles.infoLabel}>電話</Text>
              <Text style={styles.infoValue}>{buyer.phone || '未提供'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Mail size={20} color="#00D4AA" />
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{buyer.email || '未提供'}</Text>
            </View>
            {buyer.payment_method ? (
              <View style={styles.infoRow}>
                <CreditCard size={20} color="#00D4AA" />
                <Text style={styles.infoLabel}>付款方式</Text>
                <Text style={styles.infoValue}>{buyer.payment_method}</Text>
              </View>
            ) : null}
            {buyer.bank_account ? (
              <View style={styles.infoRow}>
                <Banknote size={20} color="#00D4AA" />
                <Text style={styles.infoLabel}>銀行帳號</Text>
                <Text style={styles.infoValue}>{buyer.bank_account}</Text>
              </View>
            ) : null}
            <View style={[styles.infoRow, { alignItems: 'flex-start' }]}>
              <MapPin size={20} color="#00D4AA" style={{ marginTop: 2 }} />
              <Text style={styles.infoLabel}>交貨地址</Text>
              <Text style={[styles.infoValue, { flexWrap: 'wrap' }]}>{buyer.shipping_address || '未提供'}</Text>
            </View>
          </View>
        </View>

        {/* Payment Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>付款狀態</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <CreditCard size={20} color={getPaymentColor(delivery.payment_status || 'unpaid')} />
              <Text style={styles.infoLabel}>狀態</Text>
              <Text style={[styles.infoValue, { color: getPaymentColor(delivery.payment_status || 'unpaid'), fontWeight: '700' }]}>
                {getPaymentStatusText(delivery.payment_status || 'unpaid')}
              </Text>
            </View>
            {delivery.payment_method_chosen && (
              <View style={styles.infoRow}>
                <Banknote size={20} color="#00D4AA" />
                <Text style={styles.infoLabel}>付款方式</Text>
                <Text style={styles.infoValue}>{delivery.payment_method_chosen}</Text>
              </View>
            )}
            {delivery.payment_reference && (
              <View style={styles.infoRow}>
                <CreditCard size={20} color="#00D4AA" />
                <Text style={styles.infoLabel}>付款參考</Text>
                <Text style={styles.infoValue}>{delivery.payment_reference}</Text>
              </View>
            )}
            {delivery.payment_marked_at && (
              <View style={styles.infoRow}>
                <Check size={20} color="#FFD700" />
                <Text style={styles.infoLabel}>標記時間</Text>
                <Text style={styles.infoValue}>{new Date(delivery.payment_marked_at).toLocaleString('zh-TW')}</Text>
              </View>
            )}
            {delivery.payment_confirmed_at && (
              <View style={styles.infoRow}>
                <Check size={20} color="#10B981" />
                <Text style={styles.infoLabel}>確認時間</Text>
                <Text style={styles.infoValue}>{new Date(delivery.payment_confirmed_at).toLocaleString('zh-TW')}</Text>
              </View>
            )}
          </View>

          {/* Buyer: payment options */}
          {!isSeller && (delivery.payment_status || 'unpaid') === 'unpaid' && (
            <View style={{ gap: 12 }}>
              {/* ECPay online payment — primary option */}
              <TouchableOpacity
                style={styles.ecpayButton}
                onPress={handleECPayPayment}
                disabled={ecpayLoading}
              >
                {ecpayLoading ? <ActivityIndicator color="#000" /> : (
                  <><Globe size={20} color="#000" /><Text style={styles.actionButtonText}>線上付款（綠界信用卡/ATM/超商）</Text></>
                )}
              </TouchableOpacity>

              {/* Toggle manual payment option */}
              <TouchableOpacity
                style={styles.manualToggle}
                onPress={() => setShowPaymentOptions(!showPaymentOptions)}
              >
                <Text style={styles.manualToggleText}>其他付款方式（手動標記）</Text>
                <ChevronRight size={16} color="#666" />
              </TouchableOpacity>

              {showPaymentOptions && (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handleMarkPaid}
                  disabled={paymentUpdating}
                >
                  {paymentUpdating ? <ActivityIndicator color="#000" /> : (
                    <><Banknote size={20} color="#000" /><Text style={styles.actionButtonText}>我已付款（手動標記）</Text></>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Seller: confirm payment */}
          {isSeller && delivery.payment_status === 'paid' && (
            <TouchableOpacity
              style={styles.actionButtonSuccess}
              onPress={handleConfirmPayment}
              disabled={paymentUpdating}
            >
              {paymentUpdating ? <ActivityIndicator color="#000" /> : (
                <><Check size={20} color="#000" /><Text style={styles.actionButtonText}>確認收到款項</Text></>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Delivery Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>交付狀態</Text>
          <View style={styles.statusContainer}>
            <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(delivery.status)}20` }]}>
              <View style={[styles.statusDot, { backgroundColor: getStatusColor(delivery.status) }]} />
              <Text style={[styles.statusText, { color: getStatusColor(delivery.status) }]}>
                {getStatusText(delivery.status)}
              </Text>
            </View>
          </View>
          <View style={styles.progressContainer}>
            {(['pending', 'shipped', 'delivered', 'completed'] as const).map((step, index) => {
              const statusOrder = ['pending', 'shipped', 'delivered', 'completed'];
              const currentIndex = statusOrder.indexOf(delivery.status);
              const stepIndex = statusOrder.indexOf(step);
              const isCompleted = stepIndex <= currentIndex;
              const isCurrent = stepIndex === currentIndex;
              return (
                <View key={step} style={styles.progressStep}>
                  <View style={[
                    styles.progressCircle,
                    isCompleted && styles.progressCircleActive,
                    isCurrent && styles.progressCircleCurrent,
                  ]}>
                    {isCompleted && <Check size={16} color="#000" />}
                  </View>
                  <Text style={[styles.progressLabel, isCompleted && styles.progressLabelActive]}>
                    {getStatusText(step)}
                  </Text>
                  {index < 3 && (
                    <View style={[styles.progressLine, stepIndex < currentIndex && styles.progressLineActive]} />
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Tracking / Notes — seller only */}
        {isSeller && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>物流資訊</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>物流單號</Text>
              <TextInput
                style={styles.input}
                value={trackingNumber}
                onChangeText={setTrackingNumber}
                placeholder="輸入物流單號"
                placeholderTextColor="#444"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>備註</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="輸入備註（例如：配送時間、特殊指示等）"
                placeholderTextColor="#444"
                multiline
                numberOfLines={3}
              />
            </View>
          </View>
        )}

        {/* Tracking number display for buyer */}
        {!isSeller && delivery.tracking_number && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>物流資訊</Text>
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Truck size={20} color="#00D4AA" />
                <Text style={styles.infoLabel}>物流單號</Text>
                <Text style={styles.infoValue}>{delivery.tracking_number}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Action Buttons — seller only */}
        {isSeller && (
          <View style={styles.section}>
            {delivery.status === 'pending' && (
              <TouchableOpacity style={styles.actionButton} onPress={() => updateDeliveryStatus('shipped')} disabled={updating}>
                {updating ? <ActivityIndicator color="#000" /> : (
                  <><Truck size={20} color="#000" /><Text style={styles.actionButtonText}>確認出貨</Text></>
                )}
              </TouchableOpacity>
            )}
            {delivery.status === 'shipped' && (
              <TouchableOpacity style={styles.actionButton} onPress={() => updateDeliveryStatus('delivered')} disabled={updating}>
                {updating ? <ActivityIndicator color="#000" /> : (
                  <><Package size={20} color="#000" /><Text style={styles.actionButtonText}>確認送達</Text></>
                )}
              </TouchableOpacity>
            )}
            {delivery.status === 'delivered' && (
              <TouchableOpacity style={styles.actionButtonSuccess} onPress={() => updateDeliveryStatus('completed')} disabled={updating}>
                {updating ? <ActivityIndicator color="#000" /> : (
                  <><Check size={20} color="#000" /><Text style={styles.actionButtonText}>完成交付</Text></>
                )}
              </TouchableOpacity>
            )}
            {delivery.status === 'completed' && (
              <View style={styles.completedContainer}>
                <Check size={48} color="#10B981" />
                <Text style={styles.completedText}>交付已完成</Text>
              </View>
            )}
          </View>
        )}

        {!isSeller && delivery.status === 'completed' && (
          <View style={[styles.section, { alignItems: 'center', paddingBottom: 40 }]}>
            <Check size={48} color="#10B981" />
            <Text style={styles.completedText}>交付已完成，感謝您的購買！</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A' },
  loadingText: { color: '#00D4AA', marginTop: 12, fontSize: 16 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A', padding: 20 },
  errorText: { color: '#fff', fontSize: 18, marginTop: 16, marginBottom: 8 },
  errorDetail: { color: '#FF6B6B', fontSize: 13, marginBottom: 16, textAlign: 'center', paddingHorizontal: 16 },
  backButton: { backgroundColor: '#00D4AA', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  section: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 8 },
  productCard: {
    flexDirection: 'row',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
  },
  productImage: { width: 80, height: 80, borderRadius: 8, marginRight: 12 },
  productInfo: { flex: 1, gap: 6 },
  productName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  productDesc: { fontSize: 13, color: '#888' },
  productPrice: { fontSize: 16, fontWeight: '700', color: '#00D4AA' },
  qtyBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,212,170,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  qtyText: { fontSize: 13, color: '#00D4AA', fontWeight: '600' },
  infoCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoLabel: { color: '#888', fontSize: 14, width: 60 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  statusContainer: { alignItems: 'center', marginBottom: 20 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 16, fontWeight: '700' },
  progressContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16 },
  progressStep: { alignItems: 'center', flex: 1, position: 'relative' },
  progressCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  progressCircleActive: { backgroundColor: '#00D4AA' },
  progressCircleCurrent: { borderWidth: 3, borderColor: '#00D4AA', backgroundColor: '#00D4AA' },
  progressLabel: { fontSize: 12, color: '#666', textAlign: 'center' },
  progressLabelActive: { color: '#fff', fontWeight: '600' },
  progressLine: {
    position: 'absolute', top: 16, left: '50%', right: '-50%',
    height: 2, backgroundColor: 'rgba(255, 255, 255, 0.1)', zIndex: -1,
  },
  progressLineActive: { backgroundColor: '#00D4AA' },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 13, color: '#888', fontWeight: '500' },
  input: {
    backgroundColor: '#0D0D1A', borderRadius: 8, padding: 14,
    color: '#fff', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  actionButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#00D4AA', padding: 16, borderRadius: 12,
  },
  actionButtonSuccess: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#10B981', padding: 16, borderRadius: 12,
  },
  actionButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  ecpayButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#00D4AA', padding: 16, borderRadius: 12,
  },
  manualToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 12,
  },
  manualToggleText: { color: '#666', fontSize: 14 },
  completedContainer: { alignItems: 'center', paddingVertical: 40 },
  completedText: { color: '#10B981', fontSize: 18, fontWeight: '700', marginTop: 12 },
});
