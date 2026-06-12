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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Clock, Users, ShoppingBag, Trophy } from 'lucide-react-native';
import { supabase, Product } from '../../lib/supabase';
import { CountdownTimer } from '../../components/CountdownTimer';

interface ProductWithBids extends Product {
  bid_count?: number;
}

type Tab = 'active' | 'ended';

export default function ProductHall() {
  const [products, setProducts] = useState<ProductWithBids[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('active');
  const router = useRouter();
  const { width } = useWindowDimensions();

  const COLUMNS = width >= 768 ? 3 : 2;
  const CARD_WIDTH = (width - 16 * 2 - 10 * (COLUMNS - 1)) / COLUMNS;

  const hasLoadedRef = useRef(false);

  const fetchProducts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, status, end_time, winner_id, winning_amount, seller_id, created_at, image_url, seller:profiles!seller_id(id, name)')
        .eq('is_approved', true)
        .or('is_direct_buy.is.false,is_direct_buy.is.null')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const { data: bidsData } = await supabase
        .from('bids')
        .select('product_id');

      const bidCounts = new Map<string, number>();
      (bidsData || []).forEach((b: any) => {
        bidCounts.set(b.product_id, (bidCounts.get(b.product_id) || 0) + 1);
      });

      setProducts(
        (data || []).map((p: any) => ({
          ...p,
          bid_count: bidCounts.get(p.id) || 0,
        }))
      );
      if (!silent) setFetchError(null);
      hasLoadedRef.current = true;
    } catch (err: any) {
      const msg = err?.message || JSON.stringify(err);
      if (!silent) setFetchError(msg);
      console.warn('fetchProducts error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch immediately on mount — runs in parallel with auth resolution
  useEffect(() => {
    fetchProducts(false);
  }, [fetchProducts]);

  // Silent background refresh each time screen is focused again
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

  const now = new Date();
  const activeProducts = products.filter(p => p.status === 'active' && new Date(p.end_time || 0) > now);
  const endedProducts = products.filter(p => p.status === 'ended' || new Date(p.end_time || 0) <= now);
  const displayed = activeTab === 'active' ? activeProducts : endedProducts;

  const renderProduct = ({ item, index }: { item: ProductWithBids; index: number }) => {
    const isEnded = item.status === 'ended' || new Date(item.end_time || 0) <= now;
    const hasSold = isEnded && item.winning_amount && item.winning_amount > 0;
    const isOdd = index % COLUMNS !== COLUMNS - 1;

    return (
      <TouchableOpacity
        style={[styles.card, { width: CARD_WIDTH }, isOdd && { marginRight: 10 }]}
        onPress={() => router.push(`/product/${item.id}`)}
        activeOpacity={0.8}
      >
        <View style={[styles.imageContainer, { height: CARD_WIDTH * 0.85 }]}>
          <Image
            source={{ uri: item.image_url || 'https://images.pexels.com/photos/90946/pexels-photo-90946.jpeg?w=400' }}
            style={styles.image}
            resizeMode="cover"
          />
          <View style={[styles.statusOverlay, isEnded && styles.statusOverlayEnded]}>
            <Text style={[styles.statusText, { color: isEnded ? '#fff' : '#00D4AA' }]}>
              {isEnded ? '已結標' : '競標中'}
            </Text>
          </View>
          {hasSold && (
            <View style={styles.soldBadge}>
              <Trophy size={10} color="#FFD700" />
            </View>
          )}
        </View>

        <View style={styles.cardContent}>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.sellerName} numberOfLines={1}>{(item as any).seller?.name || '賣家'}</Text>

          {isEnded ? (
            <View style={styles.infoRow}>
              <View style={styles.infoItem}>
                <Users size={12} color="#666" />
                <Text style={styles.infoText}>{item.bid_count || 0}</Text>
              </View>
              {hasSold ? (
                <Text style={styles.winningAmount}>NT${(item.winning_amount || 0).toLocaleString()}</Text>
              ) : (
                <Text style={styles.unsoldLabel}>流標</Text>
              )}
            </View>
          ) : (
            <View style={styles.infoCol}>
              <View style={styles.infoItem}>
                <Clock size={12} color="#00D4AA" />
                <CountdownTimer endTime={item.end_time || ''} size="small" isEnded={false} />
              </View>
              <View style={styles.infoItem}>
                <Users size={12} color="#666" />
                <Text style={styles.infoText}>{item.bid_count || 0} 人</Text>
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>暗標競標會</Text>
          <Text style={styles.heroSubtitle}>每件商品僅能出價一次，最高價者得標</Text>
        </View>
        <View style={styles.tabBar}>
          <View style={[styles.tab, styles.tabActive]}>
            <Text style={[styles.tabText, styles.tabTextActive]}>競標中</Text>
          </View>
          <View style={styles.tab}>
            <Text style={styles.tabText}>已結標</Text>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D4AA" />
          <Text style={styles.loadingText}>載入商品中...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>暗標競標會</Text>
        <Text style={styles.heroSubtitle}>每件商品僅能出價一次，最高價者得標</Text>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'active' && styles.tabActive]}
          onPress={() => setActiveTab('active')}
        >
          <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>
            競標中{activeProducts.length > 0 ? ` (${activeProducts.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'ended' && styles.tabActive]}
          onPress={() => setActiveTab('ended')}
        >
          <Text style={[styles.tabText, activeTab === 'ended' && styles.tabTextActive]}>
            已結標{endedProducts.length > 0 ? ` (${endedProducts.length})` : ''}
          </Text>
        </TouchableOpacity>
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00D4AA"
            colors={['#00D4AA']}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <ShoppingBag size={48} color="#333" />
            {fetchError ? (
              <Text style={styles.errorText}>{fetchError}</Text>
            ) : (
              <Text style={styles.emptyText}>
                {activeTab === 'active' ? '目前沒有進行中的競標' : '目前沒有已結標的商品'}
              </Text>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A' },
  loadingText: { color: '#888', marginTop: 12, fontSize: 14 },
  hero: { padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0, 212, 170, 0.1)' },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 6 },
  heroSubtitle: { fontSize: 14, color: '#888', lineHeight: 20 },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0D0D1A',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#00D4AA' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#666' },
  tabTextActive: { color: '#00D4AA' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.15)',
  },
  imageContainer: { position: 'relative', overflow: 'hidden' },
  image: { width: '100%', height: '100%', objectFit: 'cover' } as any,
  statusOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 5,
  },
  statusOverlayEnded: { backgroundColor: 'rgba(255, 107, 107, 0.85)' },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  soldBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,215,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.6)',
  },
  cardContent: { padding: 10 },
  productName: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 4, lineHeight: 18 },
  sellerName: { fontSize: 11, color: '#666', marginBottom: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoCol: { gap: 4 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoText: { fontSize: 11, color: '#666' },
  winningAmount: { fontSize: 12, fontWeight: '700', color: '#00D4AA' },
  unsoldLabel: { fontSize: 11, color: '#FF6B6B', fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { color: '#666', fontSize: 15, marginTop: 16 },
  errorText: { color: '#FF6B6B', fontSize: 13, marginTop: 16, textAlign: 'center', paddingHorizontal: 20 },
});
