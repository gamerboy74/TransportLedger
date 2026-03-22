import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function Icon({ name, label, focused }: { name: keyof typeof Ionicons.glyphMap; label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 4, opacity: focused ? 1 : 0.86, width: 72 }}>
      <Ionicons name={name} size={22} color={focused ? '#111111' : '#8d8289'} />
      <Text
        numberOfLines={1}
        style={{
          fontSize: 11,
          marginTop: 3,
          fontWeight: focused ? '700' : '600',
          color: focused ? '#111111' : '#8d8289',
          width: 72,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: '#ffffff',
        borderTopColor: '#f2d7e6',
        height: 72,
        paddingBottom: 10,
        paddingTop: 6,
      },
      tabBarShowLabel: false,
      tabBarItemStyle: {
        paddingHorizontal: 0,
      },
    }}>
      <Tabs.Screen name="index"        options={{ tabBarIcon: ({ focused }) => <Icon name="home"        label="Home"    focused={focused} /> }} />
      <Tabs.Screen name="transporters" options={{ tabBarIcon: ({ focused }) => <Icon name="people"      label="Owners"  focused={focused} /> }} />
      <Tabs.Screen name="entry"        options={{ tabBarIcon: ({ focused }) => <Icon name="wallet"      label="Entry"   focused={focused} /> }} />
      <Tabs.Screen name="reports"      options={{ tabBarIcon: ({ focused }) => <Icon name="stats-chart" label="Reports" focused={focused} /> }} />
    </Tabs>
  );
}