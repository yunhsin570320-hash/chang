import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, RefreshControl, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Plus, X, Trash2, Search } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { ErpProduct, ProductFormula, RawMaterial } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useNavigation();
  const { sessionToken, hasErpRole } = useAuth();
  const [product, setProduct] = useState<ErpProduct | null>(null);
  const [formula, setFormula] = useState<(ProductFormula & { material?: RawMaterial })[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [selMaterial, setSelMaterial] = useState<RawMaterial | null>(null);
  const [qty100, setQty100] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matSearch, setMatSearch] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const [prodRes, fmRes, matRes] = await Promise.all([
      supabase.from('erp_products').select('*').eq('id', id).single(),
      supabase.from('product_formulas').select('*, material:raw_materials(*)').eq('product_id', id).order('created_at' as any),
      supabase.from('raw_materials').select('*').order('name'),
    ]);
    if (prodRes.data) { setProduct(prodRes.data); nav.setOptions({ title: prodRes.data.name }); }
    setFormula((fmRes.data ?? []) as any);
    setMaterials(matRes.data ?? []);
  }, [id]);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleAddFormula = async () => {
    if (!product || !sessionToken || !selMaterial) return;
    const q = parseFloat(qty100);
    if (isNaN(q) || q <= 0) { setError('請輸入有效的用量'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_upsert_formula_item', {
      p_token: sessionToken, p_product_id: product.id,
      p_material_id: selMaterial.id, p_qty_per_100: q,
      p_notes: fNotes.trim() || null,
    });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setAddModal(false); setSelMaterial(null); setQty100(''); setFNotes(''); setMatSearch('');
    await load();
  };

  const handleDelete = async (formulaId: string) => {
    if (!sessionToken) return;
    await callRpc('rpc_erp_delete_formula_item', { p_token: sessionToken, p_formula_id: formulaId });
    await load();
  };

  const kgPerDrum = product ? (product.specific_gravity * product.drum_capacity_liters).toFixed(2) : '—';
  const formulaTotal = formula.reduce((s, f) => s + f.quantity_per_100kg, 0);
  const filteredMats = materials.filter(m =>
    !matSearch || m.name.toLowerCase().includes(matSearch.toLowerCase()) || m.code.toLowerCase().includes(matSearch.toLowerCase())
  );

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} /></View>;
  if (!product) return <View style={styles.center}><Text style={{ color: C.textMuted }}>找不到此產品</Text></View>;

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      {/* Product Info */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>編號</Text><Text style={styles.infoValue}>{product.code}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>名稱</Text><Text style={styles.infoValue}>{product.name}</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>比重</Text><Text style={styles.infoValue}>{product.specific_gravity} g/cm³</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>桶容量</Text><Text style={styles.infoValue}>{product.drum_capacity_liters} L</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>安全庫存</Text><Text style={styles.infoValue}>{product.safety_stock} {product.unit}</Text></View>
        {product.notes && <View style={styles.infoRow}><Text style={styles.infoLabel}>備註</Text><Text style={styles.infoValue}>{product.notes}</Text></View>}
      </View>

      {/* Drum Calculation */}
      <View style={styles.drumCard}>
        <View style={styles.drumCalcRow}>
          <View style={styles.drumBox}>
            <Text style={styles.drumBoxLabel}>比重</Text>
            <Text style={styles.drumBoxValue}>{product.specific_gravity}</Text>
          </View>
          <Text style={styles.drumOp}>×</Text>
          <View style={styles.drumBox}>
            <Text style={styles.drumBoxLabel}>桶容量</Text>
            <Text style={styles.drumBoxValue}>{product.drum_capacity_liters} L</Text>
          </View>
          <Text style={styles.drumOp}>=</Text>
          <View style={[styles.drumBox, styles.drumBoxResult]}>
            <Text style={styles.drumBoxLabel}>每桶裝重</Text>
            <Text style={[styles.drumBoxValue, { color: C.primary, fontSize: 20 }]}>{kgPerDrum} kg</Text>
          </View>
        </View>
      </View>

      {/* Stock Info */}
      <View style={styles.stockRow}>
        <View style={styles.stockBox}>
          <Text style={styles.stockLabel}>目前庫存</Text>
          <Text style={[styles.stockValue, { color: product.current_stock < product.safety_stock ? C.danger : C.success }]}>{product.current_stock} {product.unit}</Text>
        </View>
        <View style={styles.stockBox}>
          <Text style={styles.stockLabel}>可裝桶數</Text>
          <Text style={[styles.stockValue, { color: C.primary }]}>
            {product.specific_gravity > 0 ? Math.floor(product.current_stock / (product.specific_gravity * product.drum_capacity_liters)) : 0} 桶
          </Text>
        </View>
      </View>

      {/* Formula (BOM) */}
      <View style={styles.section}>
        <View style={styles.sectionHdr}>
          <Text style={styles.sectionTitle}>產品配方 (每100kg用料)</Text>
          <Text style={styles.sectionSub}>共 {formulaTotal.toFixed(1)} kg</Text>
        </View>
        {formula.length === 0
          ? <View style={styles.emptyRow}><Text style={styles.emptyText}>尚未設定配方</Text></View>
          : formula.map(f => (
            <View key={f.id} style={styles.formulaRow}>
              <View style={styles.formulaInfo}>
                <Text style={styles.formulaName}>{(f as any).material?.name ?? '—'}</Text>
                <Text style={styles.formulaCode}>{(f as any).material?.code} · {(f as any).material?.unit}</Text>
                {f.notes && <Text style={styles.formulaNotes}>{f.notes}</Text>}
              </View>
              <Text style={styles.formulaQty}>{f.quantity_per_100kg} kg</Text>
              {hasErpRole('manager') && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(f.id)}>
                  <Trash2 size={14} color={C.danger} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        {hasErpRole('manager') && (
          <TouchableOpacity style={styles.addFormulaBtn} onPress={() => { setAddModal(true); setError(null); setSelMaterial(null); setQty100(''); setFNotes(''); setMatSearch(''); }}>
            <Plus size={16} color={C.primary} />
            <Text style={styles.addFormulaBtnText}>新增配方項目</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Add Formula Modal */}
      <Modal visible={addModal} animationType="slide" transparent onRequestClose={() => setAddModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>新增配方項目</Text>
              <TouchableOpacity onPress={() => setAddModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>選擇原料 *</Text>
              <View style={styles.searchWrap}>
                <Search size={14} color={C.textMuted} />
                <TextInput style={styles.searchInput} value={matSearch} onChangeText={setMatSearch} placeholder="搜尋原料" placeholderTextColor={C.textMuted} />
              </View>
              <View style={styles.matList}>
                {filteredMats.map(m => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.matOpt, selMaterial?.id === m.id && styles.matOptActive]}
                    onPress={() => setSelMaterial(m)}
                  >
                    <Text style={styles.matCode}>{m.code}</Text>
                    <Text style={[styles.matName, selMaterial?.id === m.id && { color: C.primary }]}>{m.name}</Text>
                  </TouchableOpacity>
                ))}
                {filteredMats.length === 0 && <Text style={styles.noItems}>找不到原料</Text>}
              </View>
              {selMaterial && (
                <>
                  <Text style={styles.label}>每100kg產品用量 ({selMaterial.unit}) *</Text>
                  <TextInput style={styles.fieldInput} value={qty100} onChangeText={setQty100} keyboardType="decimal-pad" placeholder="例：15.5" placeholderTextColor={C.textMuted} />
                  <Text style={styles.label}>備註（選填）</Text>
                  <TextInput style={styles.fieldInput} value={fNotes} onChangeText={setFNotes} placeholder="備註..." placeholderTextColor={C.textMuted} />
                </>
              )}
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, (!selMaterial || saving) && { opacity: 0.5 }]} onPress={handleAddFormula} disabled={!selMaterial || saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>新增</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  infoCard: { margin: 16, marginBottom: 12, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { color: C.textMuted, fontSize: 13 },
  infoValue: { color: C.text, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' },
  drumCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.primary + '44', padding: 16 },
  drumCalcRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  drumBox: { flex: 1, alignItems: 'center', padding: 8 },
  drumBoxResult: { backgroundColor: C.primary + '11', borderRadius: 8 },
  drumBoxLabel: { color: C.textMuted, fontSize: 11, marginBottom: 4 },
  drumBoxValue: { color: C.text, fontSize: 16, fontWeight: '700' },
  drumOp: { color: C.textMuted, fontSize: 18, fontWeight: '700', marginHorizontal: 4 },
  stockRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  stockBox: { flex: 1, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 14, alignItems: 'center' },
  stockLabel: { color: C.textMuted, fontSize: 12, marginBottom: 4 },
  stockValue: { fontSize: 20, fontWeight: '700' },
  section: { marginHorizontal: 16, marginBottom: 32, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  sectionHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  sectionSub: { color: C.textMuted, fontSize: 12 },
  emptyRow: { padding: 16, alignItems: 'center' },
  emptyText: { color: C.textMuted, fontSize: 13 },
  formulaRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 },
  formulaInfo: { flex: 1 },
  formulaName: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  formulaCode: { color: C.textMuted, fontSize: 11 },
  formulaNotes: { color: '#6E7681', fontSize: 11, marginTop: 2 },
  formulaQty: { color: C.primary, fontSize: 15, fontWeight: '700' },
  deleteBtn: { padding: 8 },
  addFormulaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 14, borderTopWidth: 1, borderTopColor: C.border },
  addFormulaBtnText: { color: C.primary, fontSize: 14, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border, maxHeight: '85%' },
  sheetHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  sheetBody: { padding: 20 },
  label: { color: C.textMuted, fontSize: 13, marginBottom: 6, marginTop: 12 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, color: C.text, paddingVertical: 8, fontSize: 14 },
  matList: { maxHeight: 200, borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginBottom: 8 },
  matOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  matOptActive: { backgroundColor: C.primary + '11' },
  matCode: { color: C.textMuted, fontSize: 11, fontWeight: '600', width: 60 },
  matName: { color: C.text, fontSize: 14, flex: 1 },
  noItems: { color: C.textMuted, fontSize: 13, padding: 16, textAlign: 'center' },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  errText: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  actionBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
