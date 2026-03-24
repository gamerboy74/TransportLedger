import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueOfflineAction, getOfflineQueueItems } from '../lib/offlineQueue';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn(async () => ({ error: null })),
      insert: jest.fn(async () => ({ error: null })),
      update: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
      delete: jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) })),
    })),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    clear: jest.fn(async () => {
      for (const key of Object.keys(store)) delete store[key];
    }),
    getAllKeys: jest.fn(async () => Object.keys(store)),
    multiGet: jest.fn(async (keys: string[]) => keys.map((key) => [key, store[key] ?? null])),
    multiSet: jest.fn(async (entries: [string, string][]) => {
      for (const [key, value] of entries) store[key] = value;
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const key of keys) delete store[key];
    }),
  };
});

describe('Offline queue dedupe rules', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('does not dedupe create-type actions', async () => {
    const payload = { vehicle_id: 'v1', date: '2026-03-20', litres: 100 };
    await enqueueOfflineAction('addDieselLog', payload);
    await enqueueOfflineAction('addDieselLog', payload);

    const queue = await getOfflineQueueItems();
    expect(queue.filter((q) => q.type === 'addDieselLog')).toHaveLength(2);
  });

  test('dedupes idempotent update actions', async () => {
    const payload = { id: 'd1', date: '2026-03-20', litres: 150 };
    await enqueueOfflineAction('updateDieselLog', payload);
    await enqueueOfflineAction('updateDieselLog', payload);

    const queue = await getOfflineQueueItems();
    expect(queue.filter((q) => q.type === 'updateDieselLog')).toHaveLength(1);
  });
});
