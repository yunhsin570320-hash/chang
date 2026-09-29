import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { MessageCircle, Send, Package } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { callRpc, DMConversation, getUnreadMessageCount } from '../../lib/supabase';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  if (hours < 24) return `${hours} 小時前`;
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

export default function MessagesTab() {
  const { sessionToken, user } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  const fetchConversations = useCallback(async (silent = false) => {
    if (!sessionToken) return;
    if (!silent) setLoading(true);
    try {
      const { data, error } = await callRpc<DMConversation[]>('rpc_get_conversations', {
        p_token: sessionToken,
      });
      if (error) throw error;
      setConversations(data || []);
      hasLoadedRef.current = true;
    } catch (err) {
      console.warn('fetchConversations error:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    fetchConversations(false);
  }, [fetchConversations]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedRef.current) {
        fetchConversations(true);
      }
    }, [fetchConversations])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchConversations(true);
    setRefreshing(false);
  };

  const renderConversation = ({ item }: { item: DMConversation }) => {
    const isLastFromMe = item.last_sender_id === user?.id;
    return (
      <TouchableOpacity
        style={styles.convCard}
        onPress={() => router.push(`/conversation/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.convAvatar}>
          <MessageCircle size={22} color="#00D4AA" />
        </View>
        <View style={styles.convBody}>
          <View style={styles.convHeader}>
            <Text style={styles.convName} numberOfLines={1}>
              {item.other_user_name}
            </Text>
            {item.last_message_at && (
              <Text style={styles.convTime}>{formatTime(item.last_message_at)}</Text>
            )}
          </View>
          <View style={styles.convPreviewRow}>
            <Text style={styles.convPreview} numberOfLines={1}>
              {isLastFromMe ? '您：' : ''}
              {item.last_message || '開始對話'}
            </Text>
            {item.unread_count > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {item.unread_count > 99 ? '99+' : item.unread_count}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00D4AA" />
          <Text style={styles.loadingText}>載入訊息中...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>訊息</Text>
        <Text style={styles.headerSubtitle}>
          與買家 / 賣家的對話記錄
        </Text>
      </View>

      <FlatList
        data={conversations}
        renderItem={renderConversation}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00D4AA"
            colors={['#00D4AA']}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Send size={48} color="#333" />
            <Text style={styles.emptyText}>目前沒有對話</Text>
            <Text style={styles.emptyHint}>
              在商品頁面點擊「聯繫賣家」即可開始對話
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#888', fontSize: 14 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 212, 170, 0.1)',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: '#888' },
  list: { padding: 16, paddingBottom: 100 },
  convCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1A1A2E',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  convAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 212, 170, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  convBody: { flex: 1, minWidth: 0 },
  convHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  convName: { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1, marginRight: 8 },
  convTime: { fontSize: 11, color: '#555', flexShrink: 0 },
  convPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  convPreview: { fontSize: 13, color: '#888', flex: 1 },
  unreadBadge: {
    backgroundColor: '#00D4AA',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    flexShrink: 0,
  },
  unreadText: { color: '#000', fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { color: '#666', fontSize: 15 },
  emptyHint: { color: '#444', fontSize: 12, textAlign: 'center', paddingHorizontal: 30, lineHeight: 18 },
});
