import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ArrowLeft, Send } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { callRpc, DMMessage } from '../../lib/supabase';

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { sessionToken, user } = useAuth();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [otherUserName, setOtherUserName] = useState<string>('');
  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    if (!sessionToken || !id) return;
    try {
      const { data, error } = await callRpc<DMMessage[]>('rpc_get_conversation_messages', {
        p_token: sessionToken,
        p_conversation_id: id,
      });
      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.warn('fetchMessages error:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, id]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useFocusEffect(
    useCallback(() => {
      if (messages.length > 0) {
        fetchMessages();
      }
    }, [fetchMessages])
  );

  const scrollToBottom = () => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 80);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || !sessionToken || !id || sending) return;

    setInput('');
    setSending(true);

    const tempMsg: DMMessage = {
      id: `temp-${Date.now()}`,
      sender_id: user?.id || '',
      content,
      is_read: false,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const { error } = await callRpc('rpc_send_chat_message', {
        p_token: sessionToken,
        p_conversation_id: id,
        p_content: content,
      });
      if (error) {
        setMessages(prev => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            sender_id: 'system',
            content: `發送失敗：${error.message}`,
            is_read: true,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender_id: 'system',
          content: '發送失敗，請稍後再試',
          is_read: true,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: DMMessage }) => {
    const isMe = item.sender_id === user?.id;
    const isSystem = item.sender_id === 'system';
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        <View
          style={[
            styles.msgBubble,
            isMe ? styles.myBubble : isSystem ? styles.systemBubble : styles.otherBubble,
          ]}
        >
          <Text
            style={[
              styles.msgText,
              isMe ? styles.myText : isSystem ? styles.systemText : styles.otherText,
            ]}
          >
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ArrowLeft size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>載入中...</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.loadingBody}>
          <ActivityIndicator size="large" color="#00D4AA" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {otherUserName || '對話'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>尚無訊息，發送第一則訊息開始對話</Text>
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.inputBar, { paddingBottom: insets.bottom || 12 }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="輸入訊息..."
            placeholderTextColor="#666"
            multiline
            maxLength={2000}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Send size={18} color={input.trim() ? '#000' : '#666'} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 212, 170, 0.15)',
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  loadingBody: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    maxWidth: '100%',
  },
  msgRowMe: { justifyContent: 'flex-end' },
  msgBubble: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '78%',
  },
  myBubble: {
    backgroundColor: 'rgba(0, 212, 170, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  otherBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  systemBubble: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
  },
  msgText: { fontSize: 15, lineHeight: 21 },
  myText: { color: '#00D4AA' },
  otherText: { color: '#e0e0e0' },
  systemText: { color: '#FF6B6B', fontSize: 13 },
  emptyContainer: { alignItems: 'center', paddingVertical: 80, gap: 8 },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 212, 170, 0.15)',
    backgroundColor: '#12121F',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
    minHeight: 42,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#00D4AA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
});
