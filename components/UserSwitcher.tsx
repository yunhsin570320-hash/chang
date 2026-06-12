import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList } from 'react-native';
import { ChevronDown, User } from 'lucide-react-native';
import { useUser } from '@/contexts/UserContext';
import { Profile } from '@/lib/supabase';

export function UserSwitcher() {
  const { currentUser, users, setCurrentUser } = useUser();
  const [modalVisible, setModalVisible] = useState(false);

  const handleSelectUser = (user: Profile) => {
    setCurrentUser(user);
    setModalVisible(false);
  };

  const getRoleLabel = (role: string) => (role === 'seller' ? '賣家' : '買家');

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.selector}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <User size={18} color="#00D4AA" />
        <Text style={styles.userName}>{currentUser?.name || '選擇使用者'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{getRoleLabel(currentUser?.role || 'buyer')}</Text>
        </View>
        <ChevronDown size={16} color="#888" />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          onPress={() => setModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>切換使用者身份</Text>
            <FlatList
              data={users}
              keyExtractor={(item) => item.id}
              style={styles.userList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.userItem, currentUser?.id === item.id && styles.userItemActive]}
                  onPress={() => handleSelectUser(item)}
                >
                  <View style={styles.userInfo}>
                    <Text style={styles.userNameModal}>{item.name}</Text>
                    <Text style={styles.userRole}>{getRoleLabel(item.role)}</Text>
                  </View>
                  {currentUser?.id === item.id && <Text style={styles.checkmark}>V</Text>}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
              <Text style={styles.closeText}>關閉</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { zIndex: 1000 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  userName: { color: '#fff', fontSize: 14, fontWeight: '500' },
  roleBadge: {
    backgroundColor: 'rgba(0, 212, 170, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleText: { color: '#00D4AA', fontSize: 12, fontWeight: '600' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 20,
    width: '85%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  userList: { maxHeight: 200 },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  userItemActive: { borderColor: '#00D4AA', backgroundColor: 'rgba(0, 212, 170, 0.1)' },
  userInfo: { flex: 1 },
  userNameModal: { color: '#fff', fontSize: 16, fontWeight: '600' },
  userRole: { color: '#888', fontSize: 12, marginTop: 2 },
  checkmark: { color: '#00D4AA', fontSize: 16, fontWeight: '700' },
  closeButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  closeText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
