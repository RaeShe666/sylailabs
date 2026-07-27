import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/constants/theme';

const starters = ['帮我们看看', '一起做个决定', '有件事想说清楚', '矛盾调解'];

export default function CouplePreviewScreen() {
  const [draft, setDraft] = useState('');

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="返回" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
        <View style={styles.headerCopy}><Text style={styles.title}>我们的空间</Text><Text style={styles.meta}>你、伴侣和 Bird</Text></View>
        <View style={styles.birdBadge}><Text style={styles.birdText}>B</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.messages}>
        <View style={styles.notice}><Text style={styles.noticeText}>这是连接伴侣后的界面预览。普通聊天不会触发 AI。</Text></View>
        <View style={styles.partnerBubble}><Text style={styles.partnerName}>伴侣</Text><Text style={styles.message}>周末要不要一起安排一下？</Text></View>
        <View style={styles.userBubble}><Text style={styles.userMessage}>可以，我想去一个安静点的地方。</Text></View>
        <View style={styles.birdBubble}><Text style={styles.birdName}>Bird</Text><Text style={styles.message}>只有你们 @bird 或回复我时，我才会加入。</Text></View>
        <Text style={styles.promptTitle}>需要 Bird 时，可以从这里开始</Text>
        <View style={styles.starters}>{starters.map((starter) => <Pressable key={starter} onPress={() => setDraft(`@bird ${starter}`)} style={styles.starter}><Text style={styles.starterText}>{starter}</Text></Pressable>)}</View>
      </ScrollView>
      <View style={styles.composer}>
        <TextInput onChangeText={setDraft} placeholder="发消息，或输入 @bird…" placeholderTextColor={colors.inkMuted} style={styles.input} value={draft} />
        <Pressable accessibilityLabel="发送" style={styles.send}><Text style={styles.sendText}>↑</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, backgroundColor: colors.surface },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.ink, fontSize: 36, lineHeight: 38 },
  headerCopy: { flex: 1, alignItems: 'center' },
  title: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  meta: { color: colors.inkMuted, fontSize: 11 },
  birdBadge: { width: 36, height: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bird },
  birdText: { color: colors.ink, fontWeight: '800' },
  messages: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  notice: { alignSelf: 'center', maxWidth: '88%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  noticeText: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  partnerBubble: { maxWidth: '78%', alignSelf: 'flex-start', padding: spacing.md, gap: 4, borderRadius: radius.md, borderTopLeftRadius: 5, backgroundColor: colors.surface },
  partnerName: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  userBubble: { maxWidth: '78%', alignSelf: 'flex-end', padding: spacing.md, borderRadius: radius.md, borderTopRightRadius: 5, backgroundColor: colors.accent },
  userMessage: { color: '#FFFFFF', fontSize: 15, lineHeight: 22 },
  birdBubble: { maxWidth: '82%', alignSelf: 'flex-start', padding: spacing.md, gap: 4, borderRadius: radius.md, borderTopLeftRadius: 5, backgroundColor: colors.bird },
  birdName: { color: '#337D6C', fontSize: 11, fontWeight: '800' },
  message: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  promptTitle: { marginTop: spacing.sm, color: colors.inkMuted, fontSize: 12, textAlign: 'center' },
  starters: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  starter: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  starterText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 46, paddingHorizontal: spacing.md, borderRadius: radius.pill, color: colors.ink, backgroundColor: colors.surfaceMuted },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  sendText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
});
