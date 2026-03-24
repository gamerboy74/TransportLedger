import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getActivityHistory, type ActivityEvent } from '../lib/activityHistory';

export default function ActivityHistoryScreen() {
  const [history, setHistory] = useState<ActivityEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await getActivityHistory(120);
    setHistory(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.back()}
          style={s.iconBtn}
        >
          <Ionicons name="chevron-back" size={18} color="#111111" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Activity History</Text>
        <View style={s.iconBtnPlaceholder} />
      </View>

      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ec4899" />}
        showsVerticalScrollIndicator={false}
      >
        {history.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>No local activity yet</Text>
            <Text style={s.emptySub}>Actions like edit, delete, and restore will appear here.</Text>
          </View>
        ) : (
          <View style={s.card}>
            {history.map((h) => (
              <View key={h.id} style={s.row}>
                <Text style={s.title} numberOfLines={1}>{h.entity} · {h.action}</Text>
                <Text style={s.sub} numberOfLines={2}>{h.label}{h.details ? ` · ${h.details}` : ''}</Text>
                <Text style={s.time}>{new Date(h.at).toLocaleString('en-IN')}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 22 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff7fb' },
  scroll: { flex: 1, paddingHorizontal: 16 },

  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#111111', fontSize: 20, fontWeight: '800' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center' },
  iconBtnPlaceholder: { width: 36, height: 36 },

  card: { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 16, paddingHorizontal: 14 },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f2d7e6' },
  title: { color: '#111111', fontWeight: '800' },
  sub: { color: '#6b5c67', fontSize: 12, marginTop: 2 },
  time: { color: '#8d7a86', fontSize: 11, marginTop: 4 },

  emptyCard: { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 16 },
  emptyTitle: { color: '#111111', fontWeight: '800' },
  emptySub: { color: '#6b5c67', marginTop: 4 },
});
