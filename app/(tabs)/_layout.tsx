import { Tabs, useRouter, usePathname } from 'expo-router';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { Home, Store, User, Crown, ChevronDown, ShieldCheck, ShoppingCart } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';

export default function TabLayout() {
  const { user, currentRole, switchRole, logout, canSwitchRoles, isLoading, isAdmin } = useAuth();
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 60 + (Platform.OS !== 'web' ? insets.bottom : 0);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/auth' as any);
    }
  }, [isLoading, user, router]);

  // Don't block rendering — let product fetch start immediately in parallel with auth
  if (!isLoading && !user) {
    return null;
  }

  const getRoleLabel = () => {
    if (currentRole === 'seller') return '賣家';
    return '買家';
  };

  const RoleSwitcher = () => {
    return (
      <View style={styles.switchContainer}>
        <TouchableOpacity
          style={styles.selector}
          onPress={() => {
            if (canSwitchRoles()) {
              setRoleModalVisible(true);
            }
          }}
          activeOpacity={0.7}
          disabled={!canSwitchRoles()}
        >
          <User size={18} color="#00D4AA" />
          <Text style={styles.userName}>{user?.name}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{getRoleLabel()}</Text>
          </View>
          {canSwitchRoles() && <ChevronDown size={16} color="#888" />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={logout}
        >
          <Text style={styles.logoutText}>登出</Text>
        </TouchableOpacity>

        {canSwitchRoles() && (
          <Modal
            visible={roleModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setRoleModalVisible(false)}
          >
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setRoleModalVisible(false)}
            >
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>切換身份</Text>
                <Text style={styles.modalSubtitle}>您的帳戶同時擁有買家與賣家身份</Text>

                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    currentRole === 'buyer' && styles.roleOptionActive
                  ]}
                  onPress={() => {
                    switchRole('buyer');
                    setRoleModalVisible(false);
                  }}
                >
                  <User size={24} color={currentRole === 'buyer' ? '#00D4AA' : '#888'} />
                  <View style={styles.roleOptionContent}>
                    <Text style={[
                      styles.roleOptionText,
                      currentRole === 'buyer' && styles.roleOptionTextActive
                    ]}>
                      買家模式
                    </Text>
                    <Text style={styles.roleOptionHint}>瀏覽商品、參與競標</Text>
                  </View>
                  {currentRole === 'buyer' && <View style={styles.checkMark} />}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    currentRole === 'seller' && styles.roleOptionActive
                  ]}
                  onPress={() => {
                    switchRole('seller');
                    setRoleModalVisible(false);
                  }}
                >
                  <Crown size={24} color={currentRole === 'seller' ? '#FFD700' : '#888'} />
                  <View style={styles.roleOptionContent}>
                    <Text style={[
                      styles.roleOptionText,
                      currentRole === 'seller' && styles.roleOptionTextActiveSeller
                    ]}>
                      賣家模式
                    </Text>
                    <Text style={styles.roleOptionHint}>上架商品、管理競標</Text>
                  </View>
                  {currentRole === 'seller' && <View style={[styles.checkMark, { backgroundColor: '#FFD700' }]} />}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>
        )}
      </View>
    );
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: '#fff',
        headerTitleStyle: styles.headerTitle,
        tabBarStyle: [styles.tabBar, { height: tabBarHeight, paddingBottom: Platform.OS !== 'web' ? insets.bottom : 8 }],
        tabBarActiveTintColor: '#00D4AA',
        tabBarInactiveTintColor: '#666',
        headerRight: () => <RoleSwitcher />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '競價廳',
          tabBarIcon: ({ size, color }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="direct"
        options={{
          title: '直購廳',
          tabBarIcon: ({ size, color }) => <ShoppingCart size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="seller"
        options={{
          title: '賣家後台',
          tabBarIcon: ({ size, color }) => <Store size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ size, color }) => <User size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: '管理後台',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ size, color }) => <ShieldCheck size={size} color={color} />,
          tabBarItemStyle: isAdmin ? undefined : { display: 'none' },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D1A',
  },
  loadingText: {
    color: '#00D4AA',
    marginTop: 12,
    fontSize: 16,
  },
  header: {
    backgroundColor: '#0D0D1A',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 212, 170, 0.2)',
    elevation: 0,
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  tabBar: {
    backgroundColor: '#0D0D1A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 212, 170, 0.2)',
    paddingTop: 8,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 1000,
  },
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
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
  },
  logoutText: { color: '#FF6B6B', fontSize: 12, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  modalSubtitle: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  roleOptionActive: { borderColor: '#00D4AA', backgroundColor: 'rgba(0, 212, 170, 0.1)' },
  roleOptionContent: { flex: 1, marginLeft: 12 },
  roleOptionText: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  roleOptionTextActive: { color: '#00D4AA' },
  roleOptionTextActiveSeller: { color: '#FFD700' },
  roleOptionHint: { color: '#888', fontSize: 12 },
  checkMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#00D4AA',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
});
