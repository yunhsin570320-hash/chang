import { useState, useRef, useEffect, useCallback } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send, Bot, User as UserIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { callRpc, ChatMessage, sendChatMessage } from '../lib/supabase';

const SUGGESTIONS = [
  '如何成為付費會員？',
  '如何參與競標？',
  '商品售出後怎麼辦？',
  '如何上架商品？',
  '帳號被鎖定怎麼辦？',
];

export default function ChatScreen() {
  const router = useRouter();
  const { id: existingThreadId } = useLocalSearchParams<{ id?: string }>();
  const { sessionToken } = useAuth();
  const insets = useSafeAreaInsets();

  const [threadId, setThreadId] = useState<string | null>(existingThreadId || null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(!existingThreadId);
  const flatListRef = useRef<FlatList>(null);

  const initThread = useCallback(async () => {
    if (!sessionToken) return;
    if (existingThreadId) {
      setThreadId(existingThreadId);
      const { data } = await callRpc<ChatMessage[]>('rpc_get_chat_messages', {
        p_token: sessionToken,
        p_thread_id: existingThreadId,
      });
      setMessages(data || []);
      setLoading(false);
      return;
    }
    // Start a new thread
    const { data, error } = await callRpc<{ id: string }>('rpc_start_chat_thread', {
      p_token: sessionToken,
    });
    if (error || !data?.id) {
      setLoading(false);
      return;
    }
    setThreadId(data.id);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: '您好！我是平台 AI 客服助手，可以協助解答關於競標、直購、會員升級、保證金、交付流程、申訴等問題。請問有什麼可以幫您的嗎？',
        created_at: new Date().toISOString(),
      },
    ]);
    setLoading(false);
  }, [sessionToken, existingThreadId]);

  useEffect(() => {
    initThread();
  }, [initThread]);

  const scrollToBottom = () => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || !sessionToken || !threadId || sending) return;

    setInput('');
    setSending(true);

    // Optimistic: show user message immediately
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    const result = await sendChatMessage(sessionToken, threadId, content);

    if (result.error) {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: result.error || '發生錯誤，請稍後再試',
          created_at: new Date().toISOString(),
        },
      ]);
    } else if (result.reply) {
      const reply: string = result.reply;
      setMessages(prev => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: reply,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    setSending(false);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser && (
          <View style={styles.avatarBot}>
            <Bot size={16} color="#00D4AA" />
          </View>
        )}
        <View style={[styles.msgBubble, isUser ? styles.userBubble : styles.aiBubble]}>
          <Text style={[styles.msgText, isUser ? styles.userText : styles.aiText]}>
            {item.content}
          </Text>
        </View>
        {isUser && (
          <View style={styles.avatarUser}>
            <UserIcon size={16} color="#FFD700" />
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00D4AA" />
        <Text style={styles.loadingText}>正在初始化客服對話...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Bot size={20} color="#00D4AA" />
          <Text style={styles.headerTitle}>AI 客服</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Bot size={48} color="#333" />
            <Text style={styles.emptyText}>開始與 AI 客服對話</Text>
          </View>
        }
        ListFooterComponent={
          sending ? (
            <View style={styles.typingRow}>
              <View style={styles.avatarBot}>
                <Bot size={16} color="#00D4AA" />
              </View>
              <View style={[styles.msgBubble, styles.aiBubble]}>
                <ActivityIndicator size="small" color="#00D4AA" />
              </View>
            </View>
          ) : null
        }
      />

      {/* Suggestions (show when few messages) */}
      {messages.length <= 1 && !sending && (
        <View style={styles.suggestionsContainer}>
          <Text style={styles.suggestionsTitle}>常見問題</Text>
          {SUGGESTIONS.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={styles.suggestionChip}
              onPress={() => handleSend(s)}
            >
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={[styles.inputBar, { paddingBottom: insets.bottom || 12 }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="輸入您的問題..."
            placeholderTextColor="#666"
            multiline
            maxLength={5000}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => handleSend()}
            disabled={!input.trim() || sending}
          >
            <Send size={18} color={(!input.trim() || sending) ? '#666' : '#000'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D1A',
    gap: 12,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 212, 170, 0.15)',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    maxWidth: '100%',
  },
  msgRowUser: {
    justifyContent: 'flex-end',
  },
  avatarBot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0, 212, 170, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  avatarUser: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  msgBubble: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '78%',
  },
  aiBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.15)',
  },
  userBubble: {
    backgroundColor: 'rgba(0, 212, 170, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  msgText: {
    fontSize: 15,
    lineHeight: 21,
  },
  aiText: {
    color: '#e0e0e0',
  },
  userText: {
    color: '#00D4AA',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
  },
  suggestionsContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  suggestionsTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  suggestionChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestionText: {
    color: '#aaa',
    fontSize: 14,
  },
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
  sendBtnDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 60,
  },
  emptyText: {
    color: '#555',
    fontSize: 15,
  },
});
