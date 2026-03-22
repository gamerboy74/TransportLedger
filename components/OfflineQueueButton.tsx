import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getOfflineQueueSize, subscribeOfflineQueueEvents } from '../lib/offlineQueue';

export default function OfflineQueueButton() {
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
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#f2d7e6',
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <Ionicons name="cloud-upload-outline" size={16} color="#111111" />
      {count > 0 && (
        <View style={{ position: 'absolute', right: -4, top: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#db2777', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={{ color: 'white', fontSize: 9, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}
