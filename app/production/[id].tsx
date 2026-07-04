import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Play, CheckSquare, X, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { ProductionOrder, ProductionConsumption } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:     { label: '待開始', color: C.primary },
  in_progress: { label: '生產中', color: C.warning },
  completed:   { label: '已完成', color: C.success },
  cancelled:   { label: '已取消', color: C.textMuted },
};

export default function ProductionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useNavigation();
  const { sessionToken, hasErpRole } = useAuth();
  const [order, setOrder] = useState<ProductionOrder & { product?: { name: string; code: string } } | null>(null);
  const [consumption, setConsumption] = useState<(ProductionConsumption & { material?: { name: string; code: string; unit: string; current_stock: number } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [actualQty, setActualQty] = useState('');
  const [completeModal, setCompleteModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [orderRes, consumRes] = await Promise.all([
      supabase.from('production_orders')
        .select('*, product:erp_products(name, code), operator:profiles(name), created_by_user:profiles!production_orders_created_by_fkey(name)')
        .eq('id', id)
        .single(),
      supabase.from('production_consumption')
        .select('*, material:raw_materials(name, code, unit, current_stock)')
        .eq('order_id', id),
    ]);
    if (orderRes.data) {
      setOrder(orderRes.data as any);
      nav.setOptions({ title: (orderRes.data as any).order_number });
    }
    setConsumption((consumRes.data ?? []) as any);
  }, [id]);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleStart = async () => {
    if (!order || !sessionToken) return;
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_start_production', { p_token: sessionToken, p_order_id: order.id });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    await load();
  };

  const handleComplete = async () => {
    if (!order || !sessionToken) return;
    const aq = parseFloat(actualQty);
    if (isNaN(aq) || aq <= 0) { setError('請輸入實際生產數量'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_complete_production', { p_token: sessionToken, p_order_id: order.id, p_actual_quantity: aq });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setCompleteModal(false); setActualQty('');
    await load();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} /></View>;
  if (!order) return <View style={styles.center}><Text style={{ color: C.textMuted }}>找不到此生產單</Text></View>;

  const meta = STATUS_META[order.status] ?? { label: order.status, color: C.textMuted };
  const allAvailable = consumption.every(c => {
    const mat = (c as any).material;
    return mat ? mat.current_stock >= c.planned_quantity : true;
  });

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      {/* Order Header */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <Text style={styles.orderNum}>{order.order_number}</Text>
          <View style={[styles.badge, { backgroundColor: meta.color + '22', borderColor: meta.color + '55' }]}>
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
        <Text style={styles.productName}>{(order as any).product?.name ?? '—'}</Text>
        <Text style={styles.productCode}>{(order as any).product?.code}</Text>
      </View>

      {/* Order Info */}
      <View style={styles.infoCard}>
        <InfoRow label="計畫生產" value={`${order.planned_quantity} kg`} />
        {order.actual_quantity && <InfoRow label="實際產量" value={`${order.actual_quantity} kg`} valueColor={C.success} />}
        <InfoRow label="建立時間" value={new Date(order.created_at).toLocaleString('zh-TW')} />
        {order.started_at && <InfoRow label="開始時間" value={new Date(order.started_at).toLocaleString('zh-TW')} />}
        {order.completed_at && <InfoRow label="完成時間" value={new Date(order.completed_at).toLocaleString('zh-TW')} />}
        {(order as any).operator?.name && <InfoRow label="作業人員" value={(order as any).operator.name} />}
        {order.notes && <InfoRow label="備註" value={order.notes} />}
      </View>

      {/* Material Requirements */}
      <View style={styles.section}>
        <View style={styles.sectionHdr}>
          <Text style={styles.sectionTitle}>原料需求</Text>
          {order.status === 'pending' && (
            <View style={[styles.availBadge, { backgroundColor: (allAvailable ? C.success : C.danger) + '22', borderColor: (allAvailable ? C.success : C.danger) + '55' }]}>
              {allAvailable
                ? <><CheckCircle2 size={12} color={C.success} /><Text style={[styles.availText, { color: C.success }]}>原料充足</Text></>
                : <><AlertTriangle size={12} color={C.danger} /><Text style={[styles.availText, { color: C.danger }]}>原料不足</Text></>
              }
            </View>
          )}
        </View>
        {consumption.length === 0
          ? <View style={styles.emptyRow}><Text style={styles.emptyText}>此產品尚未設定配方</Text></View>
          : consumption.map(c => {
            const mat = (c as any).material;
            const available = mat ? mat.current_stock >= c.planned_quantity : true;
            const actualUsed = c.actual_quantity;
            return (
              <View key={c.id} style={styles.matRow}>
                <View style={styles.matInfo}>
                  <Text style={styles.matName}>{mat?.name ?? '—'}</Text>
                  <Text style={styles.matCode}>{mat?.code}</Text>
                </View>
                <View style={styles.matQty}>
                  <Text style={styles.matPlanned}>{c.planned_quantity} {mat?.unit}</Text>
                  {actualUsed != null && <Text style={styles.matActual}>實際：{actualUsed} {mat?.unit}</Text>}
                  {order.status === 'pending' && mat && (
                    <Text style={[styles.matStock, { color: available ? C.success : C.danger }]}>
                      庫存：{mat.current_stock} {mat.unit}
                    </Text>
                  )}
                </View>
                {order.status === 'pending' && !available && <AlertTriangle size={14} color={C.danger} />}
              </View>
            );
          })}
      </View>

      {/* Actions */}
      {hasErpRole('operator') && order.status === 'pending' && (
        <View style={styles.actionsWrap}>
          {error && <Text style={styles.errText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.warning }, (!allAvailable || saving) && { opacity: 0.6 }]}
            onPress={handleStart}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <><Play size={18} color="#fff" /><Text style={styles.actionBtnText}>開始生產</Text></>}
          </TouchableOpacity>
          {!allAvailable && <Text style={styles.warnText}>原料庫存不足，請先補充原料再開始生產</Text>}
        </View>
      )}

      {hasErpRole('operator') && order.status === 'in_progress' && (
        <View style={styles.actionsWrap}>
          {error && <Text style={styles.errText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.success }, saving && { opacity: 0.6 }]}
            onPress={() => { setCompleteModal(true); setActualQty(String(order.planned_quantity)); setError(null); }}
            disabled={saving}
          >
            <CheckSquare size={18} color="#fff" />
            <Text style={styles.actionBtnText}>完成生產</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Complete Modal */}
      <Modal visible={completeModal} animationType="slide" transparent onRequestClose={() => setCompleteModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>完成生產 — {order.order_number}</Text>
              <TouchableOpacity onPress={() => setCompleteModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <View style={styles.sheetBody}>
              <Text style={styles.label}>實際生產數量 (kg) *</Text>
              <Text style={styles.hint}>計畫生產：{order.planned_quantity} kg</Text>
              <TextInput
                style={styles.fieldInput}
                value={actualQty}
                onChangeText={setActualQty}
                keyboardType="decimal-pad"
                placeholder={String(order.planned_quantity)}
                placeholderTextColor={C.textMuted}
                autoFocus
              />
              <Text style={styles.noteText}>系統將根據實際產量按比例扣除原料庫存，並增加成品庫存。</Text>
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.success }, saving && { opacity: 0.6 }]} onPress={handleComplete} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>確認完成</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={irStyles.row}>
      <Text style={irStyles.label}>{label}</Text>
      <Text style={[irStyles.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}
const irStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { color: C.textMuted, fontSize: 13 },
  value: { color: C.text, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  headerCard: { margin: 16, marginBottom: 12, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 16 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  orderNum: { color: C.text, fontSize: 18, fontWeight: '700' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  productName: { color: C.text, fontSize: 16, fontWeight: '600', marginBottom: 2 },
  productCode: { color: C.textMuted, fontSize: 12 },
  infoCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  section: { marginHorizontal: 16, marginBottom: 16, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  sectionHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  availBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  availText: { fontSize: 11, fontWeight: '600' },
  emptyRow: { padding: 16, alignItems: 'center' },
  emptyText: { color: C.textMuted, fontSize: 13 },
  matRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 },
  matInfo: { flex: 1 },
  matName: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  matCode: { color: C.textMuted, fontSize: 11 },
  matQty: { alignItems: 'flex-end' },
  matPlanned: { color: C.text, fontSize: 14, fontWeight: '600' },
  matActual: { color: C.success, fontSize: 12 },
  matStock: { fontSize: 11 },
  actionsWrap: { marginHorizontal: 16, marginBottom: 32 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingVertical: 14, marginTop: 4 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  warnText: { color: C.danger, fontSize: 12, textAlign: 'center', marginTop: 8 },
  errText: { color: C.danger, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border },
  sheetHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700', flex: 1 },
  sheetBody: { padding: 20 },
  label: { color: C.textMuted, fontSize: 13, marginBottom: 4 },
  hint: { color: C.textMuted, fontSize: 12, marginBottom: 8 },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 12, color: C.text, fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  noteText: { color: C.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8 },
});
