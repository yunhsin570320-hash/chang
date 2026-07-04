import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AlertTriangle, CheckCircle2, Activity, Package, Beaker, Plus } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { PurchaseAlert, ProductionOrder } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

export default function Dashboard() {
  const { sessionToken, hasErpRole } = useAuth();
  const router = useRouter();
  const [alerts, setAlerts] = useState<(PurchaseAlert & { material?: { name: string; unit: string } })[]>([]);
  const [orders, setOrders] = useState<(ProductionOrder & { product?: { name: string } })[]>([]);
  const [stats, setStats] = useState({ materials: 0, products: 0, activeOrders: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [alertsRes, ordersRes, matRes, prodRes] = await Promise.all([
      supabase.from('purchase_alerts').select('*, material:raw_materials(name, unit)').eq('is_resolved', false).order('triggered_at', { ascending: false }),
      supabase.from('production_orders').select('*, product:erp_products(name)').in('status', ['pending', 'in_progress']).order('created_at', { ascending: false }).limit(5),
      supabase.from('raw_materials').select('id', { count: 'exact', head: true }),
      supabase.from('erp_products').select('id', { count: 'exact', head: true }),
    ]);
    setAlerts((alertsRes.data ?? []) as any);
    setOrders((ordersRes.data ?? []) as any);
    setStats({ materials: matRes.count ?? 0, products: prodRes.count ?? 0, activeOrders: ordersRes.data?.length ?? 0 });
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const resolveAlert = async (alertId: string) => {
    if (!sessionToken) return;
    await callRpc('rpc_erp_resolve_alert', { p_token: sessionToken, p_alert_id: alertId });
    await load();
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={C.primary} /></View>;

  const statusColor = (s: string) => s === 'in_progress' ? C.warning : C.primary;
  const statusLabel = (s: string) => s === 'in_progress' ? '生產中' : '待開始';

  return (
    <ScrollView
      style={styles.container} contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
    >
      <View style={styles.statsRow}>
        <StatCard icon={<Package size={20} color={C.primary} />} value={stats.materials} label="原料種類" color={C.primary} />
        <StatCard icon={<Activity size={20} color={C.warning} />} value={stats.activeOrders} label="進行中生產" color={C.warning} />
        <StatCard icon={<Beaker size={20} color={C.success} />} value={stats.products} label="成品種類" color={C.success} />
      </View>

      <Section title="庫存警示" count={alerts.length} countColor={alerts.length > 0 ? C.danger : C.success}>
        {alerts.length === 0
          ? <View style={styles.emptyRow}><CheckCircle2 size={18} color={C.success} /><Text style={[styles.emptyText, { color: C.success }]}>所有原料庫存正常</Text></View>
          : alerts.map(a => (
            <View key={a.id} style={styles.alertCard}>
              <AlertTriangle size={16} color={C.danger} style={{ marginTop: 2 }} />
              <View style={styles.alertInfo}>
                <Text style={styles.alertName}>{(a as any).material?.name ?? '—'}</Text>
                <Text style={styles.alertStock}>現有 <Text style={{ color: C.danger }}>{a.current_stock}</Text> {(a as any).material?.unit} ／ 安全庫存 {a.safety_stock} {(a as any).material?.unit}</Text>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={() => resolveAlert(a.id)}>
                <Text style={styles.smallBtnText}>標記處理</Text>
              </TouchableOpacity>
            </View>
          ))}
      </Section>

      <Section title="進行中生產單" count={orders.length} countColor={C.textMuted}>
        {orders.length === 0
          ? <View style={styles.emptyRow}><Text style={styles.emptyText}>目前無進行中的生產單</Text></View>
          : orders.map(o => (
            <TouchableOpacity key={o.id} style={styles.orderCard} onPress={() => router.push(`/production/${o.id}` as any)}>
              <View style={styles.orderLeft}>
                <Text style={styles.orderNum}>{o.order_number}</Text>
                <Text style={styles.orderProduct}>{(o as any).product?.name ?? '—'}</Text>
              </View>
              <View style={styles.orderRight}>
                <View style={[styles.badge, { backgroundColor: statusColor(o.status) + '22', borderColor: statusColor(o.status) + '55' }]}>
                  <Text style={[styles.badgeText, { color: statusColor(o.status) }]}>{statusLabel(o.status)}</Text>
                </View>
                <Text style={styles.orderQty}>{o.planned_quantity} kg</Text>
              </View>
            </TouchableOpacity>
          ))}
      </Section>

      {hasErpRole('operator') && (
        <Section title="快速操作">
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickBtn} onPress={() => router.push('/(tabs)/seller' as any)}>
              <Plus size={16} color={C.primary} />
              <Text style={[styles.quickBtnText, { color: C.primary }]}>新增生產單</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.quickBtn, { borderColor: C.success + '55', backgroundColor: C.success + '11' }]} onPress={() => router.push('/(tabs)/shipping' as any)}>
              <Plus size={16} color={C.success} />
              <Text style={[styles.quickBtnText, { color: C.success }]}>建立出貨單</Text>
            </TouchableOpacity>
          </View>
        </Section>
      )}
    </ScrollView>
  );
}

function StatCard({ icon, value, label, color }: { icon: React.ReactNode; value: number; label: string; color: string }) {
  return (
    <View style={[statS.card, { borderColor: color + '44' }]}>
      {icon}
      <Text style={[statS.value, { color }]}>{value}</Text>
      <Text style={statS.label}>{label}</Text>
    </View>
  );
}
const statS = StyleSheet.create({
  card: { flex: 1, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center', gap: 6 },
  value: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 11, color: C.textMuted, textAlign: 'center' },
});

function Section({ title, count, countColor, children }: { title: string; count?: number; countColor?: string; children: React.ReactNode }) {
  return (
    <View style={secS.wrap}>
      <View style={secS.hdr}><Text style={secS.title}>{title}</Text>{count !== undefined && <Text style={[secS.count, { color: countColor ?? C.textMuted }]}>{count}</Text>}</View>
      <View style={secS.body}>{children}</View>
    </View>
  );
}
const secS = StyleSheet.create({
  wrap: { marginBottom: 20 },
  hdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '700', color: C.text },
  count: { fontSize: 13, fontWeight: '600' },
  body: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  emptyText: { color: C.textMuted, fontSize: 14 },
  alertCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  alertInfo: { flex: 1 },
  alertName: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  alertStock: { color: C.textMuted, fontSize: 13 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: 'rgba(248,81,73,0.12)', borderWidth: 1, borderColor: 'rgba(248,81,73,0.3)' },
  smallBtnText: { color: C.danger, fontSize: 12, fontWeight: '600' },
  orderCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  orderLeft: { flex: 1 },
  orderNum: { color: C.text, fontSize: 13, fontWeight: '600', marginBottom: 2 },
  orderProduct: { color: C.textMuted, fontSize: 12 },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  orderQty: { color: C.textMuted, fontSize: 12 },
  quickRow: { flexDirection: 'row', gap: 10, padding: 14 },
  quickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '55', backgroundColor: C.primary + '11' },
  quickBtnText: { fontSize: 13, fontWeight: '600' },
});
