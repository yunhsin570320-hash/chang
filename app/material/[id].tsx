import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { ArrowDownToLine, SlidersHorizontal, X, TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { RawMaterial, MaterialTransaction } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

export default function MaterialDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useNavigation();
  const { sessionToken, hasErpRole } = useAuth();
  const [material, setMaterial] = useState<RawMaterial | null>(null);
  const [transactions, setTransactions] = useState<(MaterialTransaction & { operator?: { name: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [receiveModal, setReceiveModal] = useState(false);
  const [adjustModal, setAdjustModal] = useState(false);
  const [qty, setQty] = useState('');
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [newStock, setNewStock] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [matRes, txRes] = await Promise.all([
      supabase.from('raw_materials').select('*').eq('id', id).single(),
      supabase.from('material_transactions')
        .select('*, operator:profiles(name)')
        .eq('material_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (matRes.data) {
      setMaterial(matRes.data);
      nav.setOptions({ title: matRes.data.name });
    }
    setTransactions((txRes.data ?? []) as any);
  }, [id]);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleReceive = async () => {
    if (!material || !sessionToken) return;
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) { setError('請輸入有效數量'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_receive_material', { p_token: sessionToken, p_id: material.id, p_quantity: q, p_reference: ref || null, p_notes: notes || null });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setReceiveModal(false); setQty(''); setRef(''); setNotes('');
    await load();
  };

  const handleAdjust = async () => {
    if (!material || !sessionToken) return;
    const s = parseFloat(newStock);
    if (isNaN(s) || s < 0) { setError('請輸入有效的庫存數量'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_adjust_material', { p_token: sessionToken, p_id: material.id, p_new_stock: s, p_notes: notes || null });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setAdjustModal(false); setNewStock(''); setNotes('');
    await load();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} /></View>;
  if (!material) return <View style={styles.center}><Text style={{ color: C.textMuted }}>找不到此原料</Text></View>;

  const stockPct = material.safety_stock > 0 ? Math.min(material.current_stock / (material.safety_stock * 2), 1) : 1;
  const stockColor = material.current_stock < material.safety_stock ? C.danger : material.current_stock < material.safety_stock * 1.5 ? C.warning : C.success;

  const txIcon = (type: string, qty: number) => {
    if (type === 'receive') return <TrendingUp size={16} color={C.success} />;
    if (type === 'consume') return <TrendingDown size={16} color={C.danger} />;
    return qty >= 0 ? <TrendingUp size={16} color={C.warning} /> : <TrendingDown size={16} color={C.warning} />;
  };

  const txColor = (type: string, qty: number) => {
    if (type === 'receive') return C.success;
    if (type === 'consume') return C.danger;
    return C.warning;
  };

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      {/* Info Card */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>編號</Text>
          <Text style={styles.infoValue}>{material.code}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>名稱</Text>
          <Text style={styles.infoValue}>{material.name}</Text>
        </View>
        {material.supplier && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>供應商</Text>
            <Text style={styles.infoValue}>{material.supplier}</Text>
          </View>
        )}
        {material.notes && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>備註</Text>
            <Text style={styles.infoValue}>{material.notes}</Text>
          </View>
        )}
      </View>

      {/* Stock Display */}
      <View style={styles.stockCard}>
        <Text style={styles.stockLabel}>目前庫存</Text>
        <Text style={[styles.stockValue, { color: stockColor }]}>{material.current_stock} <Text style={styles.stockUnit}>{material.unit}</Text></Text>
        <View style={styles.gaugeBar}>
          <View style={[styles.gaugeFill, { width: `${stockPct * 100}%` as any, backgroundColor: stockColor }]} />
        </View>
        <Text style={styles.safetyLabel}>安全庫存：{material.safety_stock} {material.unit}</Text>
      </View>

      {/* Actions */}
      {hasErpRole('operator') && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => { setReceiveModal(true); setQty(''); setRef(''); setNotes(''); setError(null); }}>
            <ArrowDownToLine size={18} color="#fff" />
            <Text style={styles.actionBtnText}>收貨入庫</Text>
          </TouchableOpacity>
          {hasErpRole('manager') && (
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={() => { setAdjustModal(true); setNewStock(String(material.current_stock)); setNotes(''); setError(null); }}>
              <SlidersHorizontal size={18} color={C.warning} />
              <Text style={[styles.actionBtnText, { color: C.warning }]}>調整庫存</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Transaction History */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>進出紀錄</Text>
        {transactions.length === 0
          ? <View style={styles.emptyRow}><Text style={styles.emptyText}>尚無紀錄</Text></View>
          : transactions.map(tx => (
            <View key={tx.id} style={styles.txRow}>
              {txIcon(tx.type, tx.quantity)}
              <View style={styles.txInfo}>
                <View style={styles.txTop}>
                  <Text style={styles.txType}>{tx.type === 'receive' ? '收貨' : tx.type === 'consume' ? '生產用料' : '調整'}</Text>
                  {tx.reference && <Text style={styles.txRef}>{tx.reference}</Text>}
                </View>
                <Text style={styles.txMeta}>
                  {(tx as any).operator?.name ?? '—'} · {new Date(tx.created_at).toLocaleDateString('zh-TW')}
                </Text>
                {tx.notes && <Text style={styles.txNotes}>{tx.notes}</Text>}
              </View>
              <Text style={[styles.txQty, { color: txColor(tx.type, tx.quantity) }]}>
                {tx.quantity > 0 ? '+' : ''}{tx.quantity} {material.unit}
              </Text>
            </View>
          ))}
      </View>

      {/* Receive Modal */}
      <Modal visible={receiveModal} animationType="slide" transparent onRequestClose={() => setReceiveModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>收貨入庫 — {material.name}</Text>
              <TouchableOpacity onPress={() => setReceiveModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>收貨數量 ({material.unit}) *</Text>
              <TextInput style={styles.fieldInput} value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.textMuted} autoFocus />
              <Text style={styles.fieldLabel}>採購單號（選填）</Text>
              <TextInput style={styles.fieldInput} value={ref} onChangeText={setRef} placeholder="PO-XXXX" placeholderTextColor={C.textMuted} />
              <Text style={styles.fieldLabel}>備註（選填）</Text>
              <TextInput style={[styles.fieldInput, styles.textarea]} value={notes} onChangeText={setNotes} multiline placeholderTextColor={C.textMuted} />
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.modalBtn, saving && { opacity: 0.6 }]} onPress={handleReceive} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>確認收貨</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Adjust Modal */}
      <Modal visible={adjustModal} animationType="slide" transparent onRequestClose={() => setAdjustModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>調整庫存 — {material.name}</Text>
              <TouchableOpacity onPress={() => setAdjustModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>調整後庫存 ({material.unit}) *</Text>
              <TextInput style={styles.fieldInput} value={newStock} onChangeText={setNewStock} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.textMuted} autoFocus />
              <Text style={styles.fieldLabel}>調整原因 *</Text>
              <TextInput style={[styles.fieldInput, styles.textarea]} value={notes} onChangeText={setNotes} multiline placeholder="例：盤點調整" placeholderTextColor={C.textMuted} />
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: C.warning }, saving && { opacity: 0.6 }]} onPress={handleAdjust} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>確認調整</Text>}
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
  infoCard: { margin: 16, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { color: C.textMuted, fontSize: 13 },
  infoValue: { color: C.text, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' },
  stockCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 20, alignItems: 'center' },
  stockLabel: { color: C.textMuted, fontSize: 13, marginBottom: 4 },
  stockValue: { fontSize: 48, fontWeight: '800', marginBottom: 12 },
  stockUnit: { fontSize: 20, fontWeight: '400' },
  gaugeBar: { width: '100%', height: 6, backgroundColor: '#21262D', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  gaugeFill: { height: '100%', borderRadius: 3 },
  safetyLabel: { color: C.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 12 },
  actionBtnSecondary: { backgroundColor: C.warning + '22', borderWidth: 1, borderColor: C.warning + '44' },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  section: { marginHorizontal: 16, marginBottom: 32, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '700', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  emptyRow: { padding: 16, alignItems: 'center' },
  emptyText: { color: C.textMuted, fontSize: 13 },
  txRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10 },
  txInfo: { flex: 1 },
  txTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  txType: { color: C.text, fontSize: 13, fontWeight: '600' },
  txRef: { color: C.primary, fontSize: 11 },
  txMeta: { color: C.textMuted, fontSize: 11 },
  txNotes: { color: '#6E7681', fontSize: 11, marginTop: 2 },
  txQty: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border, maxHeight: '80%' },
  sheetHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700', flex: 1 },
  sheetBody: { padding: 20 },
  fieldLabel: { color: C.textMuted, fontSize: 13, marginBottom: 6, marginTop: 12 },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15 },
  textarea: { height: 80, textAlignVertical: 'top' },
  errText: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  modalBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
