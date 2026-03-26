import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import OfflineQueueButton from './OfflineQueueButton';

interface UnifiedHeaderProps {
  title?: string;
}

export default function UnifiedHeader({ title }: UnifiedHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.leftSection}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarEmoji}>👨🏽</Text>
        </View>
        {title && <Text style={styles.titleText}>{title}</Text>}
      </View>

      <View style={styles.actionsContainer}>
        <OfflineQueueButton />
        
        <Pressable 
          onPress={() => router.push('/(tabs)/entry')} 
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={18} color="#111111" />
        </Pressable>

        <Pressable 
          onPress={() => router.push('/settings')} 
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="settings-outline" size={18} color="#111111" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f2d7e6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 16,
  },
  titleText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111111',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f2d7e6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    transform: [{ scale: 0.96 }],
  },
});
