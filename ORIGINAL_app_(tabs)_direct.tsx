import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Modal, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Search, Plus, AlertTriangle, ChevronRight, X, Package } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { RawMaterial } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', surface2: '#21262D', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

type Filter = 'all' | 'low' | 'ok';

export default function MaterialsScreen() {
  const { sessionToken, hasErpRole } = useAuth();
  const router = useRouter();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [receiveModal, setReceiveModal] = useState<RawMaterial | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [qty, setQty] = useState('');
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add material form
  const [mCode, setMCode] = useState('');
  const [mName, setMName] = useState('');
  const [mUnit, setMUnit] = useState('kg');
  const [mSafety, setMSafety] = useState('');
  const [mSupplier, setMSupplier] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('raw_materials').select('*').order('code');
    setMaterials(data ?? []);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = materials.filter(m => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.code.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || (filter === 'low' && m.current_stock < m.safety_stock) || (filter === 'ok' && m.current_stock >= m.safety_stock);
    return matchSearch && matchFilter;
  });

  const handleReceive = async () => {
    if (!receiveModal || !sessionToken) return;
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) { setError('請輸入有效的收貨數量'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_receive_material', { p_token: sessionToken, p_id: receiveModal.id, p_quantity: q, p_reference: ref || null, p_notes: notes || null });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setReceiveModal(null); setQty(''); setRef(''); setNotes('');
    await load();
  };

  const handleAddMaterial = async () => {
    if (!sessionToken) return;
    if (!mCode.trim() || !mName.trim()) { setError('請填寫編號和名稱'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_create_material', {
      p_token: sessionToken, p_code: mCode.trim(), p_name: mName.trim(),
      p_unit: mUnit.trim() || 'kg', p_safety: parseFloat(mSafety) || 0,
      p_supplier: mSupplier.trim() || null,
    });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setAddModal(false); setMCode(''); setMName(''); setMUnit('kg'); setMSafety(''); setMSupplier('');
    await load();
  };

  const stockStatus = (m: RawMaterial) => {
    if (m.current_stock < m.safety_stock) return { color: C.danger, label: '不足' };
    if (m.current_stock < m.safety_stock * 1.5) return { color: C.warning, label: '偏低' };
    return { color: C.success, label: '正常' };
  };

  const renderItem = ({ item }: { item: RawMaterial }) => {
    const st = stockStatus(item);
    return (
      <TouchableOpacity style={styles.row} onPress={() => router.push(`/material/${item.id}` as any)}>
        <View style={[styles.dot, { backgroundColor: st.color }]} />
        <View style={styles.rowInfo}>
          <View style={styles.rowTop}>
            <Text style={styles.itemCode}>{item.code}</Text>
            <Text style={styles.itemName}>{item.name}</Text>
          </View>
          <Text style={styles.stockText}>
            <Text style={{ color: st.color }}>{item.current_stock}</Text> / {item.safety_stock} {item.unit}
          </Text>
        </View>
        {item.current_stock < item.safety_stock && <AlertTriangle size={14} color={C.danger} />}
        {hasErpRole('operator') && (
          <TouchableOpacity
            style={styles.receiveBtn}
            onPress={() => { setReceiveModal(item); setQty(''); setRef(''); setNotes(''); setError(null); }}
          >
            <Text style={styles.receiveBtnText}>收貨</Text>
          </TouchableOpacity>
        )}
        <ChevronRight size={14} color={C.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Search size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="搜尋原料名稱或編號"
            placeholderTextColor={C.textMuted}
          />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><X size={14} color={C.textMuted} /></TouchableOpacity> : null}
        </View>
      </View>

      <View style={styles.filters}>
        {(['all', 'low', 'ok'] as Filter[]).map(f => (
          <TouchableOpacity key={f} style={[styles.filterBtn, filter === f && styles.filterBtnActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? '全部' : f === 'low' ? '庫存不足' : '庫存正常'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading
        ? <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        : <FlatList
            data={filtered}
            renderItem={renderItem}
            keyExtractor={i => i.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Package size={40} color={C.textMuted} />
                <Text style={styles.emptyText}>{search ? '沒有符合的原料' : '尚未建立任何原料'}</Text>
              </View>
            }
          />
      }

      {hasErpRole('manager') && (
        <TouchableOpacity style={styles.fab} onPress={() => { setAddModal(true); setError(null); }}>
          <Plus size={24} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Receive Modal */}
      <Modal visible={!!receiveModal} animationType="slide" transparent onRequestClose={() => setReceiveModal(null)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>收貨 — {receiveModal?.name}</Text>
              <TouchableOpacity onPress={() => setReceiveModal(null)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>收貨數量 ({receiveModal?.unit}) *</Text>
              <TextInput style={styles.fieldInput} value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.textMuted} autoFocus />
              <Text style={styles.fieldLabel}>採購單號（選填）</Text>
              <TextInput style={styles.fieldInput} value={ref} onChangeText={setRef} placeholder="PO-XXXX" placeholderTextColor={C.textMuted} />
              <Text style={styles.fieldLabel}>備註（選填）</Text>
              <TextInput style={[styles.fieldInput, styles.textarea]} value={notes} onChangeText={setNotes} placeholder="備註..." placeholderTextColor={C.textMuted} multiline />
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, saving && { opacity: 0.6 }]} onPress={handleReceive} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>確認收貨</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Add Material Modal */}
      <Modal visible={addModal} animationType="slide" transparent onRequestClose={() => setAddModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>新增原料</Text>
              <TouchableOpacity onPress={() => setAddModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>原料編號 *</Text>
              <TextInput style={styles.fieldInput} value={mCode} onChangeText={setMCode} placeholder="RM-001" placeholderTextColor={C.textMuted} autoCapitalize="characters" />
              <Text style={styles.fieldLabel}>原料名稱 *</Text>
              <TextInput style={styles.fieldInput} value={mName} onChangeText={setMName} placeholder="例：硫酸鈉" placeholderTextColor={C.textMuted} />
              <Text style={styles.fieldLabel}>單位</Text>
              <TextInput style={styles.fieldInput} value={mUnit} onChangeText={setMUnit} placeholder="kg" placeholderTextColor={C.textMuted} />
              <Text style={styles.fieldLabel}>安全庫存</Text>
              <TextInput style={styles.fieldInput} value={mSafety} onChangeText={setMSafety} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.textMuted} />
              <Text style={styles.fieldLabel}>供應商（選填）</Text>
              <TextInput style={styles.fieldInput} value={mSupplier} onChangeText={setMSupplier} placeholder="供應商名稱" placeholderTextColor={C.textMuted} />
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, saving && { opacity: 0.6 }]} onPress={handleAddMaterial} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>建立原料</Text>}
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
  toolbar: { padding: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, gap: 8 },
  searchInput: { flex: 1, color: C.text, paddingVertical: 10, fontSize: 14 },
  filters: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  filterBtnActive: { backgroundColor: C.primary + '22', borderColor: C.primary },
  filterText: { color: C.textMuted, fontSize: 12 },
  filterTextActive: { color: C.primary, fontWeight: '600' },
  list: { paddingBottom: 80 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowInfo: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  itemCode: { color: C.textMuted, fontSize: 11, fontWeight: '600' },
  itemName: { color: C.text, fontSize: 14, fontWeight: '600' },
  stockText: { color: C.textMuted, fontSize: 12 },
  receiveBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: C.primary + '22', borderWidth: 1, borderColor: C.primary + '55' },
  receiveBtnText: { color: C.primary, fontSize: 12, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: C.textMuted, fontSize: 15 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border, maxHeight: '85%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  sheetBody: { padding: 20 },
  fieldLabel: { color: C.textMuted, fontSize: 13, marginBottom: 6, marginTop: 12 },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  textarea: { height: 80, textAlignVertical: 'top' },
  errText: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  actionBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
