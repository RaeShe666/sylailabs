import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Header, Page, PrimaryButton, SecondaryButton, SectionLabel } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  createCoupleInvite,
  type CoupleInvite,
  type CoupleSpace,
  isApiConfigured,
  loadCoupleSpace,
  redeemCoupleInvite,
} from '@/lib/chirpApi';

export default function UsScreen() {
  const { user } = useAuth();
  const [space, setSpace] = useState<CoupleSpace | null>(null);
  const [invite, setInvite] = useState<CoupleInvite | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [loading, setLoading] = useState(Boolean(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    loadCoupleSpace(user.id)
      .then(setSpace)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '情侣空间读取失败。'))
      .finally(() => setLoading(false));
  }, [user]);

  async function generateInvite() {
    setBusy(true);
    setError('');
    try {
      setInvite(await createCoupleInvite());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '邀请生成失败。');
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!redeemCode.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await redeemCoupleInvite(redeemCode);
      setSpace({ planetId: result.planetId, conversationId: result.conversationId, title: '我们的空间' });
      setRedeemCode('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '邀请码使用失败。');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Page contentStyle={styles.loading}><ActivityIndicator color={colors.accent} /></Page>;
  }

  if (space) {
    return (
      <Page>
        <Header eyebrow="已经连接" title="我们" />
        <Card style={styles.connectedCard}>
          <View style={styles.people}><View style={styles.avatar}><Text style={styles.avatarText}>你</Text></View><View style={styles.connectedLink} /><View style={styles.partnerAvatar}><Text style={styles.partnerText}>TA</Text></View></View>
          <Text style={styles.title}>{space.title}</Text>
          <Text style={styles.body}>你们的群已经建立。普通聊天只属于你们；需要时再 @bird。</Text>
          <PrimaryButton onPress={() => router.push({ pathname: '/couple-chat', params: { conversationId: space.conversationId } })}>进入情侣群</PrimaryButton>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <Header eyebrow="两个人之后" title="我们" />
      <Card style={styles.heroCard}>
        <View style={styles.people}><View style={styles.avatar}><Text style={styles.avatarText}>你</Text></View><View style={styles.link} /><View style={styles.emptyAvatar}><Text style={styles.plus}>+</Text></View></View>
        <Text style={styles.title}>邀请你的伴侣</Text>
        <Text style={styles.body}>对方接受邀请并完成 onboarding 后，才会创建你们的情侣群。Bird 只在那个共同空间里出现。</Text>
        {invite ? <View style={styles.codeBox}><Text style={styles.codeLabel}>邀请口令 · 7 天内有效</Text><Text selectable style={styles.code}>{invite.code}</Text></View> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton disabled={busy || !user || !isApiConfigured} onPress={generateInvite}>{busy ? <ActivityIndicator color="#FFFFFF" /> : invite ? '重新获取邀请' : '生成邀请'}</PrimaryButton>
      </Card>

      <Card>
        <SectionLabel>已经收到邀请码？</SectionLabel>
        <TextInput
          autoCapitalize="characters"
          maxLength={10}
          onChangeText={setRedeemCode}
          placeholder="输入 10 位口令"
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          value={redeemCode}
        />
        <SecondaryButton disabled={busy || !user || redeemCode.trim().length !== 10} onPress={redeem}>加入伴侣的空间</SecondaryButton>
      </Card>

      {!user ? <Text style={styles.note}>当前是预览模式。登录后才能创建或接受邀请。</Text> : null}
      {!isApiConfigured ? <Text style={styles.note}>尚未配置后端 API 地址。</Text> : null}
      <SecondaryButton onPress={() => router.push('/couple-preview')}>预览情侣群界面</SecondaryButton>
    </Page>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', justifyContent: 'center' },
  heroCard: { backgroundColor: colors.accentSoft },
  connectedCard: { backgroundColor: colors.bird },
  people: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  avatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  partnerAvatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4F927F' },
  partnerText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  link: { width: 42, height: 2, backgroundColor: '#C9C2F7' },
  connectedLink: { width: 42, height: 2, backgroundColor: '#83B9AA' },
  emptyAvatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: '#B8AFE9' },
  plus: { color: colors.accent, fontSize: 28 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.inkMuted, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  codeBox: { alignItems: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  codeLabel: { color: colors.inkMuted, fontSize: 12 },
  code: { color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.ink, fontSize: 17, letterSpacing: 2, backgroundColor: colors.canvas },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  note: { color: colors.inkMuted, fontSize: 12, textAlign: 'center' },
});
