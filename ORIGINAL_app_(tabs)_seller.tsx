import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, ChevronRight, X, Factory, Search } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { ProductionOrder, ErpProduct } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed';

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:     { label: '待開始', color: C.primary },
  in_progress: { label: '生產中', color: C.warning },
  completed:   { label: '已完成', color: C.success },
  cancelled:   { label: '已取消', color: C.textMuted },
};

export default function ProductionScreen() {
  const { sessionToken, hasErpRole } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<(ProductionOrder & { product?: { name: string; code: string } })[]>([]);
  const [products, setProducts] = useState<ErpProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [newModal, setNewModal] = useState(false);
  const [selProduct, setSelProduct] = useState<ErpProduct | null>(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prodSearch, setProdSearch] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('production_orders')
      .select('*, product:erp_products(name, code)')
      .order('created_at', { ascending: false });
    setOrders((data ?? []) as any);
  }, []);

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from('erp_products').select('*').order('name');
    setProducts(data ?? []);
  }, []);

  useEffect(() => { Promise.all([load(), loadProducts()]).finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = orders.filter(o => statusFilter === 'all' || o.status === statusFilter);

  const handleCreate = async () => {
    if (!sessionToken || !selProduct) return;
    const q = parseFloat(quantity);
    if (isNaN(q) || q <= 0) { setError('請輸入有效的生產數量'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_create_production_order', {
      p_token: sessionToken, p_product_id: selProduct.id,
      p_quantity: q, p_notes: notes || null,
    });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setNewModal(false); setSelProduct(null); setQuantity(''); setNotes('');
    await load();
    if (data?.order_id) router.push(`/production/${data.order_id}` as any);
  };

  const filteredProds = products.filter(p =>
    !prodSearch || p.name.toLowerCase().includes(prodSearch.toLowerCase()) || p.code.toLowerCase().includes(prodSearch.toLowerCase())
  );

  const renderOrder = ({ item: o }: { item: typeof orders[0] }) => {
    const meta = STATUS_META[o.status] ?? { label: o.status, color: C.textMuted };
    return (
      <TouchableOpacity style={styles.card} onPress={() => router.push(`/production/${o.id}` as any)}>
        <View style={styles.cardLeft}>
          <Text style={styles.orderNum}>{o.order_number}</Text>
          <Text style={styles.orderProduct}>{(o as any).product?.name ?? '—'}</Text>
          <Text style={styles.orderMeta}>{o.planned_quantity} kg · {new Date(o.created_at).toLocaleDateString('zh-TW')}</Text>
        </View>
        <View style={styles.cardRight}>
          <View style={[styles.badge, { backgroundColor: meta.color + '22', borderColor: meta.color + '55' }]}>
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <ChevronRight size={14} color={C.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        {(['all', 'pending', 'in_progress', 'completed'] as StatusFilter[]).map(s => {
          const meta = s === 'all' ? { label: '全部', color: C.primary } : STATUS_META[s];
          return (
            <TouchableOpacity key={s} style={[styles.filterBtn, statusFilter === s && { backgroundColor: meta.color + '22', borderColor: meta.color }]} onPress={() => setStatusFilter(s)}>
              <Text style={[styles.filterText, statusFilter === s && { color: meta.color, fontWeight: '600' }]}>{meta.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading
        ? <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        : <FlatList
            data={filtered}
            renderItem={renderOrder}
            keyExtractor={i => i.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Factory size={40} color={C.textMuted} />
                <Text style={styles.emptyText}>尚無生產單</Text>
              </View>
            }
          />
      }

      {hasErpRole('operator') && (
        <TouchableOpacity style={styles.fab} onPress={() => { setNewModal(true); setError(null); setSelProduct(null); setQuantity(''); setNotes(''); setProdSearch(''); }}>
          <Plus size={24} color="#fff" />
        </TouchableOpacity>
      )}

      {/* New Production Order Modal */}
      <Modal visible={newModal} animationType="slide" transparent onRequestClose={() => setNewModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>新增生產單</Text>
              <TouchableOpacity onPress={() => setNewModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>選擇產品 *</Text>
              <View style={styles.searchWrap}>
                <Search size={14} color={C.textMuted} />
                <TextInput style={styles.searchInput} value={prodSearch} onChangeText={setProdSearch} placeholder="搜尋產品" placeholderTextColor={C.textMuted} />
              </View>
              <View style={styles.productList}>
                {filteredProds.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.productOption, selProduct?.id === p.id && styles.productOptionActive]}
                    onPress={() => setSelProduct(p)}
                  >
                    <Text style={styles.productCode}>{p.code}</Text>
                    <Text style={[styles.productName, selProduct?.id === p.id && { color: C.primary }]}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
                {filteredProds.length === 0 && <Text style={styles.noProducts}>找不到產品，請先在成品管理中建立</Text>}
              </View>
              {selProduct && (
                <>
                  <Text style={styles.label}>生產數量 (kg) *</Text>
                  <TextInput style={styles.fieldInput} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="例：1000" placeholderTextColor={C.textMuted} />
                  <Text style={styles.label}>備註（選填）</Text>
                  <TextInput style={[styles.fieldInput, styles.textarea]} value={notes} onChangeText={setNotes} placeholder="備註..." placeholderTextColor={C.textMuted} multiline />
                </>
              )}
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity
                style={[styles.actionBtn, (!selProduct || saving) && { opacity: 0.5 }]}
                onPress={handleCreate}
                disabled={!selProduct || saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>建立生產單</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  filters: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  filterText: { color: C.textMuted, fontSize: 12 },
  list: { paddingBottom: 80 },
  card: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  cardLeft: { flex: 1 },
  orderNum: { color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  orderProduct: { color: C.textMuted, fontSize: 13, marginBottom: 2 },
  orderMeta: { color: '#6E7681', fontSize: 11 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: C.textMuted, fontSize: 15 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border, maxHeight: '90%' },
  sheetHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  sheetBody: { padding: 20 },
  label: { color: C.textMuted, fontSize: 13, marginBottom: 8, marginTop: 16 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, color: C.text, paddingVertical: 8, fontSize: 14 },
  productList: { maxHeight: 200, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginBottom: 8 },
  productOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  productOptionActive: { backgroundColor: C.primary + '11' },
  productCode: { color: C.textMuted, fontSize: 11, fontWeight: '600', width: 60 },
  productName: { color: C.text, fontSize: 14, flex: 1 },
  noProducts: { color: C.textMuted, fontSize: 13, padding: 16, textAlign: 'center' },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  textarea: { height: 80, textAlignVertical: 'top' },
  errText: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  actionBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
