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
import { Truck, MapPin, Phone, User, Package, Check, ArrowLeft, MessageSquare } from 'lucide-react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase, Product, Profile } from '../../lib/supabase';
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
  created_at: string;
  updated_at: string;
}

export default function DeliveryPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);
  const [winner, setWinner] = useState<Profile | null>(null);
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (id) {
      fetchDeliveryData();
    }
  }, [id]);

  const fetchDeliveryData = async () => {
    try {
      // Fetch product
      const { data: productData } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

      if (productData) {
        setProduct(productData);

        // Fetch winner info
        if (productData.winner_id) {
          const { data: winnerData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', productData.winner_id)
            .single();

          if (winnerData) {
            setWinner(winnerData);
          }
        }
      }

      // Fetch or create delivery record
      let { data: deliveryData } = await supabase
        .from('deliveries')
        .select('*')
        .eq('product_id', id)
        .single();

      if (!deliveryData && productData) {
        // Create delivery record
        const { data: newDelivery, error } = await supabase
          .from('deliveries')
          .insert({
            product_id: id,
            winner_id: productData.winner_id,
            seller_id: productData.seller_id,
            status: 'pending',
          })
          .select()
          .single();

        if (!error && newDelivery) {
          deliveryData = newDelivery;
        }
      }

      if (deliveryData) {
        setDelivery(deliveryData);
        setTrackingNumber(deliveryData.tracking_number || '');
        setNotes(deliveryData.notes || '');
      }
    } catch (error) {
      console.error('Error fetching delivery data:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateDeliveryStatus = async (newStatus: DeliveryInfo['status']) => {
    if (!delivery || !user || !product) return;
    if (user.id !== product.seller_id) return;

    setUpdating(true);
    try {
      const now = new Date().toISOString();
      const updateData: any = {
        status: newStatus,
        updated_at: now,
      };

      if (trackingNumber.trim()) {
        updateData.tracking_number = trackingNumber.trim();
      }

      if (notes.trim()) {
        updateData.notes = notes.trim();
      }

      // On completion: generate summary text and archive the product
      if (newStatus === 'completed' && product && winner) {
        const completedAt = new Date().toLocaleString('zh-TW', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        });
        const summary = [
          `【${product.name}】`,
          `得標者：${winner.name}`,
          `聯絡電話：${winner.phone || '未提供'}`,
          `得標金額：NT$ ${(product.winning_amount || 0).toLocaleString()}`,
          trackingNumber.trim() ? `物流單號：${trackingNumber.trim()}` : null,
          notes.trim() ? `備註：${notes.trim()}` : null,
          `完成時間：${completedAt}`,
        ].filter(Boolean).join('\n');

        updateData.completed_summary = summary;
        updateData.completed_at = now;

        // Archive the product to remove it from main active lists
        await supabase.from('products').update({ is_archived: true }).eq('id', product.id);
      }

      const { error } = await supabase
        .from('deliveries')
        .update(updateData)
        .eq('id', delivery.id);

      if (error) throw error;

      setDelivery({ ...delivery, ...updateData });

      if (newStatus === 'completed') {
        Alert.alert(
          '交付完成',
          '此商品已完成交付並封存。\n您可在賣家後台的「已完成」紀錄中查閱。',
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

  if (!product || !winner) {
    return (
      <View style={styles.errorContainer}>
        <Package size={48} color="#FF6B6B" />
        <Text style={styles.errorText}>找不到交付資訊</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>返回</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
              <Text style={styles.productDesc}>{product.description || '無描述'}</Text>
              <Text style={styles.productPrice}>
                得標金額: NT$ {(product.winning_amount || 0).toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* Winner Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>得標者資訊</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <User size={20} color="#00D4AA" />
              <Text style={styles.infoLabel}>姓名</Text>
              <Text style={styles.infoValue}>{winner.name}</Text>
            </View>
            <View style={styles.infoRow}>
              <Phone size={20} color="#00D4AA" />
              <Text style={styles.infoLabel}>電話</Text>
              <Text style={styles.infoValue}>{winner.phone || '未提供'}</Text>
            </View>
          </View>
        </View>

        {/* Delivery Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>交付狀態</Text>
          <View style={styles.statusContainer}>
            <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(delivery?.status || 'pending')}20` }]}>
              <View style={[styles.statusDot, { backgroundColor: getStatusColor(delivery?.status || 'pending') }]} />
              <Text style={[styles.statusText, { color: getStatusColor(delivery?.status || 'pending') }]}>
                {getStatusText(delivery?.status || 'pending')}
              </Text>
            </View>
          </View>

          {/* Progress Steps */}
          <View style={styles.progressContainer}>
            {['pending', 'shipped', 'delivered', 'completed'].map((step, index) => {
              const statusOrder = ['pending', 'shipped', 'delivered', 'completed'];
              const currentIndex = statusOrder.indexOf(delivery?.status || 'pending');
              const stepIndex = statusOrder.indexOf(step);
              const isCompleted = stepIndex <= currentIndex;
              const isCurrent = stepIndex === currentIndex;

              return (
                <View key={step} style={styles.progressStep}>
                  <View style={[
                    styles.progressCircle,
                    isCompleted && styles.progressCircleActive,
                    isCurrent && styles.progressCircleCurrent
                  ]}>
                    {isCompleted && <Check size={16} color="#000" />}
                  </View>
                  <Text style={[
                    styles.progressLabel,
                    isCompleted && styles.progressLabelActive
                  ]}>
                    {getStatusText(step as any)}
                  </Text>
                  {index < 3 && (
                    <View style={[
                      styles.progressLine,
                      stepIndex < currentIndex && styles.progressLineActive
                    ]} />
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Tracking Number */}
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

        {/* Action Buttons */}
        <View style={styles.section}>
          {delivery?.status === 'pending' && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => updateDeliveryStatus('shipped')}
              disabled={updating}
            >
              {updating ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Truck size={20} color="#000" />
                  <Text style={styles.actionButtonText}>確認出貨</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {delivery?.status === 'shipped' && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => updateDeliveryStatus('delivered')}
              disabled={updating}
            >
              {updating ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Package size={20} color="#000" />
                  <Text style={styles.actionButtonText}>確認送達</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {delivery?.status === 'delivered' && (
            <TouchableOpacity
              style={styles.actionButtonSuccess}
              onPress={() => updateDeliveryStatus('completed')}
              disabled={updating}
            >
              {updating ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Check size={20} color="#000" />
                  <Text style={styles.actionButtonText}>完成交付</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {delivery?.status === 'completed' && (
            <View style={styles.completedContainer}>
              <Check size={48} color="#10B981" />
              <Text style={styles.completedText}>交付已完成</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A' },
  loadingText: { color: '#00D4AA', marginTop: 12, fontSize: 16 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A', padding: 20 },
  errorText: { color: '#fff', fontSize: 18, marginTop: 16, marginBottom: 24 },
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
  productInfo: { flex: 1 },
  productName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 6 },
  productDesc: { fontSize: 13, color: '#888', marginBottom: 8 },
  productPrice: { fontSize: 16, fontWeight: '700', color: '#00D4AA' },
  infoCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoLabel: { color: '#888', fontSize: 14, width: 50 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  statusContainer: { alignItems: 'center', marginBottom: 20 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 16, fontWeight: '700' },
  progressContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16 },
  progressStep: { alignItems: 'center', flex: 1, position: 'relative' },
  progressCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressCircleActive: { backgroundColor: '#00D4AA' },
  progressCircleCurrent: { borderWidth: 3, borderColor: '#00D4AA', backgroundColor: '#00D4AA' },
  progressLabel: { fontSize: 12, color: '#666', textAlign: 'center' },
  progressLabelActive: { color: '#fff', fontWeight: '600' },
  progressLine: {
    position: 'absolute',
    top: 16,
    left: '50%',
    right: '-50%',
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: -1,
  },
  progressLineActive: { backgroundColor: '#00D4AA' },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 13, color: '#888', fontWeight: '500' },
  input: {
    backgroundColor: '#0D0D1A',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00D4AA',
    padding: 16,
    borderRadius: 12,
  },
  actionButtonSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    padding: 16,
    borderRadius: 12,
  },
  actionButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  completedContainer: { alignItems: 'center', paddingVertical: 40 },
  completedText: { color: '#10B981', fontSize: 18, fontWeight: '700', marginTop: 12 },
});
