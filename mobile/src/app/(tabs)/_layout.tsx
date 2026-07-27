import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { colors } from '@/constants/theme';

const icons = {
  advisor: { ios: 'bubble.left.and.text.bubble.right.fill', android: 'chat', web: 'chat' },
  us: { ios: 'person.2.fill', android: 'group', web: 'group' },
  journal: { ios: 'book.closed.fill', android: 'menu_book', web: 'menu_book' },
  me: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' },
} as const;

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="advisor"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { height: 84, paddingTop: 8, paddingBottom: 24, borderTopColor: colors.line, backgroundColor: colors.surface },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="advisor"
        options={{ title: '军师', tabBarIcon: ({ color }) => <SymbolView name={icons.advisor} tintColor={color} size={22} /> }}
      />
      <Tabs.Screen
        name="us"
        options={{ title: '我们', tabBarIcon: ({ color }) => <SymbolView name={icons.us} tintColor={color} size={22} /> }}
      />
      <Tabs.Screen
        name="journal"
        options={{ title: '日记', tabBarIcon: ({ color }) => <SymbolView name={icons.journal} tintColor={color} size={22} /> }}
      />
      <Tabs.Screen
        name="me"
        options={{ title: '我', tabBarIcon: ({ color }) => <SymbolView name={icons.me} tintColor={color} size={22} /> }}
      />
    </Tabs>
  );
}
