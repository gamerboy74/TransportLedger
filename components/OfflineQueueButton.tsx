import { useEffect, useState, memo } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getOfflineQueueSize, subscribeOfflineQueueEvents } from '../lib/offlineQueue';
import { Theme } from '../constants/theme';

function OfflineQueueButtonComponent() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const size = await getOfflineQueueSize();
      if (mounted) setCount(size);
    };

    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    const unsub = subscribeOfflineQueueEvents((event) => {
      if (event.type === 'queued') setCount(event.queueSize);
      if (event.type === 'flushed') setCount(event.remaining);
    });

    return () => {
      mounted = false;
      clearInterval(timer);
      unsub();
    };
  }, []);

  return (
    <Pressable
      onPress={() => router.push('/queue' as any)}
      style={({ pressed }) => [
        styles.container,
        { transform: [{ scale: pressed ? 0.96 : 1 }] },
      ]}
      accessibilityLabel={`Offline queue with ${count} items`}
    >
      <Ionicons name="cloud-upload-outline" size={16} color={Theme.colors.light.text} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

export default memo(OfflineQueueButtonComponent);

const styles = StyleSheet.create({
  container: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Theme.colors.light.background,
    borderWidth: 1,
    borderColor: Theme.colors.light.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -4,
    top: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Theme.colors.light.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: 'white',
    fontSize: 9,
    fontWeight: Theme.typography.weights.bold,
  },
});
