import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { Plus, X, Truck, Search } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { ErpShipment, ErpProduct } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

export default function ShippingScreen() {
  const { sessionToken, hasErpRole } = useAuth();
  const [shipments, setShipments] = useState<(ErpShipment & { product?: { name: string; code: string } })[]>([]);
  const [products, setProducts] = useState<ErpProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newModal, setNewModal] = useState(false);
  const [selProduct, setSelProduct] = useState<ErpProduct | null>(null);
  const [quantity, setQuantity] = useState('');
  const [customer, setCustomer] = useState('');
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prodSearch, setProdSearch] = useState('');

  const load = useCallback(async () => {
    const [shipRes, prodRes] = await Promise.all([
      supabase.from('erp_shipments').select('*, product:erp_products(name, code)').order('created_at', { ascending: false }),
      supabase.from('erp_products').select('*').order('name'),
    ]);
    setShipments((shipRes.data ?? []) as any);
    setProducts(prodRes.data ?? []);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const kgPerDrum = selProduct ? (selProduct.specific_gravity * selProduct.drum_capacity_liters).toFixed(1) : '—';
  const qty = parseFloat(quantity);
  const estimatedDrums = (selProduct && !isNaN(qty) && qty > 0)
    ? Math.ceil(qty / (selProduct.specific_gravity * selProduct.drum_capacity_liters))
    : null;

  const handleCreate = async () => {
    if (!sessionToken || !selProduct) return;
    if (isNaN(qty) || qty <= 0) { setError('請輸入有效的出貨數量'); return; }
    if (!customer.trim()) { setError('請填寫客戶名稱'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_create_shipment', {
      p_token: sessionToken, p_product_id: selProduct.id, p_quantity_kg: qty,
      p_customer: customer.trim(), p_destination: destination.trim() || null,
      p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setNewModal(false); setSelProduct(null); setQuantity(''); setCustomer(''); setDestination(''); setNotes(''); setProdSearch('');
    await load();
  };

  const filteredProds = products.filter(p =>
    !prodSearch || p.name.toLowerCase().includes(prodSearch.toLowerCase()) || p.code.toLowerCase().includes(prodSearch.toLowerCase())
  );

  const renderShipment = ({ item: s }: { item: typeof shipments[0] }) => (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <Text style={styles.shipNum}>{s.shipment_number}</Text>
        <Text style={styles.shipProduct}>{(s as any).product?.name ?? '—'}</Text>
        <Text style={styles.shipCustomer}>{s.customer}</Text>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.shipQty}>{s.quantity_kg} kg</Text>
        {s.drums_count && <Text style={styles.shipDrums}>{s.drums_count} 桶</Text>}
        <Text style={styles.shipDate}>{new Date(s.shipped_at).toLocaleDateString('zh-TW')}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading
        ? <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        : <FlatList
            data={shipments}
            renderItem={renderShipment}
            keyExtractor={s => s.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Truck size={40} color={C.textMuted} />
                <Text style={styles.emptyText}>尚無出貨紀錄</Text>
              </View>
            }
          />
      }

      {hasErpRole('operator') && (
        <TouchableOpacity style={styles.fab} onPress={() => { setNewModal(true); setError(null); setSelProduct(null); setQuantity(''); setCustomer(''); setDestination(''); setNotes(''); setProdSearch(''); }}>
          <Plus size={24} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={newModal} animationType="slide" transparent onRequestClose={() => setNewModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>建立出貨單</Text>
              <TouchableOpacity onPress={() => setNewModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>選擇成品 *</Text>
              <View style={styles.searchWrap}>
                <Search size={14} color={C.textMuted} />
                <TextInput style={styles.searchInput} value={prodSearch} onChangeText={setProdSearch} placeholder="搜尋產品" placeholderTextColor={C.textMuted} />
              </View>
              <View style={styles.productList}>
                {filteredProds.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.productOpt, selProduct?.id === p.id && styles.productOptActive]}
                    onPress={() => setSelProduct(p)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.productCode}>{p.code} · {p.name}</Text>
                      <Text style={styles.productStock}>現有庫存 {p.current_stock} kg</Text>
                    </View>
                    {selProduct?.id === p.id && <View style={styles.checkDot} />}
                  </TouchableOpacity>
                ))}
                {filteredProds.length === 0 && <Text style={styles.noItems}>找不到成品</Text>}
              </View>

              {selProduct && (
                <>
                  <View style={styles.drumInfo}>
                    <Text style={styles.drumLabel}>比重 {selProduct.specific_gravity} · 桶容量 {selProduct.drum_capacity_liters} L</Text>
                    <Text style={styles.drumValue}>每桶裝重 {kgPerDrum} kg</Text>
                  </View>

                  <Text style={styles.label}>出貨數量 (kg) *</Text>
                  <TextInput style={styles.fieldInput} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="例：1000" placeholderTextColor={C.textMuted} />

                  {estimatedDrums !== null && (
                    <View style={styles.drumCalc}>
                      <Text style={styles.drumCalcText}>預估桶數：</Text>
                      <Text style={styles.drumCalcValue}>{estimatedDrums} 桶</Text>
                      <Text style={styles.drumCalcSub}>（{kgPerDrum} kg × {estimatedDrums} 桶）</Text>
                    </View>
                  )}

                  <Text style={styles.label}>客戶名稱 *</Text>
                  <TextInput style={styles.fieldInput} value={customer} onChangeText={setCustomer} placeholder="客戶公司名稱" placeholderTextColor={C.textMuted} />
                  <Text style={styles.label}>送達地點（選填）</Text>
                  <TextInput style={styles.fieldInput} value={destination} onChangeText={setDestination} placeholder="送達地址或工廠名稱" placeholderTextColor={C.textMuted} />
                  <Text style={styles.label}>備註（選填）</Text>
                  <TextInput style={[styles.fieldInput, styles.textarea]} value={notes} onChangeText={setNotes} multiline placeholder="備註..." placeholderTextColor={C.textMuted} />
                </>
              )}

              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, (!selProduct || saving) && { opacity: 0.5 }]} onPress={handleCreate} disabled={!selProduct || saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>確認出貨</Text>}
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
  list: { paddingBottom: 80 },
  card: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  cardLeft: { flex: 1 },
  shipNum: { color: C.text, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  shipProduct: { color: C.textMuted, fontSize: 13, marginBottom: 2 },
  shipCustomer: { color: '#6E7681', fontSize: 12 },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  shipQty: { color: C.text, fontSize: 14, fontWeight: '600' },
  shipDrums: { color: C.textMuted, fontSize: 12 },
  shipDate: { color: '#6E7681', fontSize: 11 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: C.textMuted, fontSize: 15 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 52, height: 52, borderRadius: 26, backgroundColor: C.success, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border, maxHeight: '90%' },
  sheetHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  sheetBody: { padding: 20 },
  label: { color: C.textMuted, fontSize: 13, marginBottom: 6, marginTop: 14 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, color: C.text, paddingVertical: 8, fontSize: 14 },
  productList: { maxHeight: 200, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginBottom: 8 },
  productOpt: { padding: 12, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center' },
  productOptActive: { backgroundColor: C.success + '11' },
  productCode: { color: C.text, fontSize: 13, fontWeight: '600' },
  productStock: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  checkDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.success },
  noItems: { color: C.textMuted, fontSize: 13, padding: 16, textAlign: 'center' },
  drumInfo: { backgroundColor: C.success + '11', borderRadius: 8, borderWidth: 1, borderColor: C.success + '44', padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  drumLabel: { color: C.textMuted, fontSize: 12 },
  drumValue: { color: C.success, fontSize: 14, fontWeight: '700' },
  drumCalc: { backgroundColor: C.primary + '11', borderRadius: 8, borderWidth: 1, borderColor: C.primary + '44', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  drumCalcText: { color: C.textMuted, fontSize: 13 },
  drumCalcValue: { color: C.primary, fontSize: 18, fontWeight: '700' },
  drumCalcSub: { color: C.textMuted, fontSize: 12 },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  textarea: { height: 80, textAlignVertical: 'top' },
  errText: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  actionBtn: { backgroundColor: C.success, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
