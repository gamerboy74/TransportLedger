import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendActivityEvent, getActivityHistory } from '../lib/activityHistory';

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

describe('Activity history', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('stores newest event first', async () => {
    await appendActivityEvent({ entity: 'diesel_log', action: 'created', label: '2026-03-21', details: '100L' });
    await appendActivityEvent({ entity: 'diesel_log', action: 'edited', label: '2026-03-21', details: '110L' });

    const list = await getActivityHistory(10);
    expect(list).toHaveLength(2);
    expect(list[0].action).toBe('edited');
    expect(list[1].action).toBe('created');
  });

  test('respects limit argument', async () => {
    await appendActivityEvent({ entity: 'diesel_log', action: 'created', label: 'a' });
    await appendActivityEvent({ entity: 'diesel_log', action: 'edited', label: 'b' });
    await appendActivityEvent({ entity: 'diesel_log', action: 'deleted', label: 'c' });

    const list = await getActivityHistory(2);
    expect(list).toHaveLength(2);
    expect(list[0].label).toBe('c');
    expect(list[1].label).toBe('b');
  });
});
