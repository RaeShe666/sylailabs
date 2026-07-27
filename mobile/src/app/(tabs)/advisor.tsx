import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Header, Page } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';

const prompts = ['帮我理一理', '我该不该发消息？', '只想吐槽一下'];

export default function AdvisorScreen() {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, text]);
    setDraft('');
  }

  return (
    <Page scroll={false} contentStyle={styles.page}>
      <Header eyebrow="只属于你" title="我的军师" action={<View style={styles.onlineDot} />} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.chat}>
        <ScrollView contentContainerStyle={styles.messages} showsVerticalScrollIndicator={false}>
          <View style={styles.advisorBubble}>
            <Text style={styles.bubbleName}>军师</Text>
            <Text style={styles.bubbleText}>我在。你可以从今天发生的一件小事说起，不用先把它想明白。</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.prompts}>
            {prompts.map((prompt) => (
              <Pressable key={prompt} onPress={() => setDraft(prompt)} style={styles.prompt}><Text style={styles.promptText}>{prompt}</Text></Pressable>
            ))}
          </ScrollView>
          {messages.map((message, index) => (
            <View key={`${message}-${index}`} style={styles.userBubble}><Text style={styles.userText}>{message}</Text></View>
          ))}
          {messages.length ? (
            <View style={styles.advisorBubble}>
              <Text style={styles.bubbleName}>军师</Text>
              <Text style={styles.bubbleText}>我收到了。下一步接入后端后，我会在这里给你真正的回应。</Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="跟军师说点什么…"
            placeholderTextColor={colors.inkMuted}
            style={styles.input}
            value={draft}
          />
          <Pressable accessibilityLabel="发送" onPress={send} style={({ pressed }) => [styles.send, pressed && styles.pressed]}>
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: spacing.md },
  onlineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#54A77A' },
  chat: { flex: 1 },
  messages: { flexGrow: 1, gap: spacing.md, paddingBottom: spacing.md },
  advisorBubble: { maxWidth: '86%', alignSelf: 'flex-start', padding: spacing.md, gap: spacing.xs, borderRadius: radius.md, borderTopLeftRadius: 5, backgroundColor: colors.surface },
  bubbleName: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  bubbleText: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  prompts: { gap: spacing.sm },
  prompt: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  promptText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  userBubble: { maxWidth: '82%', alignSelf: 'flex-end', padding: spacing.md, borderRadius: radius.md, borderTopRightRadius: 5, backgroundColor: colors.accent },
  userText: { color: '#FFFFFF', fontSize: 16, lineHeight: 23 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 110, minHeight: 44, paddingHorizontal: spacing.sm, paddingVertical: 11, color: colors.ink, fontSize: 16 },
  send: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.accent },
  sendText: { color: '#FFFFFF', fontSize: 23, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
