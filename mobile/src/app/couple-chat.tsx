import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { type ChatMessage, loadConversationMessages, sendCoupleMessage, subscribeToConversation } from '@/lib/chirpApi';

const starters = ['帮我们看看', '一起做个决定', '有件事想说清楚', '矛盾调解'];

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export default function CoupleChatScreen() {
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const { user } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!conversationId) {
      setError('缺少情侣群 conversation id。');
      setLoading(false);
      return;
    }

    let active = true;
    loadConversationMessages(conversationId)
      .then((items) => { if (active) setMessages(items); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '消息读取失败。'); })
      .finally(() => { if (active) setLoading(false); });

    const unsubscribe = subscribeToConversation(conversationId, (message) => {
      if (active) setMessages((current) => mergeMessages(current, [message]));
    });
    return () => { active = false; unsubscribe(); };
  }, [conversationId]);

  const hasBirdMention = useMemo(() => /@(bird\b|小鸟|小草)/i.test(draft), [draft]);

  async function send() {
    const text = draft.trim();
    if (!conversationId || !text || sending) return;
    setDraft('');
    setSending(true);
    setError('');
    try {
      const saved = await sendCoupleMessage(conversationId, text);
      setMessages((current) => mergeMessages(current, saved));
    } catch (cause) {
      setDraft(text);
      setError(cause instanceof Error ? cause.message : '发送失败。');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="返回" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
        <View style={styles.headerCopy}><Text style={styles.title}>我们的空间</Text><Text style={styles.meta}>普通聊天不会唤醒 AI</Text></View>
        <View style={styles.birdBadge}><Text style={styles.birdText}>B</Text></View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex} keyboardVerticalOffset={8}>
        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messages}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}>
            {messages.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>从你们的第一句话开始</Text>
                <Text style={styles.emptyBody}>只有需要协助时才 @bird；其他消息只是你们两个人的对话。</Text>
                <View style={styles.starters}>{starters.map((starter) => <Pressable key={starter} onPress={() => setDraft(`@bird ${starter}`)} style={styles.starter}><Text style={styles.starterText}>{starter}</Text></Pressable>)}</View>
              </View>
            ) : null}
            {messages.map((message) => {
              const isBird = message.agentId === 'bird' || message.senderId === 'bird';
              const isMine = message.senderType === 'user' && message.senderId === user?.id;
              return (
                <View key={message.id} style={[styles.bubble, isBird ? styles.birdBubble : isMine ? styles.userBubble : styles.partnerBubble]}>
                  {isBird ? <Text style={styles.birdName}>Bird</Text> : !isMine ? <Text style={styles.partnerName}>伴侣</Text> : null}
                  <Text style={[styles.messageText, isMine && styles.userText]}>{message.text}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={[styles.composer, hasBirdMention && styles.composerBird]}>
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="发消息，或输入 @bird…"
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            value={draft}
          />
          <Pressable accessibilityLabel="发送" disabled={sending || !draft.trim()} onPress={send} style={({ pressed }) => [styles.send, (!draft.trim() || sending) && styles.disabled, pressed && styles.pressed]}>
            {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.sendText}>↑</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, backgroundColor: colors.surface },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.ink, fontSize: 36, lineHeight: 38 },
  headerCopy: { flex: 1, alignItems: 'center' },
  title: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.inkMuted, fontSize: 11 },
  birdBadge: { width: 36, height: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bird },
  birdText: { color: colors.ink, fontWeight: '800' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messages: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  empty: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyTitle: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  emptyBody: { maxWidth: 300, color: colors.inkMuted, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  starters: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  starter: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  starterText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  bubble: { maxWidth: '82%', padding: spacing.md, gap: 4, borderRadius: radius.md },
  partnerBubble: { alignSelf: 'flex-start', borderTopLeftRadius: 5, backgroundColor: colors.surface },
  userBubble: { alignSelf: 'flex-end', borderTopRightRadius: 5, backgroundColor: colors.accent },
  birdBubble: { alignSelf: 'flex-start', borderTopLeftRadius: 5, backgroundColor: colors.bird },
  partnerName: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  birdName: { color: '#337D6C', fontSize: 11, fontWeight: '800' },
  messageText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  userText: { color: '#FFFFFF' },
  error: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs, color: colors.danger, fontSize: 12, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, margin: spacing.md, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  composerBird: { borderColor: '#83B9AA', backgroundColor: '#F4FCF9' },
  input: { flex: 1, minHeight: 44, maxHeight: 110, paddingHorizontal: spacing.sm, paddingVertical: 11, color: colors.ink, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  sendText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
