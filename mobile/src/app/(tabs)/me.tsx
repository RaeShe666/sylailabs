import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Header, Page, SecondaryButton, SectionLabel } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

const rows = [
  ['关系状态', '恋爱中'],
  ['希望被称呼', '还没有填写'],
  ['重要日期', '添加生日或纪念日'],
];

export default function MeScreen() {
  const { user, signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    router.replace('/sign-in');
  }

  return (
    <Page>
      <Header eyebrow="只属于你" title="About Me" />
      <Card>
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarText}>你</Text></View>
          <View style={styles.profileCopy}><Text style={styles.name}>{user?.user_metadata?.display_name || '你的名字'}</Text><Text style={styles.meta}>{user?.email || '军师正在慢慢认识你'}</Text></View>
        </View>
        <Text style={styles.privacy}>这里的信息会帮助你的私人军师理解你，不会直接提供给 Bird 或你的伴侣。</Text>
      </Card>
      <View style={styles.section}>
        <SectionLabel>基本信息</SectionLabel>
        <Card style={styles.listCard}>
          {rows.map(([label, value], index) => (
            <View key={label} style={[styles.row, index > 0 && styles.rowBorder]}>
              <Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text><Text style={styles.chevron}>›</Text>
            </View>
          ))}
        </Card>
      </View>
      <View style={styles.section}>
        <SectionLabel>连接伴侣</SectionLabel>
        <Card>
          <Text style={styles.cardTitle}>邀请入口</Text>
          <Text style={styles.body}>邀请成功前，你仍可以独立使用军师和我的日记。</Text>
          <SecondaryButton>管理邀请</SecondaryButton>
        </Card>
      </View>
      {user ? <SecondaryButton onPress={handleSignOut}>退出登录</SecondaryButton> : <SecondaryButton onPress={() => router.replace('/sign-in')}>登录以保存资料</SecondaryButton>}
    </Page>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 58, height: 58, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  avatarText: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  profileCopy: { flex: 1, gap: 4 },
  name: { color: colors.ink, fontSize: 21, fontWeight: '700' },
  meta: { color: colors.inkMuted, fontSize: 13 },
  privacy: { padding: spacing.md, borderRadius: radius.md, color: colors.inkMuted, fontSize: 13, lineHeight: 20, backgroundColor: colors.surfaceMuted },
  section: { gap: spacing.sm },
  listCard: { paddingVertical: 0, gap: 0 },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  label: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600' },
  value: { color: colors.inkMuted, fontSize: 14 },
  chevron: { color: colors.inkMuted, fontSize: 24 },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 14, lineHeight: 22 },
});
