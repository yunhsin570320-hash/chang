import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { Plus, X, Settings, UserCircle } from 'lucide-react-native';
import { supabase, callRpc } from '../../lib/supabase';
import type { Profile, ErpRole } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const C = {
  bg: '#0D1117', surface: '#161B22', border: '#30363D',
  primary: '#2F81F7', success: '#3FB950', warning: '#D29922', danger: '#F85149',
  text: '#E6EDF3', textMuted: '#8B949E',
};

const ROLES: { value: ErpRole; label: string; color: string }[] = [
  { value: 'admin',    label: '管理員', color: C.danger },
  { value: 'manager',  label: '主管',   color: C.warning },
  { value: 'operator', label: '作業員', color: C.success },
  { value: 'viewer',   label: '檢視',   color: C.textMuted },
];

export default function AdminScreen() {
  const { sessionToken, user: me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [newRole, setNewRole] = useState<ErpRole>('operator');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newModal, setNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleVal, setNewRoleVal] = useState<ErpRole>('operator');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, erp_role, is_admin, created_at')
      .order('name');
    setUsers((data ?? []) as Profile[]);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleUpdateRole = async () => {
    if (!editUser || !sessionToken) return;
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_update_role', { p_token: sessionToken, p_user_id: editUser.id, p_erp_role: newRole });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setEditUser(null);
    await load();
  };

  const handleCreateUser = async () => {
    if (!sessionToken) return;
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) { setError('請填寫所有必填欄位'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) { setError('請輸入有效的電子郵箱'); return; }
    setSaving(true); setError(null);
    const { data } = await callRpc('rpc_erp_create_user', {
      p_token: sessionToken, p_name: newName.trim(), p_email: newEmail.trim(),
      p_password_hash: newPassword, p_erp_role: newRoleVal,
    });
    setSaving(false);
    if (data?.error) { setError(data.error); return; }
    setNewModal(false); setNewName(''); setNewEmail(''); setNewPassword(''); setNewRoleVal('operator');
    await load();
  };

  const getRole = (u: Profile): ErpRole => {
    if (u.is_admin) return 'admin';
    return (u.erp_role as ErpRole) ?? 'viewer';
  };

  const roleInfo = (r: ErpRole) => ROLES.find(x => x.value === r) ?? { label: r, color: C.textMuted };

  const renderUser = ({ item: u }: { item: Profile }) => {
    const ri = roleInfo(getRole(u));
    const isMe = u.id === me?.id;
    return (
      <View style={styles.row}>
        <UserCircle size={36} color={C.textMuted} />
        <View style={styles.userInfo}>
          <View style={styles.userTop}>
            <Text style={styles.userName}>{u.name}{isMe ? ' (你)' : ''}</Text>
            <View style={[styles.badge, { backgroundColor: ri.color + '22', borderColor: ri.color + '44' }]}>
              <Text style={[styles.badgeText, { color: ri.color }]}>{ri.label}</Text>
            </View>
          </View>
          <Text style={styles.userEmail}>{u.email ?? '—'}</Text>
        </View>
        {!isMe && !u.is_admin && (
          <TouchableOpacity style={styles.editBtn} onPress={() => { setEditUser(u); setNewRole(getRole(u)); setError(null); }}>
            <Settings size={16} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>使用者管理</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => { setNewModal(true); setError(null); }}>
          <Plus size={16} color={C.primary} />
          <Text style={styles.addBtnText}>新增使用者</Text>
        </TouchableOpacity>
      </View>

      {loading
        ? <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        : <FlatList
            data={users}
            renderItem={renderUser}
            keyExtractor={u => u.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
            contentContainerStyle={styles.list}
          />
      }

      {/* Edit Role Modal */}
      <Modal visible={!!editUser} animationType="slide" transparent onRequestClose={() => setEditUser(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>變更角色 — {editUser?.name}</Text>
              <TouchableOpacity onPress={() => setEditUser(null)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <View style={styles.sheetBody}>
              <Text style={styles.label}>選擇新角色</Text>
              {ROLES.filter(r => r.value !== 'admin').map(r => (
                <TouchableOpacity
                  key={r.value}
                  style={[styles.roleOpt, newRole === r.value && { borderColor: r.color, backgroundColor: r.color + '11' }]}
                  onPress={() => setNewRole(r.value)}
                >
                  <View style={[styles.roleIcon, { backgroundColor: r.color + '22' }]}>
                    <Text style={[styles.roleIconText, { color: r.color }]}>{r.label[0]}</Text>
                  </View>
                  <View style={styles.roleBody}>
                    <Text style={[styles.roleLabel, newRole === r.value && { color: r.color }]}>{r.label}</Text>
                    <Text style={styles.roleDesc}>{roleDesc(r.value)}</Text>
                  </View>
                  {newRole === r.value && <View style={[styles.check, { backgroundColor: r.color }]} />}
                </TouchableOpacity>
              ))}
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, saving && { opacity: 0.6 }]} onPress={handleUpdateRole} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>確認變更</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create User Modal */}
      <Modal visible={newModal} animationType="slide" transparent onRequestClose={() => setNewModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHdr}>
              <Text style={styles.sheetTitle}>新增使用者</Text>
              <TouchableOpacity onPress={() => setNewModal(false)}><X size={20} color={C.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>姓名 *</Text>
              <TextInput style={styles.fieldInput} value={newName} onChangeText={setNewName} placeholder="員工姓名" placeholderTextColor={C.textMuted} />
              <Text style={styles.label}>電子郵箱 *</Text>
              <TextInput style={styles.fieldInput} value={newEmail} onChangeText={setNewEmail} placeholder="employee@company.com" placeholderTextColor={C.textMuted} keyboardType="email-address" autoCapitalize="none" />
              <Text style={styles.label}>初始密碼 *</Text>
              <TextInput style={styles.fieldInput} value={newPassword} onChangeText={setNewPassword} placeholder="初始密碼" placeholderTextColor={C.textMuted} secureTextEntry />
              <Text style={styles.label}>角色</Text>
              <View style={styles.roleRow}>
                {ROLES.filter(r => r.value !== 'admin').map(r => (
                  <TouchableOpacity
                    key={r.value}
                    style={[styles.roleChip, newRoleVal === r.value && { backgroundColor: r.color + '22', borderColor: r.color }]}
                    onPress={() => setNewRoleVal(r.value)}
                  >
                    <Text style={[styles.roleChipText, newRoleVal === r.value && { color: r.color }]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {error && <Text style={styles.errText}>{error}</Text>}
              <TouchableOpacity style={[styles.actionBtn, saving && { opacity: 0.6 }]} onPress={handleCreateUser} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>建立帳號</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function roleDesc(role: ErpRole): string {
  switch (role) {
    case 'manager':  return '可建立/編輯原料、產品配方；可檢視所有資料';
    case 'operator': return '可執行收貨、生產、出貨作業';
    case 'viewer':   return '僅可檢視所有資料，無法修改';
    default:         return '';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerText: { color: C.text, fontSize: 15, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '55', backgroundColor: C.primary + '11' },
  addBtnText: { color: C.primary, fontSize: 13, fontWeight: '600' },
  list: { paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  userInfo: { flex: 1 },
  userTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  userName: { color: C.text, fontSize: 14, fontWeight: '600' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  userEmail: { color: C.textMuted, fontSize: 12 },
  editBtn: { padding: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.border, maxHeight: '80%' },
  sheetHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  sheetBody: { padding: 20 },
  label: { color: C.textMuted, fontSize: 13, marginBottom: 8, marginTop: 4 },
  roleOpt: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginBottom: 10, gap: 12 },
  roleIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  roleIconText: { fontSize: 14, fontWeight: '700' },
  roleBody: { flex: 1 },
  roleLabel: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  roleDesc: { color: C.textMuted, fontSize: 12 },
  check: { width: 10, height: 10, borderRadius: 5 },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  roleChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  roleChipText: { color: C.textMuted, fontSize: 13, fontWeight: '600' },
  fieldInput: { backgroundColor: '#0D1117', borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15, marginBottom: 4 },
  errText: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: 'center' },
  actionBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20, marginBottom: 8 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
