import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, ChevronRight, X, Beaker, AlertTriangle } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { ErpProduct } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

export default function ProductsScreen() {
  const { sessionToken, hasErpRole } = useAuth();
  const router = useRouter();
  const [products, setProducts] = useState<ErpProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('kg');
  const [sg, setSg] = useState('1.0');
  const [drumL, setDrumL] = useState('200');
  const [safety, setSafety] = useState('0');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('erp_products').select('*').order('code');
    setProducts(data ?? []);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleAdd = async () => {
    if (!sessionToken) return;
    if (!code.trim() || !name.trim()) { setError('請填寫編號和名稱'); return; }
    const sgVal = parseFloat(sg);
    const drumVal = parseFloat(drumL);
    if (isNaN(sgVal) || sgVal <= 0) { setError('請輸入有效的比重值'); return; }
    if (isNaN(drumVal) || drumVal <= 0) { setError('請輸入有效的桶容量'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_create_product', {
      p_token: sessionToken, p_code: code.trim(), p_name: name.trim(),
      p_unit: unit.trim() || 'kg', p_specific_gravity: sgVal,
      p_drum_liters: drumVal, p_safety: parseFloat(safety) || 0,
      p_notes: notes.trim() || null,
    });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setAddModal(false); setCode(''); setName(''); setUnit('kg'); setSg('1.0'); setDrumL('200'); setSafety('0'); setNotes('');
    await load();
  };

  const stockStatus = (p: ErpProduct) => {
    if (p.current_stock < p.safety_stock) return { color: C.danger };
    if (p.current_stock < p.safety_stock * 1.5) return { color: C.warning };
    return { color: C.success };
  };

  const kgPerDrum = (p: ErpProduct) => (p.specific_gravity * p.drum_capacity_liters).toFixed(1);

  const renderItem = ({ item: p }: { item: ErpProduct }) => {
    const st = stockStatus(p);
    return (
      <TouchableOpacity style={styles.card} onPress={() => router.push(`/product/${p.id}` as any)}>
        <View style={[styles.dot, { backgroundColor: st.color }]} />
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.code}>{p.code}</Text>
            <Text style={styles.pname}>{p.name}</Text>
            {p.current_stock < p.safety_stock && <AlertTriangle size={13} color={C.danger} />}
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>庫存 <Text style={{ color: st.color }}>{p.current_stock}</Text> / {p.safety_stock} {p.unit}</Text>
            <Text style={styles.metaText}>比重 {p.specific_gravity} · {kgPerDrum(p)} kg/桶</Text>
          </View>
        </View>
        <ChevronRight size={14} color={C.textMuted} />
      </TouchableOpacity>
    );
  };

  const sgVal = parseFloat(sg);
  const drumVal = parseFloat(drumL);
  const previewKgPerDrum = (!isNaN(sgVal) && !isNaN(drumVal) && sgVal > 0 && drumVal > 0) ? (sgVal * drumVal).toFixed(1) : '—';

  return (
    <View style={styles.container}>
      {loading
        ? <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        : <FlatList
            data={products}
            renderItem={renderItem}
            keyExtractor={p => p.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Beaker size={40} color={C.textMuted} />
                <Text style={styles.emptyText}>尚未建立任何成品</Text>
                {hasErpRole('manager') && <Text style={styles.emptyHint}>點擊右下角 + 新增成品</Text>}
              </View>
            }
          />
      }

      {hasErpRole('manager') && (
        <TouchableOpacity style={styles.fab} onPress={() => { setAddModal(true); setError(null); }}>
          <Plus size={24} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={addModal} animationType="slide" transparent onRequestClose={() => setAddModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>新增成品</Text>
              <TouchableOpacity onPress={() => setAddModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>產品編號 *</Text>
              <TextInput style={styles.fieldInput} value={code} onChangeText={setCode} placeholder="FG-001" placeholderTextColor={C.textMuted} autoCapitalize="characters" />
              <Text style={styles.label}>產品名稱 *</Text>
              <TextInput style={styles.fieldInput} value={name} onChangeText={setName} placeholder="例：防鏽清洗劑" placeholderTextColor={C.textMuted} />
              <Text style={styles.label}>單位</Text>
              <TextInput style={styles.fieldInput} value={unit} onChangeText={setUnit} placeholder="kg" placeholderTextColor={C.textMuted} />

              <View style={styles.twoCol}>
                <View style={styles.colHalf}>
                  <Text style={styles.label}>比重（g/cm³）*</Text>
                  <TextInput style={styles.fieldInput} value={sg} onChangeText={setSg} keyboardType="decimal-pad" placeholder="1.0" placeholderTextColor={C.textMuted} />
                </View>
                <View style={styles.colHalf}>
                  <Text style={styles.label}>桶容量（公升）*</Text>
                  <TextInput style={styles.fieldInput} value={drumL} onChangeText={setDrumL} keyboardType="decimal-pad" placeholder="200" placeholderTextColor={C.textMuted} />
                </View>
              </View>

              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>每桶裝重（kg）= 比重 × 桶容量</Text>
                <Text style={styles.previewValue}>{previewKgPerDrum} kg / 桶</Text>
              </View>

              <Text style={styles.label}>安全庫存 (kg)</Text>
              <TextInput style={styles.fieldInput} value={safety} onChangeText={setSafety} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.textMuted} />
              <Text style={styles.label}>備註（選填）</Text>
              <TextInput style={[styles.fieldInput, styles.textarea]} value={notes} onChangeText={setNotes} placeholder="備註..." placeholderTextColor={C.textMuted} multiline />
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, saving && { opacity: 0.6 }]} onPress={handleAdd} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>建立成品</Text>}
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
  card: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  code: { color: C.textMuted, fontSize: 11, fontWeight: '600' },
  pname: { color: C.text, fontSize: 14, fontWeight: '600', flex: 1 },
  cardMeta: { flexDirection: 'row', gap: 16 },
  metaText: { color: C.textMuted, fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: C.textMuted, fontSize: 15 },
  emptyHint: { color: '#6E7681', fontSize: 13 },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border, maxHeight: '90%' },
  sheetHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  sheetBody: { padding: 20 },
  label: { color: C.textMuted, fontSize: 13, marginBottom: 6, marginTop: 12 },
  twoCol: { flexDirection: 'row', gap: 12 },
  colHalf: { flex: 1 },
  previewBox: { backgroundColor: C.primary + '11', borderRadius: 8, borderWidth: 1, borderColor: C.primary + '44', padding: 12, alignItems: 'center', marginTop: 12 },
  previewLabel: { color: C.textMuted, fontSize: 12, marginBottom: 4 },
  previewValue: { color: C.primary, fontSize: 20, fontWeight: '700' },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  textarea: { height: 80, textAlignVertical: 'top' },
  errText: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  actionBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
