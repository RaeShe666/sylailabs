import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Chip, Page, PrimaryButton, SectionLabel } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';

const relationshipOptions = ['恋爱中', '已婚', '暧昧中', '想先自己用'];

export default function OnboardingScreen() {
  const [nickname, setNickname] = useState('');
  const [relationship, setRelationship] = useState('恋爱中');

  return (
    <Page>
      <View style={styles.progressRow}>
        <Text style={styles.step}>认识你 · 1 / 3</Text>
        <View style={styles.progressTrack}><View style={styles.progressValue} /></View>
      </View>
      <View style={styles.hero}>
        <Text style={styles.title}>让军师先认识你一点</Text>
        <Text style={styles.subtitle}>只问最必要的。其他信息可以跳过，之后在 About Me 里补。</Text>
      </View>
      <Card>
        <SectionLabel>希望我们怎么称呼你？</SectionLabel>
        <TextInput
          maxLength={24}
          onChangeText={setNickname}
          placeholder="昵称"
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          value={nickname}
        />
        <SectionLabel>你现在的关系状态</SectionLabel>
        <View style={styles.chips}>
          {relationshipOptions.map((option) => (
            <Chip key={option} onPress={() => setRelationship(option)} selected={relationship === option}>
              {option}
            </Chip>
          ))}
        </View>
      </Card>
      <View style={styles.footer}>
        <Text style={styles.privacy}>这些信息先只给你的军师。Bird 不会读取你的 About Me。</Text>
        <PrimaryButton onPress={() => router.replace('/(tabs)/advisor')}>认识我的军师</PrimaryButton>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  progressRow: { gap: spacing.sm },
  step: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  progressTrack: { height: 5, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.line },
  progressValue: { width: '34%', height: '100%', backgroundColor: colors.accent },
  hero: { gap: spacing.sm, marginTop: spacing.lg },
  title: { color: colors.ink, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.9 },
  subtitle: { color: colors.inkMuted, fontSize: 16, lineHeight: 24 },
  input: { minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, color: colors.ink, fontSize: 16, backgroundColor: colors.canvas },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footer: { marginTop: 'auto', gap: spacing.md },
  privacy: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
});
