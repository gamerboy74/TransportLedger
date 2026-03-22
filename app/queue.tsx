import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { flushOfflineQueue, getOfflineQueueItems, removeOfflineQueueItem, retryOfflineQueueItem, subscribeOfflineQueueEvents } from '../lib/offlineQueue';
import { queryClient } from '../lib/queryClient';
import { useThemedNotice } from '../components/ThemedNoticeProvider';

type QueueItem = {
  id: string;
  type: string;
  createdAt: string;
  retries: number;
  status: 'pending' | 'conflict';
  lastError?: string;
};

function routeForType(type: string): string | null {
  if (type.includes('Diesel')) return '/diesel-logs';
  if (type.includes('Trip') || type.includes('Route')) return '/(tabs)/reports';
  if (type.includes('TransportOwner') || type.includes('Vehicle')) return '/(tabs)/transporters';
  if (type.includes('Payment') || type.includes('Income')) return '/(tabs)/transporters';
  return null;
}

function conflictHint(item: QueueItem): string {
  const msg = (item.lastError ?? '').toLowerCase();
  if (!msg) return 'Unknown sync error. Retry once, then open related screen to recheck values.';
  if (msg.includes('permission') || msg.includes('policy')) return 'Permission/policy blocked this write. Re-open the related screen and verify account access.';
  if (msg.includes('duplicate') || msg.includes('unique')) return 'Duplicate/unique conflict. Open related screen to confirm if this entry already exists.';
  if (msg.includes('foreign key') || msg.includes('not found')) return 'Linked record missing. Re-open related screen and recreate missing owner/vehicle first.';
  if (msg.includes('invalid') || msg.includes('format')) return 'Invalid field value format. Open related screen and correct date/number fields.';
  return 'Retry now. If it fails again, open related screen and recreate this entry manually.';
}

export default function QueueScreen() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const notice = useThemedNotice();

  const load = useCallback(async () => {
    const queue = await getOfflineQueueItems();
    setItems(queue.map((q) => ({
      id: q.id,
      type: q.type,
      createdAt: q.createdAt,
      retries: q.retries,
      status: (q.status ?? 'pending') as 'pending' | 'conflict',
      lastError: q.lastError,
    })));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    const unsub = subscribeOfflineQueueEvents(() => {
      void load();
    });
    return unsub;
  }, [load]);

  const retryNow = async () => {
    setSyncing(true);
    try {
      const { processed, remaining } = await flushOfflineQueue();
      await queryClient.invalidateQueries();
      await load();
      if (processed > 0) notice.showSuccess('Synced', `${processed} item(s) synced.`);
      else notice.showInfo('No sync', remaining ? `${remaining} item(s) still queued.` : 'Queue is already empty.');
    } catch (e) {
      notice.showError('Sync failed', String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 20 }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ color: '#db2777', fontSize: 18 }}>←</Text>
        </TouchableOpacity>
        <Text style={{ color: '#111111', fontSize: 20, fontWeight: '800' }}>Offline Queue</Text>
        <TouchableOpacity onPress={retryNow} disabled={syncing}>
          <Text style={{ color: syncing ? '#9f8b97' : '#db2777', fontWeight: '700' }}>{syncing ? 'Syncing...' : 'Retry Now'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#ec4899" />}
      >
        <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#6b5c67', fontSize: 12 }}>Pending Items</Text>
          <Text style={{ color: '#111111', fontWeight: '800', fontSize: 26 }}>{items.length}</Text>
          <Text style={{ color: '#6b5c67', fontSize: 11, marginTop: 2 }}>Queued changes will auto-sync when network is available.</Text>
        </View>

        {items.map((item) => (
          <View key={item.id} style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#111111', fontWeight: '700' }}>{item.type}</Text>
              <Text style={{ color: item.status === 'conflict' ? '#ef4444' : '#6b5c67', fontSize: 11, fontWeight: '700' }}>
                {item.status === 'conflict' ? 'CONFLICT' : 'PENDING'}
              </Text>
            </View>
            <Text style={{ color: '#6b5c67', fontSize: 11, marginTop: 2 }}>Created: {new Date(item.createdAt).toLocaleString('en-IN')}</Text>
            <Text style={{ color: '#6b5c67', fontSize: 11 }}>Retries: {item.retries}</Text>
            {!!item.lastError && <Text style={{ color: '#ef4444', fontSize: 11, marginTop: 2 }}>Last Error: {item.lastError}</Text>}
            {item.status === 'conflict' && (
              <View style={{ marginTop: 8 }}>
                <View style={{ backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <Text style={{ color: '#9a3412', fontWeight: '700', fontSize: 11 }}>Guided Fix</Text>
                  <Text style={{ color: '#7c2d12', fontSize: 11, marginTop: 2 }}>{conflictHint(item)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Retry this conflict item"
                  onPress={async () => {
                    setRetryingId(item.id);
                    const result = await retryOfflineQueueItem(item.id);
                    await queryClient.invalidateQueries();
                    await load();
                    if (!result.retried) {
                      notice.showError('Retry failed', result.message ?? 'Could not retry this item.');
                    } else if (result.status === 'processed') {
                      notice.showSuccess('Retry success', 'Conflict item synced successfully.');
                    } else {
                      notice.showInfo('Still pending', result.message ?? 'Item is still pending and will retry later.');
                    }
                    setRetryingId(null);
                  }}
                  disabled={retryingId === item.id}
                  style={{ alignSelf: 'flex-start', backgroundColor: '#fde68a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#92400e', fontWeight: '700', fontSize: 11 }}>{retryingId === item.id ? 'Retrying...' : 'Retry Item'}</Text>
                </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Remove this conflict item"
                  onPress={async () => {
                    await removeOfflineQueueItem(item.id);
                    await load();
                    notice.showInfo('Removed', 'Conflict item removed from queue.');
                  }}
                  style={{ alignSelf: 'flex-start', backgroundColor: '#fee2e2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#b91c1c', fontWeight: '700', fontSize: 11 }}>Remove Item</Text>
                </TouchableOpacity>
                  {routeForType(item.type) && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Open related screen for this conflict"
                      onPress={() => router.push(routeForType(item.type) as any)}
                      style={{ alignSelf: 'flex-start', backgroundColor: '#e0e7ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                    >
                      <Text style={{ color: '#3730a3', fontWeight: '700', fontSize: 11 }}>Open Related</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </View>
        ))}

        {!items.length && (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Text style={{ fontSize: 42 }}>☁️</Text>
            <Text style={{ color: '#111111', fontWeight: '700', marginTop: 10 }}>Queue is empty</Text>
            <Text style={{ color: '#6b5c67', marginTop: 4 }}>All pending offline writes are synced.</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
