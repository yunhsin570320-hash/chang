import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator, Modal, Alert,
} from 'react-native';
import {
  ShieldCheck, Users, Package, Flag, AlertTriangle,
  Ban, CheckCircle, X, ChevronRight, Eye, Trash2,
  RotateCcw, MessageSquare, Clock, TrendingUp,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, Profile, Report, Product } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from 'expo-router';

type AdminTab = 'dashboard' | 'members' | 'products' | 'reports' | 'actions';

type Stats = {
  totalUsers: number;
  blockedUsers: number;
  totalProducts: number;
  flaggedProducts: number;
  pendingReports: number;
  totalBids: number;
};

type MemberWithCounts = Profile & {
  bid_count?: number;
  product_count?: number;
  report_count?: number;
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  fake_product: '不實商品',
  abandon_bid: '棄標',
  fraud: '詐欺',
  spam: '垃圾廣告',
  other: '其他',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  warn: '警告',
  block: '封鎖帳號',
  unblock: '解除封鎖',
  remove_product: '下架商品',
  approve_product: '核准商品',
  resolve_report: '結案檢舉',
  dismiss_report: '駁回檢舉',
};

const ACTION_COLORS: Record<string, string> = {
  warn: '#FFD700',
  block: '#FF6B6B',
  unblock: '#00D4AA',
  remove_product: '#FF6B6B',
  approve_product: '#00D4AA',
  resolve_report: '#00D4AA',
  dismiss_report: '#888',
};

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [stats, setStats] = useState<Stats | null>(null);
  const [members, setMembers] = useState<MemberWithCounts[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [actionLog, setActionLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [memberSearch, setMemberSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState<'all' | 'blocked' | 'warned'>('all');
  const [productFilter, setProductFilter] = useState<'all' | 'flagged'>('all');
  const [reportFilter, setReportFilter] = useState<'all' | 'pending'>('pending');

  const [actionModal, setActionModal] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ type: 'user' | 'product' | 'report'; id: string; name: string } | null>(null);
  const [selectedAction, setSelectedAction] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actioning, setActioning] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!user || !isAdmin) return;
    setLoading(true);
    try {
      const [usersRes, productsRes, reportsRes, bidsRes] = await Promise.all([
        supabase.from('profiles').select('id, is_admin, is_blocked, warning_count', { count: 'exact' }),
        supabase.from('products').select('id, is_flagged, is_approved', { count: 'exact' }),
        supabase.from('reports').select('id, status', { count: 'exact' }),
        supabase.from('bids').select('id', { count: 'exact', head: true }),
      ]);

      const allUsers = usersRes.data || [];
      const allProducts = productsRes.data || [];
      const allReports = reportsRes.data || [];

      setStats({
        totalUsers: allUsers.filter(u => !u.is_admin).length,
        blockedUsers: allUsers.filter(u => u.is_blocked).length,
        totalProducts: allProducts.length,
        flaggedProducts: allProducts.filter(p => p.is_flagged).length,
        pendingReports: allReports.filter(r => r.status === 'pending').length,
        totalBids: bidsRes.count || 0,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin]);

  const fetchTabData = useCallback(async (tab: AdminTab) => {
    if (!user || !isAdmin) return;
    try {
      if (tab === 'members') {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, name, email, is_admin, is_blocked, is_buyer, is_seller, phone, phone_verified, warning_count, blocked_reason, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setMembers((data || []).filter((u: any) => !u.is_admin));
      } else if (tab === 'products') {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, status, is_flagged, flag_reason, is_approved, created_at, seller_id, seller:profiles!seller_id(id, name, email)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setProducts((data || []) as any);
      } else if (tab === 'reports') {
        const { data, error } = await supabase
          .from('reports')
          .select('id, type, reason, status, created_at, product_id, reporter_id, reported_user_id, reporter:profiles!reporter_id(id, name, email), reported_user:profiles!reported_user_id(id, name, email, is_blocked), product:products(id, name)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setReports((data || []) as any);
      } else if (tab === 'actions') {
        const { data, error } = await supabase
          .from('admin_actions')
          .select('id, action_type, reason, created_at, admin:profiles!admin_id(id, name), target_user:profiles!target_user_id(id, name)')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        setActionLog(data || []);
      }
    } catch (e) {
      console.error('fetchTabData error for tab', tab, e);
    }
  }, [user, isAdmin]);


  const fetchAll = useCallback(async (currentTab: AdminTab) => {
    await fetchStats();
    await fetchTabData(currentTab);
  }, [fetchStats, fetchTabData]);

  useFocusEffect(useCallback(() => { fetchAll(activeTab); }, [fetchAll, activeTab]));

  const handleTabChange = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    fetchTabData(tab);
  }, [fetchTabData]);

  if (!isAdmin) {
    return (
      <View style={styles.blocked}>
        <ShieldCheck size={48} color="#FF6B6B" />
        <Text style={styles.blockedText}>無管理員權限</Text>
      </View>
    );
  }

  const openActionModal = (type: 'user' | 'product' | 'report', id: string, name: string) => {
    setActionTarget({ type, id, name });
    setSelectedAction('');
    setActionReason('');
    setActionModal(true);
  };

  const getUserActions = (type: 'user' | 'product' | 'report') => {
    if (type === 'user') return ['warn', 'block', 'unblock'];
    if (type === 'product') return ['remove_product', 'approve_product'];
    return ['resolve_report', 'dismiss_report'];
  };

  const executeAction = async () => {
    if (!actionTarget || !selectedAction || !actionReason.trim() || !user) return;
    setActioning(true);
    try {
      const logEntry: any = {
        admin_id: user.id,
        action_type: selectedAction,
        reason: actionReason.trim(),
      };

      if (actionTarget.type === 'user') {
        logEntry.target_user_id = actionTarget.id;

        if (selectedAction === 'warn') {
          await supabase.from('profiles')
            .update({ warning_count: (members.find(m => m.id === actionTarget.id)?.warning_count || 0) + 1 })
            .eq('id', actionTarget.id);
          // Send notification
          await supabase.from('notifications').insert({
            user_id: actionTarget.id,
            type: 'auction_ended',
            title: '帳號警告通知',
            message: `您的帳號已收到管理員警告。原因：${actionReason.trim()}`,
            is_read: false,
          });
        } else if (selectedAction === 'block') {
          await supabase.from('profiles').update({
            is_blocked: true,
            blocked_reason: actionReason.trim(),
            blocked_at: new Date().toISOString(),
          }).eq('id', actionTarget.id);
          // Force end all active products by this user
          await supabase.from('products').update({ status: 'ended' }).eq('seller_id', actionTarget.id).eq('status', 'active');
        } else if (selectedAction === 'unblock') {
          await supabase.from('profiles').update({
            is_blocked: false,
            blocked_reason: null,
            blocked_at: null,
          }).eq('id', actionTarget.id);
        }
      } else if (actionTarget.type === 'product') {
        logEntry.product_id = actionTarget.id;

        if (selectedAction === 'remove_product') {
          await supabase.from('products').update({ status: 'ended', is_flagged: true, flag_reason: actionReason.trim(), is_approved: false }).eq('id', actionTarget.id);
        } else if (selectedAction === 'approve_product') {
          await supabase.from('products').update({ is_flagged: false, flag_reason: null, is_approved: true }).eq('id', actionTarget.id);
        }
      } else if (actionTarget.type === 'report') {
        const newStatus = selectedAction === 'resolve_report' ? 'resolved' : 'dismissed';
        await supabase.from('reports').update({
          status: newStatus,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
          admin_note: actionReason.trim(),
        }).eq('id', actionTarget.id);
        logEntry.target_user_id = reports.find(r => r.id === actionTarget.id)?.reported_user_id || null;
      }

      await supabase.from('admin_actions').insert(logEntry);
      await fetchStats();
      await fetchTabData(activeTab);
      setActionModal(false);
    } catch (e) {
      console.error(e);
    } finally {
      setActioning(false);
    }
  };

  const filteredMembers = members.filter(m => {
    const searchMatch = !memberSearch || m.name.includes(memberSearch) || (m.email || '').includes(memberSearch);
    const filterMatch = memberFilter === 'all' || (memberFilter === 'blocked' && m.is_blocked) || (memberFilter === 'warned' && (m.warning_count || 0) > 0);
    return searchMatch && filterMatch;
  });

  const filteredProducts = productFilter === 'flagged'
    ? products.filter(p => p.is_flagged)
    : products;
  const filteredReports = reportFilter === 'pending' ? reports.filter(r => r.status === 'pending') : reports;

  const renderDashboard = () => (
    <ScrollView style={styles.tabContent} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
      <Text style={styles.sectionTitle}>系統概覽</Text>
      <View style={styles.statsGrid}>
        {[
          { label: '總會員數', value: stats?.totalUsers ?? '—', icon: <Users size={20} color="#00D4AA" />, color: '#00D4AA' },
          { label: '封鎖帳號', value: stats?.blockedUsers ?? '—', icon: <Ban size={20} color="#FF6B6B" />, color: '#FF6B6B' },
          { label: '上架商品', value: stats?.totalProducts ?? '—', icon: <Package size={20} color="#FFD700" />, color: '#FFD700' },
          { label: '檢舉商品', value: stats?.flaggedProducts ?? '—', icon: <AlertTriangle size={20} color="#FF8C00" />, color: '#FF8C00' },
          { label: '待處理檢舉', value: stats?.pendingReports ?? '—', icon: <Flag size={20} color="#FF6B6B" />, color: '#FF6B6B' },
          { label: '競標次數', value: stats?.totalBids ?? '—', icon: <TrendingUp size={20} color="#00D4AA" />, color: '#00D4AA' },
        ].map((s, i) => (
          <View key={i} style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: s.color + '22' }]}>{s.icon}</View>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>快速操作</Text>
      {[
        { label: '處理待審檢舉', count: stats?.pendingReports, tab: 'reports' as AdminTab, color: '#FF6B6B' },
        { label: '查看檢舉商品', count: stats?.flaggedProducts, tab: 'products' as AdminTab, color: '#FF8C00' },
        { label: '管理被封鎖帳號', count: stats?.blockedUsers, tab: 'members' as AdminTab, color: '#888' },
      ].map((q, i) => (
        <TouchableOpacity key={i} style={styles.quickCard} onPress={() => handleTabChange(q.tab)}>
          <View style={[styles.quickDot, { backgroundColor: q.color }]} />
          <Text style={styles.quickLabel}>{q.label}</Text>
          {(q.count || 0) > 0 && (
            <View style={[styles.countBadge, { backgroundColor: q.color }]}>
              <Text style={styles.countBadgeText}>{q.count}</Text>
            </View>
          )}
          <ChevronRight size={18} color="#555" />
        </TouchableOpacity>
      ))}

      <Text style={styles.sectionTitle}>最近操作紀錄</Text>
      {actionLog.slice(0, 5).map(a => (
        <View key={a.id} style={styles.actionLogCard}>
          <View style={[styles.actionDot, { backgroundColor: ACTION_COLORS[a.action_type] || '#888' }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.actionLogText}>
              <Text style={{ color: ACTION_COLORS[a.action_type] || '#fff' }}>{ACTION_TYPE_LABELS[a.action_type]}</Text>
              {a.target_user && <Text style={styles.actionLogSub}> — {a.target_user.name}</Text>}
            </Text>
            <Text style={styles.actionLogReason} numberOfLines={1}>{a.reason}</Text>
            <Text style={styles.actionLogTime}>{new Date(a.created_at).toLocaleString('zh-TW')}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );

  const renderMembers = () => (
    <View style={styles.tabContent}>
      <View style={styles.filterBar}>
        <TextInput
          style={styles.searchInput}
          value={memberSearch}
          onChangeText={setMemberSearch}
          placeholder="搜尋姓名或郵箱"
          placeholderTextColor="#444"
        />
      </View>
      <View style={styles.filterPills}>
        {(['all', 'blocked', 'warned'] as const).map(f => (
          <TouchableOpacity key={f} style={[styles.pill, memberFilter === f && styles.pillActive]} onPress={() => setMemberFilter(f)}>
            <Text style={[styles.pillText, memberFilter === f && styles.pillTextActive]}>
              {f === 'all' ? '全部' : f === 'blocked' ? '封鎖中' : '有警告'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filteredMembers}
        keyExtractor={m => m.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
        renderItem={({ item: m }) => (
          <View style={styles.memberCard}>
            <View style={styles.memberInfo}>
              <View style={styles.memberNameRow}>
                <Text style={styles.memberName}>{m.name}</Text>
                {m.is_blocked && <View style={styles.blockedBadge}><Text style={styles.blockedBadgeText}>封鎖中</Text></View>}
                {m.is_admin && <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>管理員</Text></View>}
                {(m.warning_count || 0) > 0 && (
                  <View style={styles.warnBadge}><Text style={styles.warnBadgeText}>警告 {m.warning_count}</Text></View>
                )}
              </View>
              <Text style={styles.memberEmail}>{m.email}</Text>
              <View style={styles.memberMeta}>
                {m.is_buyer && <Text style={styles.metaChip}>買家</Text>}
                {m.is_seller && <Text style={[styles.metaChip, { color: '#FFD700', borderColor: '#FFD700' }]}>賣家</Text>}
                {m.phone && <Text style={styles.metaChip}>{m.phone}{m.phone_verified ? ' ✓' : ' !'}</Text>}
              </View>
              {m.is_blocked && m.blocked_reason && (
                <Text style={styles.blockReason}>封鎖原因：{m.blocked_reason}</Text>
              )}
            </View>
            {!m.is_admin && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => openActionModal('user', m.id, m.name)}>
                <Text style={styles.actionBtnText}>管理</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyText}>無符合條件的會員</Text></View>}
      />
    </View>
  );

  const renderProducts = () => (
    <View style={styles.tabContent}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 }}>
        {(['all', 'flagged'] as const).map(f => (
          <TouchableOpacity key={f} style={[styles.pill, productFilter === f && styles.pillActive]} onPress={() => setProductFilter(f)}>
            <Text style={[styles.pillText, productFilter === f && styles.pillTextActive]}>
              {f === 'all' ? '全部商品' : '檢舉商品'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filteredProducts}
        keyExtractor={p => p.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
        renderItem={({ item: p }) => (
          <View style={styles.productCard}>
            <View style={{ flex: 1 }}>
              <View style={styles.productNameRow}>
                <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
                {p.is_flagged && <View style={styles.flagBadge}><Text style={styles.flagBadgeText}>檢舉</Text></View>}
                <View style={[styles.statusBadge, p.status === 'active' ? styles.activeBadge : styles.endedBadge]}>
                  <Text style={styles.statusText}>{p.status === 'active' ? '競標中' : '已結標'}</Text>
                </View>
              </View>
              <Text style={styles.productSeller}>賣家: {(p as any).seller?.name || '—'} · {(p as any).seller?.email || ''}</Text>
              {p.flag_reason && <Text style={styles.flagReason}>檢舉原因：{p.flag_reason}</Text>}
              <Text style={styles.productDate}>{new Date(p.created_at).toLocaleDateString('zh-TW')}</Text>
            </View>
            <View style={styles.productActions}>
              <TouchableOpacity style={styles.viewBtn} onPress={() => router.push(`/product/${p.id}`)}>
                <Eye size={16} color="#888" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => openActionModal('product', p.id, p.name)}>
                <Text style={styles.actionBtnText}>管理</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyText}>無符合條件的商品</Text></View>}
      />
    </View>
  );

  const renderReports = () => (
    <View style={styles.tabContent}>
      <View style={{ flexDirection: 'row', padding: 12, gap: 8 }}>
        {(['pending', 'all'] as const).map(f => (
          <TouchableOpacity key={f} style={[styles.pill, reportFilter === f && styles.pillActive]} onPress={() => setReportFilter(f)}>
            <Text style={[styles.pillText, reportFilter === f && styles.pillTextActive]}>
              {f === 'pending' ? `待處理 (${reports.filter(r => r.status === 'pending').length})` : '全部'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filteredReports}
        keyExtractor={r => r.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
        renderItem={({ item: r }) => (
          <View style={styles.reportCard}>
            <View style={styles.reportHeader}>
              <View style={styles.reportTypeBadge}>
                <Text style={styles.reportTypeText}>{REPORT_TYPE_LABELS[r.type] || r.type}</Text>
              </View>
              <View style={[styles.reportStatusBadge,
                r.status === 'pending' ? styles.pendingStatus :
                r.status === 'resolved' ? styles.resolvedStatus : styles.dismissedStatus
              ]}>
                <Text style={styles.reportStatusText}>
                  {r.status === 'pending' ? '待處理' : r.status === 'resolved' ? '已結案' : r.status === 'reviewed' ? '審查中' : '已駁回'}
                </Text>
              </View>
            </View>
            <View style={styles.reportParties}>
              <Text style={styles.reportParty}>
                <Text style={styles.reportPartyLabel}>檢舉人：</Text>
                {(r as any).reporter?.name || '—'}
              </Text>
              <Text style={styles.reportParty}>
                <Text style={styles.reportPartyLabel}>被檢舉：</Text>
                {(r as any).reported_user?.name || '—'}
                {(r as any).reported_user?.is_blocked && <Text style={{ color: '#FF6B6B' }}> [封鎖中]</Text>}
              </Text>
            </View>
            {r.product_id && (
              <TouchableOpacity onPress={() => router.push(`/product/${r.product_id}`)}>
                <Text style={[styles.reportProduct, { textDecorationLine: 'underline' }]}>
                  商品：{(r as any).product?.name || r.product_id}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={styles.reportReason}>原因：{r.reason}</Text>
            <View style={styles.reportFooter}>
              <Text style={styles.reportDate}>{new Date(r.created_at).toLocaleDateString('zh-TW')}</Text>
              {r.status === 'pending' && (
                <TouchableOpacity style={styles.actionBtn} onPress={() => openActionModal('report', r.id, `${(r as any).reported_user?.name || '用戶'} 的檢舉`)}>
                  <Text style={styles.actionBtnText}>處理</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyText}>暫無檢舉紀錄</Text></View>}
      />
    </View>
  );

  const renderActionLog = () => (
    <FlatList
      data={actionLog}
      keyExtractor={a => a.id}
      contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
      renderItem={({ item: a }) => (
        <View style={styles.actionLogFullCard}>
          <View style={[styles.actionTypePill, { backgroundColor: (ACTION_COLORS[a.action_type] || '#888') + '22' }]}>
            <Text style={[styles.actionTypeText, { color: ACTION_COLORS[a.action_type] || '#888' }]}>
              {ACTION_TYPE_LABELS[a.action_type] || a.action_type}
            </Text>
          </View>
          {a.target_user && <Text style={styles.actionTarget}>對象：{a.target_user.name}</Text>}
          <Text style={styles.actionReasonFull}>原因：{a.reason}</Text>
          <Text style={styles.actionTime}>{new Date(a.created_at).toLocaleString('zh-TW')}</Text>
        </View>
      )}
      ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyText}>暫無操作紀錄</Text></View>}
    />
  );

  const availableActions = actionTarget ? getUserActions(actionTarget.type) : [];

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarScroll} contentContainerStyle={styles.tabBarContent}>
        {([
          { key: 'dashboard', label: '總覽' },
          { key: 'members', label: `會員 (${stats?.totalUsers ?? '…'})` },
          { key: 'products', label: `商品 (${stats?.totalProducts ?? '…'})` },
          { key: 'reports', label: `檢舉 ${(stats?.pendingReports ?? 0) > 0 ? `(${stats?.pendingReports})` : ''}` },
          { key: 'actions', label: '操作紀錄' },
        ] as { key: AdminTab; label: string }[]).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => handleTabChange(t.key)}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#00D4AA" />
        </View>
      ) : (
        <>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'members' && renderMembers()}
          {activeTab === 'products' && renderProducts()}
          {activeTab === 'reports' && renderReports()}
          {activeTab === 'actions' && renderActionLog()}
        </>
      )}

      {/* Action Modal */}
      <Modal visible={actionModal} transparent animationType="slide" onRequestClose={() => setActionModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>管理操作</Text>
              <TouchableOpacity onPress={() => setActionModal(false)}>
                <X size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalTargetName}>{actionTarget?.name}</Text>

            <Text style={styles.modalLabel}>選擇操作</Text>
            <View style={styles.actionOptions}>
              {availableActions.map(a => (
                <TouchableOpacity
                  key={a}
                  style={[styles.actionOption, selectedAction === a && { borderColor: ACTION_COLORS[a] || '#00D4AA', backgroundColor: (ACTION_COLORS[a] || '#00D4AA') + '22' }]}
                  onPress={() => setSelectedAction(a)}
                >
                  <Text style={[styles.actionOptionText, selectedAction === a && { color: ACTION_COLORS[a] || '#00D4AA' }]}>
                    {ACTION_TYPE_LABELS[a] || a}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.modalLabel}>原因說明 *</Text>
            <TextInput
              style={styles.reasonInput}
              value={actionReason}
              onChangeText={setActionReason}
              placeholder="請填寫操作原因（將記錄於操作日誌）"
              placeholderTextColor="#444"
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              style={[styles.confirmBtn, (!selectedAction || !actionReason.trim() || actioning) && styles.confirmBtnDisabled]}
              onPress={executeAction}
              disabled={!selectedAction || !actionReason.trim() || actioning}
            >
              {actioning ? <ActivityIndicator color="#000" /> : <Text style={styles.confirmBtnText}>確認執行</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  blocked: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A' },
  blockedText: { color: '#FF6B6B', fontSize: 18, marginTop: 12 },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabBarScroll: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', maxHeight: 48 },
  tabBarContent: { paddingHorizontal: 8, gap: 4, alignItems: 'center' },
  tab: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#00D4AA' },
  tabText: { color: '#666', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#00D4AA' },
  tabContent: { flex: 1 },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: '700', marginBottom: 12, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  statCard: {
    width: '30%', minWidth: 90, flex: 1,
    backgroundColor: '#1A1A2E', borderRadius: 14, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  statIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  statValue: { fontSize: 24, fontWeight: '800', marginBottom: 4 },
  statLabel: { color: '#666', fontSize: 11, textAlign: 'center' },
  quickCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1A1A2E', borderRadius: 12, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  quickDot: { width: 10, height: 10, borderRadius: 5 },
  quickLabel: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  countBadge: { borderRadius: 8, minWidth: 22, height: 22, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  countBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  actionLogCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#1A1A2E', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  actionDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  actionLogText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  actionLogSub: { color: '#aaa', fontWeight: '400' },
  actionLogReason: { color: '#666', fontSize: 12, marginTop: 2 },
  actionLogTime: { color: '#444', fontSize: 11, marginTop: 2 },
  filterBar: { padding: 12, paddingBottom: 0 },
  searchInput: {
    backgroundColor: '#1A1A2E', borderRadius: 8, padding: 12,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  filterPills: { flexDirection: 'row', gap: 8, padding: 12 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  pillActive: { backgroundColor: 'rgba(0,212,170,0.2)', borderColor: '#00D4AA' },
  pillText: { color: '#888', fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#00D4AA' },
  memberCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#1A1A2E', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  memberName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  blockedBadge: { backgroundColor: 'rgba(255,107,107,0.2)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  blockedBadgeText: { color: '#FF6B6B', fontSize: 11, fontWeight: '700' },
  adminBadge: { backgroundColor: 'rgba(0,212,170,0.2)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  adminBadgeText: { color: '#00D4AA', fontSize: 11, fontWeight: '700' },
  warnBadge: { backgroundColor: 'rgba(255,215,0,0.2)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  warnBadgeText: { color: '#FFD700', fontSize: 11, fontWeight: '700' },
  memberEmail: { color: '#666', fontSize: 13, marginBottom: 6 },
  memberMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  metaChip: { color: '#00D4AA', fontSize: 11, borderWidth: 1, borderColor: 'rgba(0,212,170,0.3)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  blockReason: { color: '#FF6B6B', fontSize: 12, marginTop: 4 },
  actionBtn: {
    backgroundColor: 'rgba(0,212,170,0.15)', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,212,170,0.3)',
    alignSelf: 'flex-start',
  },
  actionBtnText: { color: '#00D4AA', fontSize: 13, fontWeight: '600' },
  productCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#1A1A2E', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  productNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  productName: { color: '#fff', fontSize: 14, fontWeight: '700', flex: 1 },
  flagBadge: { backgroundColor: 'rgba(255,107,107,0.2)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  flagBadgeText: { color: '#FF6B6B', fontSize: 11, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  activeBadge: { backgroundColor: 'rgba(0,212,170,0.2)' },
  endedBadge: { backgroundColor: 'rgba(255,107,107,0.15)' },
  statusText: { fontSize: 11, fontWeight: '700', color: '#00D4AA' },
  productSeller: { color: '#666', fontSize: 12, marginBottom: 2 },
  flagReason: { color: '#FF6B6B', fontSize: 12, marginBottom: 2 },
  productDate: { color: '#444', fontSize: 11 },
  productActions: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  viewBtn: {
    padding: 8, borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  reportCard: {
    backgroundColor: '#1A1A2E', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  reportHeader: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  reportTypeBadge: { backgroundColor: 'rgba(255,215,0,0.15)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  reportTypeText: { color: '#FFD700', fontSize: 12, fontWeight: '700' },
  reportStatusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  pendingStatus: { backgroundColor: 'rgba(255,107,107,0.2)' },
  resolvedStatus: { backgroundColor: 'rgba(0,212,170,0.2)' },
  dismissedStatus: { backgroundColor: 'rgba(255,255,255,0.08)' },
  reportStatusText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  reportParties: { gap: 4, marginBottom: 8 },
  reportParty: { color: '#aaa', fontSize: 13 },
  reportPartyLabel: { color: '#666' },
  reportProduct: { color: '#888', fontSize: 12, marginBottom: 6 },
  reportReason: { color: '#ccc', fontSize: 13, marginBottom: 8 },
  reportFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reportDate: { color: '#444', fontSize: 11 },
  actionLogFullCard: {
    backgroundColor: '#1A1A2E', borderRadius: 10, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  actionTypePill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  actionTypeText: { fontSize: 12, fontWeight: '700' },
  actionTarget: { color: '#aaa', fontSize: 13, marginBottom: 4 },
  actionReasonFull: { color: '#888', fontSize: 13, marginBottom: 4 },
  actionTime: { color: '#444', fontSize: 11 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: '#555', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: '#1A1A2E', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '85%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  modalTargetName: { color: '#00D4AA', fontSize: 15, fontWeight: '600', marginBottom: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(0,212,170,0.1)', borderRadius: 8 },
  modalLabel: { color: '#888', fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  actionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  actionOption: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  actionOptionText: { color: '#888', fontSize: 13, fontWeight: '600' },
  reasonInput: {
    backgroundColor: '#0D0D1A', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    textAlignVertical: 'top', minHeight: 80, marginBottom: 16,
  },
  confirmBtn: {
    backgroundColor: '#00D4AA', borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 8,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
