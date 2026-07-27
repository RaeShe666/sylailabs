import { StyleSheet, Switch, Text, View } from 'react-native';

import { Card, Header, Page, SecondaryButton } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';

export default function JournalScreen() {
  return (
    <Page>
      <Header eyebrow="你决定谁能读" title="日记" />
      <Card style={styles.personalCard}>
        <View style={styles.row}>
          <View style={styles.icon}><Text style={styles.iconText}>私</Text></View>
          <View style={styles.copy}><Text style={styles.title}>我的日记</Text><Text style={styles.meta}>仅你可见 · 0 篇</Text></View>
        </View>
        <Text style={styles.body}>写下还不想告诉任何人的事。默认情况下，军师也看不到。</Text>
        <View style={styles.setting}><View style={styles.copy}><Text style={styles.settingTitle}>允许我的军师读这本</Text><Text style={styles.meta}>默认关闭</Text></View><Switch disabled trackColor={{ false: colors.line }} value={false} /></View>
        <SecondaryButton>写第一篇</SecondaryButton>
      </Card>
      <Card style={styles.sharedCard}>
        <View style={styles.row}>
          <View style={[styles.icon, styles.sharedIcon]}><Text style={styles.iconText}>双</Text></View>
          <View style={styles.copy}><Text style={styles.title}>我们的故事</Text><Text style={styles.meta}>连接伴侣后解锁</Text></View>
        </View>
        <Text style={styles.body}>一起保存旅行、约定和那些值得记住的小事。Bird 不读取日记。</Text>
      </Card>
      <SecondaryButton>＋ 新建日记本</SecondaryButton>
      <Text style={styles.note}>日记数据与 AI 授权将在 MVP 切片 3 接入。</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  personalCard: { borderTopWidth: 4, borderTopColor: colors.accent },
  sharedCard: { opacity: 0.72 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  sharedIcon: { backgroundColor: colors.bird },
  iconText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  copy: { flex: 1, gap: 3 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  meta: { color: colors.inkMuted, fontSize: 12 },
  body: { color: colors.inkMuted, fontSize: 14, lineHeight: 22 },
  setting: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  settingTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  note: { color: colors.inkMuted, fontSize: 12, textAlign: 'center' },
});
