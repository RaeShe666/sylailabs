import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Page, PrimaryButton, SecondaryButton } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

export default function SignInScreen() {
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit() {
    setError('');
    setNotice('');
    if (!email.trim() || password.length < 6) {
      setError('请输入邮箱和至少 6 位密码。');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await signIn(email.trim(), password);
        router.replace('/(tabs)/advisor');
      } else {
        const result = await signUp(email.trim(), password, displayName);
        if (result.session) router.replace('/onboarding');
        else setNotice('账号已创建，请先到邮箱完成确认。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page contentStyle={styles.page}>
      <View style={styles.brand}>
        <View style={styles.mark}><Text style={styles.markText}>C</Text></View>
        <Text style={styles.brandName}>Chirp</Text>
      </View>
      <View style={styles.hero}>
        <Text style={styles.title}>先照顾好你，{`\n`}再一起照顾关系。</Text>
        <Text style={styles.subtitle}>你的私人军师只属于你。连接伴侣后，你们会拥有一个共同的 Bird。</Text>
      </View>
      <Card>
        <View style={styles.modeRow}>
          <Pressable onPress={() => setMode('sign-in')} style={[styles.mode, mode === 'sign-in' && styles.modeActive]}><Text style={[styles.modeText, mode === 'sign-in' && styles.modeTextActive]}>登录</Text></Pressable>
          <Pressable onPress={() => setMode('sign-up')} style={[styles.mode, mode === 'sign-up' && styles.modeActive]}><Text style={[styles.modeText, mode === 'sign-up' && styles.modeTextActive]}>注册</Text></Pressable>
        </View>
        {mode === 'sign-up' ? (
          <>
            <Text style={styles.label}>怎么称呼你</Text>
            <TextInput onChangeText={setDisplayName} placeholder="昵称（可稍后填写）" placeholderTextColor={colors.inkMuted} style={styles.input} value={displayName} />
          </>
        ) : null}
        <Text style={styles.label}>邮箱</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          value={email}
        />
        <Text style={styles.label}>密码</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          onChangeText={setPassword}
          placeholder="至少 6 位"
          placeholderTextColor={colors.inkMuted}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {!configured ? <Text style={styles.error}>尚未配置 Supabase，当前只能预览界面。</Text> : null}
        <PrimaryButton disabled={busy || !configured} onPress={submit}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : mode === 'sign-in' ? '登录' : '创建账号'}
        </PrimaryButton>
        <SecondaryButton onPress={() => router.push('/onboarding')}>先预览产品</SecondaryButton>
        <Text style={styles.prototype}>登录使用 Supabase Auth；模型密钥不会进入 App。</Text>
      </Card>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  markText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  brandName: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  hero: { gap: spacing.md, marginVertical: spacing.xl },
  title: { color: colors.ink, fontSize: 38, lineHeight: 46, fontWeight: '700', letterSpacing: -1.2 },
  subtitle: { color: colors.inkMuted, fontSize: 16, lineHeight: 25 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  modeRow: { flexDirection: 'row', padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  mode: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  modeActive: { backgroundColor: colors.surface },
  modeText: { color: colors.inkMuted, fontSize: 14, fontWeight: '600' },
  modeTextActive: { color: colors.ink },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.ink, fontSize: 16, backgroundColor: colors.canvas },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  notice: { color: '#337D6C', fontSize: 13, lineHeight: 19 },
  prototype: { color: colors.inkMuted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
