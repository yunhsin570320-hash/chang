import 'react-native-url-polyfill/auto';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { AuthProvider } from '../contexts/AuthContext';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  useFrameworkReady();

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <AuthProvider>
          <StatusBar style="light" backgroundColor="#0D1117" />
          <Stack screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0D1117' },
          }}>
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="material/[id]"
              options={{
                headerShown: true,
                headerStyle: { backgroundColor: '#161B22' },
                headerTintColor: '#E6EDF3',
                headerTitleStyle: { color: '#E6EDF3', fontWeight: '700' },
                title: '原料詳情',
              }}
            />
            <Stack.Screen
              name="product/[id]"
              options={{
                headerShown: true,
                headerStyle: { backgroundColor: '#161B22' },
                headerTintColor: '#E6EDF3',
                headerTitleStyle: { color: '#E6EDF3', fontWeight: '700' },
                title: '產品配方',
              }}
            />
            <Stack.Screen
              name="production/[id]"
              options={{
                headerShown: true,
                headerStyle: { backgroundColor: '#161B22' },
                headerTintColor: '#E6EDF3',
                headerTitleStyle: { color: '#E6EDF3', fontWeight: '700' },
                title: '生產單詳情',
              }}
            />
          </Stack>
        </AuthProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D1117' },
});
