import AsyncStorage from '@react-native-async-storage/async-storage';

export type ActivityAction = 'created' | 'edited' | 'deleted' | 'restored' | 'sync';

export type ActivityEvent = {
  id: string;
  at: string;
  entity: string;
  action: ActivityAction;
  label: string;
  details?: string;
};

const KEY = 'transportledger.activity.history.v1';
const MAX_ITEMS = 200;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getActivityHistory(limit = 30): Promise<ActivityEvent[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

export async function appendActivityEvent(event: Omit<ActivityEvent, 'id' | 'at'>): Promise<void> {
  const list = await getActivityHistory(MAX_ITEMS);
  const next: ActivityEvent[] = [
    {
      id: makeId(),
      at: new Date().toISOString(),
      ...event,
    },
    ...list,
  ].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}
