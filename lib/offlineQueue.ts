import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { BUY_RATE, SELL_RATE, getFortnight, monthKey, round2 } from '../constants/defaults';

type OfflineActionType =
  | 'upsertTransportOwner'
  | 'upsertVehicle'
  | 'upsertRoute'
  | 'addTripEntry'
  | 'deleteTripEntry'
  | 'addDieselLog'
  | 'updateDieselLog'
  | 'softDeleteDieselLog'
  | 'addGSTEntry'
  | 'deleteGSTEntry'
  | 'addOtherDeduction'
  | 'deleteOtherDeduction'
  | 'upsertTransportIncome'
  | 'addPayment'
  | 'deletePayment';

type OfflineAction = {
  id: string;
  type: OfflineActionType;
  payload: any;
  createdAt: string;
  retries: number;
  fingerprint: string;
  status?: 'pending' | 'conflict';
  lastError?: string;
};

type QueueEvent =
  | { type: 'queued'; queueSize: number; actionType: OfflineActionType; deduped?: boolean }
  | { type: 'flushed'; processed: number; remaining: number };

type QueueListener = (event: QueueEvent) => void;

const KEY = 'transportledger.offline.queue.v1';
let flushing = false;
const queueListeners = new Set<QueueListener>();
const DEDUPABLE_TYPES = new Set<OfflineActionType>([
  'upsertTransportOwner',
  'upsertVehicle',
  'upsertRoute',
  'updateDieselLog',
  'softDeleteDieselLog',
  'deleteTripEntry',
  'deleteGSTEntry',
  'deleteOtherDeduction',
  'upsertTransportIncome',
  'deletePayment',
]);

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fingerprintFor(type: OfflineActionType, payload: any): string {
  return `${type}:${stableStringify(payload)}`;
}

async function readQueue(): Promise<OfflineAction[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: OfflineAction[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
}

function emitQueueEvent(event: QueueEvent) {
  queueListeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Ignore listener failures so queue flow is not blocked.
    }
  });
}

export function subscribeOfflineQueueEvents(listener: QueueListener) {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

export function isLikelyOfflineError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  return message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error') || message.includes('timeout');
}

export async function enqueueOfflineAction(type: OfflineActionType, payload: any) {
  const queue = await readQueue();
  const fingerprint = fingerprintFor(type, payload);
  if (DEDUPABLE_TYPES.has(type)) {
    const existing = queue.find((q) => q.fingerprint === fingerprint && (q.status ?? 'pending') === 'pending');
    if (existing) {
      emitQueueEvent({ type: 'queued', queueSize: queue.length, actionType: type, deduped: true });
      return;
    }
  }

  queue.push({
    id: uid(),
    type,
    payload,
    createdAt: new Date().toISOString(),
    retries: 0,
    fingerprint,
    status: 'pending',
  });
  await writeQueue(queue);
  emitQueueEvent({ type: 'queued', queueSize: queue.length, actionType: type });
}

async function processAction(action: OfflineAction): Promise<void> {
  if (action.type === 'upsertTransportOwner') {
    const { error } = await supabase.from('transport_owners').upsert(action.payload);
    if (error) throw error;
    return;
  }

  if (action.type === 'upsertRoute') {
    const { error } = await supabase.from('routes').upsert(action.payload);
    if (error) throw error;
    return;
  }

  if (action.type === 'upsertVehicle') {
    const { error } = await supabase.from('vehicles').upsert(action.payload);
    if (error) throw error;
    return;
  }

  if (action.type === 'addTripEntry') {
    const payload = action.payload;
    const amount = round2(Number(payload.tonnes) * Number(payload.rate_snapshot));
    const { error } = await supabase.from('trip_entries').insert({ ...payload, amount });
    if (error) throw error;
    return;
  }

  if (action.type === 'deleteTripEntry') {
    const { error } = await supabase.from('trip_entries').delete().eq('id', action.payload.id);
    if (error) throw error;
    return;
  }

  if (action.type === 'addDieselLog') {
    const payload = action.payload;
    const month = payload.date.substring(0, 7);
    const fortnight = getFortnight(payload.date);
    const amount = round2(Number(payload.litres) * SELL_RATE);
    const buy_amount = round2(Number(payload.litres) * BUY_RATE);
    const profit = round2(amount - buy_amount);
    const { error } = await supabase.from('diesel_logs').insert({
      ...payload,
      month,
      fortnight,
      buy_rate: BUY_RATE,
      sell_rate: SELL_RATE,
      amount,
      buy_amount,
      profit,
    });
    if (error) throw error;
    return;
  }

  if (action.type === 'updateDieselLog') {
    const payload = action.payload;
    const month = payload.date.substring(0, 7);
    const fortnight = getFortnight(payload.date);
    const amount = round2(Number(payload.litres) * SELL_RATE);
    const buy_amount = round2(Number(payload.litres) * BUY_RATE);
    const profit = round2(amount - buy_amount);
    const { error } = await supabase
      .from('diesel_logs')
      .update({
        date: payload.date,
        month,
        fortnight,
        litres: Number(payload.litres),
        buy_rate: BUY_RATE,
        sell_rate: SELL_RATE,
        amount,
        buy_amount,
        profit,
      })
      .eq('id', payload.id);
    if (error) throw error;
    return;
  }

  if (action.type === 'softDeleteDieselLog') {
    const { error } = await supabase
      .from('diesel_logs')
      .update({ deleted_at: new Date().toISOString(), delete_reason: action.payload.reason })
      .eq('id', action.payload.id);
    if (error) throw error;
    return;
  }

  if (action.type === 'addGSTEntry') {
    const payload = action.payload;
    const commission_on_gst = round2(Number(payload.gross_gst) * Number(payload.gst_commission_rate));
    const net_gst = round2(Number(payload.gross_gst) - commission_on_gst);
    const entered_in_month = monthKey();
    const { error } = await supabase
      .from('gst_entries')
      .insert({ ...payload, commission_on_gst, net_gst, entered_in_month });
    if (error) throw error;
    return;
  }

  if (action.type === 'deleteGSTEntry') {
    const { error } = await supabase.from('gst_entries').delete().eq('id', action.payload.id);
    if (error) throw error;
    return;
  }

  if (action.type === 'addOtherDeduction') {
    const { error } = await supabase.from('other_deductions').insert(action.payload);
    if (error) throw error;
    return;
  }

  if (action.type === 'deleteOtherDeduction') {
    const { error } = await supabase.from('other_deductions').delete().eq('id', action.payload.id);
    if (error) throw error;
    return;
  }

  if (action.type === 'upsertTransportIncome') {
    const { error } = await supabase.from('transport_income').upsert(action.payload, { onConflict: 'transport_owner_id,month' });
    if (error) throw error;
    return;
  }

  if (action.type === 'addPayment') {
    const payload = { ...action.payload, month: action.payload?.month ?? monthKey() };
    const { error } = await supabase.from('payments').insert(payload);
    if (error) throw error;
    return;
  }

  if (action.type === 'deletePayment') {
    const { error } = await supabase.from('payments').delete().eq('id', action.payload.id);
    if (error) throw error;
    return;
  }
}

