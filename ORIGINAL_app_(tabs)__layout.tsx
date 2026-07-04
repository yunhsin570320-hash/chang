import { Tabs, useRouter } from 'expo-router';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import {
  LayoutDashboard, Package, Factory, Beaker, Truck, Settings,
} from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';

const ERP_ROLE_LABELS: Record<string, string> = {
  admin: '管理員',
  manager: '主管',
  operator: '作業員',
  viewer: '檢視',
};

const ERP_ROLE_COLORS: Record<string, string> = {
  admin: '#F85149',
  manager: '#D29922',
  operator: '#3FB950',
  viewer: '#8B949E',
};

export default function TabLayout() {
  const { user, erpRole, isLoading, isAdmin, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 60 + (Platform.OS !== 'web' ? insets.bottom : 0);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/auth' as any);
    }
  }, [isLoading, user]);

  if (!isLoading && !user) return null;

  const roleLabel = ERP_ROLE_LABELS[erpRole] ?? erpRole;
  const roleColor = ERP_ROLE_COLORS[erpRole] ?? '#8B949E';

  const Header = () => (
    <View style={styles.headerRight}>
      <View style={styles.userInfo}>
        <Text style={styles.userName} numberOfLines={1}>{user?.name}</Text>
        <View style={[styles.roleBadge, { backgroundColor: roleColor + '22', borderColor: roleColor + '55' }]}>
          <Text style={[styles.roleText, { color: roleColor }]}>{roleLabel}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>登出</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: '#E6EDF3',
        headerTitleStyle: styles.headerTitle,
        tabBarStyle: [styles.tabBar, { height: tabBarHeight, paddingBottom: Platform.OS !== 'web' ? insets.bottom : 8 }],
        tabBarActiveTintColor: '#2F81F7',
        tabBarInactiveTintColor: '#6E7681',
        headerRight: () => <Header />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '儀表板',
          tabBarIcon: ({ size, color }) => <LayoutDashboard size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="direct"
        options={{
          title: '原料管理',
          tabBarIcon: ({ size, color }) => <Package size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="seller"
        options={{
          title: '生產作業',
          tabBarIcon: ({ size, color }) => <Factory size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '成品管理',
          tabBarIcon: ({ size, color }) => <Beaker size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shipping"
        options={{
          title: '出貨管理',
          tabBarIcon: ({ size, color }) => <Truck size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: '系統管理',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ size, color }) => <Settings size={size} color={color} />,
          tabBarItemStyle: isAdmin ? undefined : { display: 'none' },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#161B22',
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
    elevation: 0,
  },
  headerTitle: { color: '#E6EDF3', fontSize: 17, fontWeight: '700' },
  tabBar: {
    backgroundColor: '#161B22',
    borderTopWidth: 1,
    borderTopColor: '#30363D',
    paddingTop: 6,
  },
  headerRight: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingRight: 16,
  },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userName: { color: '#E6EDF3', fontSize: 14, maxWidth: 100 },
  roleBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 4, borderWidth: 1,
  },
  roleText: { fontSize: 11, fontWeight: '600' },
  logoutBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(248,81,73,0.12)',
    borderWidth: 1, borderColor: 'rgba(248,81,73,0.3)',
  },
  logoutText: { color: '#F85149', fontSize: 12, fontWeight: '600' },
});
