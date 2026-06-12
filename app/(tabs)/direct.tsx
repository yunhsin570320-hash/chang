import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { ShoppingCart, Tag, Users, Check, X, ShoppingBag, Minus, Plus } from 'lucide-react-native';
import { supabase, Product } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

type DirectProduct = Product;

type FilterTab = 'all' | 'available' | 'sold';

export default function DirectHall() {
  const [products, setProducts] = useState<DirectProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>('available');
  const [confirmProduct, setConfirmProduct] = useState<DirectProduct | null>(null);
  const [buyQuantity, setBuyQuantity] = useState('1');
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buySuccess, setBuySuccess] = useState(false);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user } = useAuth();

  const COLUMNS = width >= 768 ? 3 : 2;
  const CARD_WIDTH = (width - 16 * 2 - 10 * (COLUMNS - 1)) / COLUMNS;

  const hasLoadedRef = useRef(false);

  const fetchProducts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, status, direct_price, stock_quantity, seller_id, winner_id, winning_amount, created_at, image_url, seller:profiles!seller_id(id, name), winner:profiles!winner_id(id, name)')
        .eq('is_approved', true)
        .eq('is_direct_buy', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProducts((data || []) as any);
      hasLoadedRef.current = true;
    } catch (err) {
      if (!silent) console.warn('fetchDirectProducts error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts(false);
  }, [fetchProducts]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedRef.current) {
        fetchProducts(true);
      }
    }, [fetchProducts])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProducts();
    setRefreshing(false);
  }, [fetchProducts]);

  const available = products.filter(p => p.status === 'active' && (p.stock_quantity ?? 0) > 0);
  const sold = products.filter(p => p.status === 'ended' || (p.stock_quantity ?? 0) <= 0);
  const displayed = filterTab === 'all' ? products : filterTab === 'available' ? available : sold;

  const handleBuyPress = (item: DirectProduct) => {
    if (!user) return;
    setBuyError(null);
    setBuySuccess(false);
    setBuyQuantity('1');
    setConfirmProduct(item);
  };

  const adjustQty = (delta: number) => {
    const current = parseInt(buyQuantity, 10) || 1;
    const max = confirmProduct?.stock_quantity ?? 1;
    const next = Math.max(1, Math.min(max, current + delta));
    setBuyQuantity(String(next));
  };

  const confirmBuy = async () => {
    if (!confirmProduct || !user) return;

    const qty = parseInt(buyQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      setBuyError('請輸入有效的購買數量');
      return;
    }
    const maxStock = confirmProduct.stock_quantity ?? 1;
    if (qty > maxStock) {
      setBuyError(`最多可購買 ${maxStock} 件`);
      return;
    }

    setBuying(true);
    setBuyError(null);
    try {
      const totalAmount = (confirmProduct.direct_price || 0) * qty;
      const newStock = maxStock - qty;
      const isSoldOut = newStock <= 0;

      const { error } = await supabase
        .from('products')
        .update({
          stock_quantity: newStock,
          ...(isSoldOut ? {
            status: 'ended',
            winner_id: user.id,
            winning_amount: totalAmount,
          } : {}),
        })
        .eq('id', confirmProduct.id)
        .eq('status', 'active');

      if (error) throw error;

      await supabase.from('notifications').insert({
        user_id: user.id,
        product_id: confirmProduct.id,
        type: 'won',
        title: '直購成功！',
        message: `您已成功購買「${confirmProduct.name}」× ${qty} 件，金額 NT$ ${totalAmount.toLocaleString()}，請等候賣家聯繫交付事宜。`,
        is_read: false,
      });

      setBuySuccess(true);
      fetchProducts();
    } catch (err) {
      setBuyError('購買失敗，商品可能已售出，請重新整理');
      console.warn(err);
    } finally {
      setBuying(false);
    }
  };

  const closeModal = () => {
    setConfirmProduct(null);
    setBuySuccess(false);
    setBuyError(null);
    setBuyQuantity('1');
  };

  const getPurchasedQty = (item: DirectProduct) => {
    if (!item.direct_price || item.direct_price === 0) return null;
    return Math.round((item.winning_amount || 0) / item.direct_price);
  };

  const renderProduct = ({ item, index }: { item: DirectProduct; index: number }) => {
    const isSold = item.status === 'ended';
    const isOdd = index % COLUMNS !== COLUMNS - 1;
    const purchasedQty = isSold ? getPurchasedQty(item) : null;

    return (
      <View style={[styles.card, { width: CARD_WIDTH }, isOdd && { marginRight: 10 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push(`/product/${item.id}`)}
        >
          <View style={[styles.imageContainer, { height: CARD_WIDTH * 0.85 }]}>
            <Image
              source={{ uri: item.image_url || 'https://images.pexels.com/photos/90946/pexels-photo-90946.jpeg?w=400' }}
              style={styles.image}
              resizeMode="cover"
            />
            {isSold && (
              <View style={styles.soldOverlay}>
                <Text style={styles.soldOverlayText}>已售出</Text>
              </View>
            )}
            <View style={styles.tagBadge}>
              <Tag size={10} color="#FFD700" />
              <Text style={styles.tagBadgeText}>直購</Text>
            </View>
          </View>

          <View style={styles.cardContent}>
            <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.sellerName} numberOfLines={1}>{(item as any).seller?.name || '賣家'}</Text>
            <Text style={styles.price}>NT$ {(item.direct_price || 0).toLocaleString()}</Text>
            {isSold && item.winner && (
              <View style={styles.soldInfoBox}>
                <Text style={styles.soldInfoLine}>
                  買家：{item.winner.name}
                </Text>
                {purchasedQty !== null && (
                  <Text style={styles.soldInfoLine}>
                    數量：{purchasedQty} 件
                  </Text>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>

        {!isSold && (
          <View style={styles.bottomRow}>
            <Text style={styles.stockText}>剩餘 {item.stock_quantity ?? 0} 件</Text>
            <TouchableOpacity
              style={styles.buyBtn}
              onPress={() => handleBuyPress(item)}
              activeOpacity={0.8}
            >
              <ShoppingCart size={14} color="#000" />
              <Text style={styles.buyBtnText}>立即購買</Text>
            </TouchableOpacity>
          </View>
        )}
        {isSold && (
          <View style={styles.soldBtn}>
            <Text style={styles.soldBtnText}>已售出</Text>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>直購廳</Text>
          <Text style={styles.heroSubtitle}>以固定定價直接購買商品，無需等待競標</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFD700" />
          <Text style={styles.loadingText}>載入商品中...</Text>
        </View>
      </View>
    );
  }

  const confirmQty = parseInt(buyQuantity, 10) || 0;
  const totalPrice = (confirmProduct?.direct_price || 0) * confirmQty;

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>直購廳</Text>
        <Text style={styles.heroSubtitle}>以固定定價直接購買商品，無需等待競標</Text>
      </View>

      <View style={styles.tabBar}>
        {(['available', 'all', 'sold'] as FilterTab[]).map(t => {
          const label = t === 'available' ? `在售 (${available.length})` : t === 'all' ? '全部' : `已售 (${sold.length})`;
          return (
            <TouchableOpacity
              key={t}
              style={[styles.tab, filterTab === t && styles.tabActive]}
              onPress={() => setFilterTab(t)}
            >
              <Text style={[styles.tabText, filterTab === t && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={displayed}
        renderItem={renderProduct}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        key={COLUMNS}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFD700" colors={['#FFD700']} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <ShoppingBag size={48} color="#333" />
            <Text style={styles.emptyText}>目前沒有直購商品</Text>
          </View>
        }
      />

      <Modal visible={!!confirmProduct} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {buySuccess ? (
              <>
                <View style={styles.successIcon}>
                  <Check size={32} color="#00D4AA" />
                </View>
                <Text style={styles.modalTitle}>購買成功！</Text>
                <Text style={styles.modalSubtitle}>
                  賣家將會盡快與您聯繫，請確認個人資料中已填寫聯絡電話與收貨地址。
                </Text>
                <TouchableOpacity style={styles.confirmBtn} onPress={closeModal}>
                  <Text style={styles.confirmBtnText}>確定</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>確認購買</Text>
                  <TouchableOpacity onPress={closeModal}>
                    <X size={22} color="#888" />
                  </TouchableOpacity>
                </View>
                {confirmProduct && (
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <Image
                      source={{ uri: confirmProduct.image_url || 'https://images.pexels.com/photos/90946/pexels-photo-90946.jpeg?w=400' }}
                      style={styles.modalImage}
                      resizeMode="cover"
                    />
                    <Text style={styles.modalProductName}>{confirmProduct.name}</Text>

                    <View style={styles.priceRow}>
                      <Text style={styles.priceLabel}>單價</Text>
                      <Text style={styles.priceValue}>NT$ {(confirmProduct.direct_price || 0).toLocaleString()}</Text>
                    </View>

                    <View style={styles.qtyRow}>
                      <Text style={styles.qtyLabel}>購買數量</Text>
                      <View style={styles.qtyControls}>
                        <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustQty(-1)}>
                          <Minus size={16} color="#FFD700" />
                        </TouchableOpacity>
                        <TextInput
                          style={styles.qtyInput}
                          value={buyQuantity}
                          onChangeText={(v) => {
                            const n = parseInt(v, 10);
                            const max = confirmProduct.stock_quantity ?? 1;
                            if (v === '') { setBuyQuantity(''); return; }
                            if (!isNaN(n)) setBuyQuantity(String(Math.max(1, Math.min(max, n))));
                          }}
                          keyboardType="numeric"
                        />
                        <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustQty(1)}>
                          <Plus size={16} color="#FFD700" />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.stockHint}>庫存 {confirmProduct.stock_quantity ?? 0} 件</Text>
                    </View>

                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>合計金額</Text>
                      <Text style={styles.totalValue}>NT$ {totalPrice.toLocaleString()}</Text>
                    </View>

                    <Text style={styles.modalNote}>
                      確認後將立即完成購買，賣家會根據您的個人資料聯繫您安排交付。
                    </Text>
                    {buyError && (
                      <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{buyError}</Text>
                      </View>
                    )}
                    <View style={styles.modalButtons}>
                      <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                        <Text style={styles.cancelBtnText}>取消</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.confirmBtn, styles.confirmBtnFull, buying && { opacity: 0.6 }]}
                        onPress={confirmBuy}
                        disabled={buying}
                      >
                        {buying ? (
                          <ActivityIndicator color="#000" size="small" />
                        ) : (
                          <>
                            <ShoppingCart size={16} color="#000" />
                            <Text style={styles.confirmBtnText}>確認購買</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', marginTop: 12, fontSize: 14 },
  hero: { padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 215, 0, 0.15)' },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 6 },
  heroSubtitle: { fontSize: 14, color: '#888', lineHeight: 20 },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0D0D1A',
  },
  tab: {
    flex: 1, paddingVertical: 14, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#FFD700' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#666' },
  tabTextActive: { color: '#FFD700' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: '#1A1A2E', borderRadius: 12, marginBottom: 12,
    overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255, 215, 0, 0.15)',
  },
  imageContainer: { position: 'relative', overflow: 'hidden' },
  image: { width: '100%', height: '100%', objectFit: 'cover' } as any,
  soldOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  soldOverlayText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  tagBadge: {
    position: 'absolute', top: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,215,0,0.25)',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)',
  },
  tagBadgeText: { color: '#FFD700', fontSize: 10, fontWeight: '700' },
  cardContent: { padding: 10 },
  productName: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 4, lineHeight: 18 },
  sellerName: { fontSize: 11, color: '#666', marginBottom: 6 },
  price: { fontSize: 15, fontWeight: '800', color: '#FFD700' },
  soldInfoBox: {
    marginTop: 6, paddingTop: 6,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 2,
  },
  soldInfoLine: { fontSize: 11, color: '#888' },
  bottomRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingBottom: 10,
  },
  stockText: { fontSize: 11, color: '#888' },
  buyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: '#FFD700', paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8,
  },
  buyBtnText: { color: '#000', fontSize: 12, fontWeight: '700' },
  soldBtn: {
    alignItems: 'center', paddingVertical: 10, margin: 10, marginTop: 4,
    borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)',
  },
  soldBtnText: { color: '#555', fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { color: '#666', fontSize: 15, marginTop: 16 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalContent: {
    backgroundColor: '#1A1A2E', borderRadius: 20, padding: 20,
    width: '100%', maxWidth: 400,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.2)',
    maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#fff', textAlign: 'center' },
  modalSubtitle: { color: '#888', fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 20, lineHeight: 20 },
  modalImage: { width: '100%', height: 160, borderRadius: 12, marginBottom: 14 },
  modalProductName: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 12 },
  priceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.06)', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.15)', marginBottom: 10,
  },
  priceLabel: { color: '#888', fontSize: 14 },
  priceValue: { color: '#FFD700', fontSize: 18, fontWeight: '800' },
  qtyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10, flexWrap: 'wrap',
  },
  qtyLabel: { color: '#888', fontSize: 14, width: 60 },
  qtyControls: {
    flexDirection: 'row', alignItems: 'center', gap: 0,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)', borderRadius: 8,
    overflow: 'hidden',
  },
  qtyBtn: {
    width: 36, height: 36, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.1)',
  },
  qtyInput: {
    width: 48, height: 36, textAlign: 'center',
    color: '#fff', fontSize: 16, fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  stockHint: { color: '#555', fontSize: 11, marginLeft: 4 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.1)', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)', marginBottom: 12,
  },
  totalLabel: { color: '#888', fontSize: 14 },
  totalValue: { color: '#FFD700', fontSize: 22, fontWeight: '900' },
  modalNote: { color: '#666', fontSize: 13, lineHeight: 18, marginBottom: 16 },
  errorBox: {
    backgroundColor: 'rgba(255,107,107,0.15)', borderRadius: 8, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,107,107,0.3)',
  },
  errorText: { color: '#FF6B6B', fontSize: 13, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 8 },
  cancelBtn: {
    flex: 1, padding: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  cancelBtnText: { color: '#888', fontSize: 15, fontWeight: '600' },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FFD700', padding: 14, borderRadius: 10,
  },
  confirmBtnFull: { flex: 1 },
  confirmBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  successIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(0,212,170,0.15)',
    justifyContent: 'center', alignItems: 'center',
    alignSelf: 'center', marginBottom: 16, marginTop: 8,
  },
});