export async function flushOfflineQueue(): Promise<{ processed: number; remaining: number }> {
  if (flushing) return { processed: 0, remaining: (await readQueue()).length };
  flushing = true;
  try {
    const queue = await readQueue();
    if (!queue.length) return { processed: 0, remaining: 0 };

    const remaining: OfflineAction[] = [];
    let processed = 0;

    for (const action of queue) {
      try {
        await processAction(action);
        processed += 1;
      } catch (e) {
        const errMessage = String((e as any)?.message ?? e ?? 'Unknown error');
        if (isLikelyOfflineError(e)) {
          remaining.push({ ...action, retries: action.retries + 1, status: 'pending', lastError: errMessage });
          continue;
        }
        if (action.retries < 3) {
          remaining.push({ ...action, retries: action.retries + 1, status: 'pending', lastError: errMessage });
        } else {
          remaining.push({ ...action, status: 'conflict', lastError: errMessage });
        }
      }
    }

    await writeQueue(remaining);
    emitQueueEvent({ type: 'flushed', processed, remaining: remaining.length });
    return { processed, remaining: remaining.length };
  } finally {
    flushing = false;
  }
}

export async function getOfflineQueueSize(): Promise<number> {
  return (await readQueue()).length;
}

export async function getOfflineQueueItems(): Promise<OfflineAction[]> {
  return readQueue();
}

export async function removeOfflineQueueItem(id: string): Promise<void> {
  const queue = await readQueue();
  const next = queue.filter((q) => q.id !== id);
  await writeQueue(next);
}

export async function retryOfflineQueueItem(id: string): Promise<{ retried: boolean; status: 'processed' | 'pending' | 'conflict'; message?: string }> {
  const queue = await readQueue();
  const item = queue.find((q) => q.id === id);
  if (!item) return { retried: false, status: 'conflict', message: 'Queue item not found.' };

  try {
    await processAction(item);
    const next = queue.filter((q) => q.id !== id);
    await writeQueue(next);
    emitQueueEvent({ type: 'flushed', processed: 1, remaining: next.length });
    return { retried: true, status: 'processed' };
  } catch (e) {
    const errMessage = String((e as any)?.message ?? e ?? 'Unknown error');
    const isOffline = isLikelyOfflineError(e);
    const next = queue.map((q) => {
      if (q.id !== id) return q;
      const retries = q.retries + 1;
      const status: 'pending' | 'conflict' = isOffline || retries < 3 ? 'pending' : 'conflict';
      return { ...q, retries, status, lastError: errMessage };
    });
    await writeQueue(next);
    return { retried: true, status: isOffline ? 'pending' : (item.retries + 1 < 3 ? 'pending' : 'conflict'), message: errMessage };
  }
}

export async function runWriteThroughQueue<T>(
  type: OfflineActionType,
  payload: any,
  writer: () => Promise<T>,
  queuedFallback: T,
): Promise<T> {
  try {
    return await writer();
  } catch (e) {
    if (!isLikelyOfflineError(e)) throw e;
    await enqueueOfflineAction(type, payload);
    return queuedFallback;
  }
}
