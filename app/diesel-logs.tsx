import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, Modal, Pressable, Vibration } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ThemedDateField from '../components/ThemedDateField';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';
import { useThemedNotice } from '../components/ThemedNoticeProvider';
import { getTransportOwners, getVehiclesByOwnerIds, getDieselLogsByVehicleIds, softDeleteDieselLog, updateDieselLog } from '../lib/queries';
import { appendActivityEvent, getActivityHistory, type ActivityEvent } from '../lib/activityHistory';
import { readDieselInsights, writeDieselInsights, type DieselInsightsCache } from '../lib/dieselInsightsCache';
import { BUY_RATE, getFortnight, monthKey, monthLabel, round2, SELL_RATE } from '../constants/defaults';
import type { DieselLog, TransportOwner, Vehicle } from '../types';

type PeriodFilter = 'all' | '1' | '2';
const FILTERS_KEY = 'transportledger.diesel.logs.filters.v1';

type UndoDeleteItem = {
  token: string;
  log: DieselLog;
  queryMonth: string;
  queryVehicleIdsKey: string;
  expiresAt: number;
};

const SWIPE_FRICTION = 1.8;
const SWIPE_RIGHT_THRESHOLD = 32;
const SWIPE_DRAG_OFFSET = 24;

function prevMonth(m: string) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(m: string) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sumAmount(logs: DieselLog[]) {
  return round2(logs.reduce((s, l) => s + Number(l.amount || 0), 0));
}

export default function DieselLogsScreen() {
  const params = useLocalSearchParams<{ ownerId?: string; vehicleId?: string; month?: string }>();
  const notice = useThemedNotice();
  const queryClient = useQueryClient();
  const hasInitialOwnerParam = typeof params.ownerId === 'string' && params.ownerId.length > 0;

  const [month, setMonth] = useState(params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthKey());
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(typeof params.ownerId === 'string' ? params.ownerId : null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(typeof params.vehicleId === 'string' ? params.vehicleId : null);
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [ownerSelectorCollapsed, setOwnerSelectorCollapsed] = useState(hasInitialOwnerParam);
  const [editing, setEditing] = useState<DieselLog | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [undoQueue, setUndoQueue] = useState<UndoDeleteItem[]>([]);
  const [undoCountdown, setUndoCountdown] = useState(0);
  const [cachedInsights, setCachedInsights] = useState<DieselInsightsCache | null>(null);
  const [recentHistory, setRecentHistory] = useState<ActivityEvent[]>([]);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const swipeRefs = useRef<Record<string, Swipeable | null>>({});
  const undoTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const undoCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasRestoredFiltersRef = useRef(false);

  const { data: owners = [], isLoading: ownersLoading, error: ownersError } = useQuery({
    queryKey: ['dieselLogsOwners'],
    queryFn: getTransportOwners,
    refetchInterval: 60_000,
  });

  const ownerIdsKey = useMemo(() => owners.map((o) => o.id).sort().join(','), [owners]);
  const { data: vehicles = [], isLoading: vehiclesLoading, error: vehiclesError, refetch: refetchVehicles } = useQuery({
    queryKey: ['dieselLogsVehicles', ownerIdsKey],
    queryFn: () => getVehiclesByOwnerIds(owners.map((o) => o.id)),
    enabled: owners.length > 0,
    refetchInterval: 60_000,
  });

  const allVehicleIds = useMemo(() => vehicles.map((v) => v.id), [vehicles]);
  const scopedVehicleIds = useMemo(() => {
    if (!selectedOwnerId) return allVehicleIds;
    return vehicles.filter((v) => v.transport_owner_id === selectedOwnerId).map((v) => v.id);
  }, [selectedOwnerId, vehicles, allVehicleIds]);
  const vehicleIdsKey = useMemo(() => scopedVehicleIds.join(','), [scopedVehicleIds]);
  const { data: monthLogs = [], isLoading: logsLoading, isFetching: logsFetching, error: logsError, refetch: refetchLogs } = useQuery({
    queryKey: ['dieselLogsMonth', month, vehicleIdsKey],
    queryFn: () => getDieselLogsByVehicleIds(scopedVehicleIds, month),
    enabled: scopedVehicleIds.length > 0,
    refetchInterval: 45_000,
  });

  useEffect(() => {
    if (ownersError || vehiclesError || logsError) {
      notice.showError('Error', 'Could not load diesel logs right now.');
    }
  }, [ownersError, vehiclesError, logsError, notice]);

  useEffect(() => {
    if (ownersLoading) return;
    if (!selectedOwnerId) return;
    const exists = owners.some((o) => o.id === selectedOwnerId);
    if (!exists) {
      setSelectedOwnerId(null);
      setSelectedVehicleId(null);
    }
  }, [owners, ownersLoading, selectedOwnerId]);

  useEffect(() => {
    if (!selectedOwnerId) setOwnerSelectorCollapsed(false);
  }, [selectedOwnerId]);

  useEffect(() => {
    if (hasRestoredFiltersRef.current) return;
    hasRestoredFiltersRef.current = true;

    const restoreFilters = async () => {
      try {
        const raw = await AsyncStorage.getItem(FILTERS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          month?: string;
          selectedOwnerId?: string | null;
          selectedVehicleId?: string | null;
          period?: PeriodFilter;
          ownerSelectorCollapsed?: boolean;
        };

        if (!hasInitialOwnerParam && parsed.month && /^\d{4}-\d{2}$/.test(parsed.month)) setMonth(parsed.month);
        if (!hasInitialOwnerParam && typeof parsed.selectedOwnerId !== 'undefined') setSelectedOwnerId(parsed.selectedOwnerId ?? null);
        if (!hasInitialOwnerParam && typeof parsed.selectedVehicleId !== 'undefined') setSelectedVehicleId(parsed.selectedVehicleId ?? null);
        if (parsed.period === 'all' || parsed.period === '1' || parsed.period === '2') setPeriod(parsed.period);
        if (!hasInitialOwnerParam && typeof parsed.ownerSelectorCollapsed === 'boolean') setOwnerSelectorCollapsed(parsed.ownerSelectorCollapsed);
      } catch {
        // Ignore restore parse errors and keep defaults.
      }
    };

    void restoreFilters();
  }, [hasInitialOwnerParam]);

  useEffect(() => {
    const saveFilters = async () => {
      try {
        await AsyncStorage.setItem(
          FILTERS_KEY,
          JSON.stringify({
            month,
            selectedOwnerId,
            selectedVehicleId,
            period,
            ownerSelectorCollapsed,
          })
        );
      } catch {
        // Ignore storage save errors.
      }
    };

    void saveFilters();
  }, [month, selectedOwnerId, selectedVehicleId, period, ownerSelectorCollapsed]);

  useEffect(() => {
    if (undoCountdownTimerRef.current) {
      clearInterval(undoCountdownTimerRef.current);
      undoCountdownTimerRef.current = null;
    }

    if (!undoQueue.length) {
      setUndoCountdown(0);
      return;
    }

    const updateCountdown = () => {
      const latest = undoQueue[undoQueue.length - 1];
      const seconds = Math.max(0, Math.ceil((latest.expiresAt - Date.now()) / 1000));
      setUndoCountdown(seconds);
    };

    updateCountdown();
    undoCountdownTimerRef.current = setInterval(updateCountdown, 250);

    return () => {
      if (undoCountdownTimerRef.current) {
        clearInterval(undoCountdownTimerRef.current);
        undoCountdownTimerRef.current = null;
      }
    };
  }, [undoQueue]);

  useEffect(() => {
    return () => {
      Object.values(undoTimeoutsRef.current).forEach((id) => clearTimeout(id));
      undoTimeoutsRef.current = {};
      if (undoCountdownTimerRef.current) {
        clearInterval(undoCountdownTimerRef.current);
        undoCountdownTimerRef.current = null;
      }
    };
  }, []);

  const vehiclesById = useMemo(() => {
    const map = new Map<string, Vehicle>();
    vehicles.forEach((v) => map.set(v.id, v));
    return map;
  }, [vehicles]);

  const ownersById = useMemo(() => {
    const map = new Map<string, TransportOwner>();
    owners.forEach((o) => map.set(o.id, o));
    return map;
  }, [owners]);

  const ownerVehicles = useMemo(() => {
    if (!selectedOwnerId) return vehicles;
    return vehicles.filter((v) => v.transport_owner_id === selectedOwnerId);
  }, [vehicles, selectedOwnerId]);

  useEffect(() => {
    if (vehiclesLoading) return;
    if (!selectedVehicleId) return;
    if (!ownerVehicles.some((v) => v.id === selectedVehicleId)) {
      setSelectedVehicleId(null);
    }
  }, [ownerVehicles, selectedVehicleId, vehiclesLoading]);

  const ownerScopedLogs = monthLogs;

  const periodScopedLogs = useMemo(() => {
    if (period === 'all') return ownerScopedLogs;
    return ownerScopedLogs.filter((l) => String(l.fortnight) === period);
  }, [ownerScopedLogs, period]);

  const displayLogs = useMemo(() => {
    const filtered = selectedVehicleId ? periodScopedLogs.filter((l) => l.vehicle_id === selectedVehicleId) : periodScopedLogs;
    return [...filtered].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
  }, [periodScopedLogs, selectedVehicleId]);

  const monthTotal = sumAmount(ownerScopedLogs);
  const half1Total = sumAmount(ownerScopedLogs.filter((l) => Number(l.fortnight) === 1));
  const half2Total = sumAmount(ownerScopedLogs.filter((l) => Number(l.fortnight) === 2));
  const currentTotal = sumAmount(displayLogs);

  const transportTotals = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; litres: number }>();
    for (const log of periodScopedLogs) {
      const v = vehiclesById.get(log.vehicle_id);
      if (!v) continue;
      const owner = ownersById.get(v.transport_owner_id);
      const key = v.transport_owner_id;
      const name = owner?.name ?? 'Unknown owner';
      const ex = map.get(key) ?? { name, amount: 0, litres: 0 };
      ex.amount += Number(log.amount || 0);
      ex.litres += Number(log.litres || 0);
      map.set(key, ex);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [periodScopedLogs, vehiclesById, ownersById]);

  const vehicleTotals = useMemo(() => {
    const map = new Map<string, { reg: string; owner: string; amount: number; litres: number }>();
    for (const log of periodScopedLogs) {
      const v = vehiclesById.get(log.vehicle_id);
      const reg = v?.reg_number ?? 'Unknown vehicle';
      const owner = ownersById.get(v?.transport_owner_id ?? '')?.name ?? 'Unknown owner';
      const ex = map.get(log.vehicle_id) ?? { reg, owner, amount: 0, litres: 0 };
      ex.amount += Number(log.amount || 0);
      ex.litres += Number(log.litres || 0);
      map.set(log.vehicle_id, ex);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [periodScopedLogs, vehiclesById, ownersById]);

  const insightsCacheKey = useMemo(
    () => [month, selectedOwnerId ?? 'all', selectedVehicleId ?? 'all', period].join('|'),
    [month, selectedOwnerId, selectedVehicleId, period]
  );

  const loadHistory = async () => {
    const data = await getActivityHistory(8);
    setRecentHistory(data);
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    const hydrateInsights = async () => {
      const cached = await readDieselInsights(insightsCacheKey);
      setCachedInsights(cached);
    };
    void hydrateInsights();
  }, [insightsCacheKey]);

  const loading = ownersLoading || vehiclesLoading || logsLoading;

  useEffect(() => {
    if (loading) return;
    const snapshot: DieselInsightsCache = {
      monthTotal,
      half1Total,
      half2Total,
      currentTotal,
      displayCount: displayLogs.length,
      transportTotals,
      vehicleTotals,
      updatedAt: new Date().toISOString(),
    };
    void writeDieselInsights(insightsCacheKey, snapshot);
    setCachedInsights(snapshot);
  }, [loading, monthTotal, half1Total, half2Total, currentTotal, displayLogs.length, transportTotals, vehicleTotals, insightsCacheKey]);

  const effectiveInsights: DieselInsightsCache = useMemo(
    () =>
      loading && cachedInsights
        ? cachedInsights
        : {
            monthTotal,
            half1Total,
            half2Total,
            currentTotal,
            displayCount: displayLogs.length,
            transportTotals,
            vehicleTotals,
            updatedAt: new Date().toISOString(),
          },
    [loading, cachedInsights, monthTotal, half1Total, half2Total, currentTotal, displayLogs.length, transportTotals, vehicleTotals]
  );

  const triggerHaptic = (intensity: 'light' | 'strong' = 'light') => {
    Vibration.vibrate(intensity === 'strong' ? 16 : 8);
  };

  const commitDelete = async (log: DieselLog, queryMonth: string, queryVehicleKey: string) => {
    setDeletingId(log.id);
    try {
      await softDeleteDieselLog(log.id, 'Removed from diesel logs screen');
      await appendActivityEvent({ entity: 'diesel_log', action: 'deleted', label: log.date, details: `${round2(log.litres)}L` });
      await loadHistory();
      void queryClient.invalidateQueries({ queryKey: ['dieselLogsMonth', queryMonth, queryVehicleKey] });
      void queryClient.invalidateQueries({ queryKey: ['homeSummary'] });
      void queryClient.invalidateQueries({ queryKey: ['transportersSummary'] });
      void queryClient.invalidateQueries({ queryKey: ['reportsBootstrap'] });
    } catch (e) {
      queryClient.setQueryData<DieselLog[]>(['dieselLogsMonth', queryMonth, queryVehicleKey], (prev) => {
        const list = prev ?? [];
        if (list.some((x) => x.id === log.id)) return list;
        return [log, ...list].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
      });
      notice.showError('Error', String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const onDeleteLog = async (log: DieselLog) => {
    const token = `${log.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const queryMonth = month;
    const queryVehicleIdsKey = vehicleIdsKey;
    const expiresAt = Date.now() + 5000;

    queryClient.setQueryData<DieselLog[]>(['dieselLogsMonth', queryMonth, queryVehicleIdsKey], (prev) => (prev ?? []).filter((x) => x.id !== log.id));
    setUndoQueue((prev) => [...prev, { token, log, queryMonth, queryVehicleIdsKey, expiresAt }]);
    notice.showInfo('Deleted', 'Entry removed. Tap Undo below within 5s to restore.');
    void appendActivityEvent({ entity: 'diesel_log', action: 'deleted', label: log.date, details: `Queued delete · ${round2(log.litres)}L` });
    void loadHistory();

    undoTimeoutsRef.current[token] = setTimeout(() => {
      void commitDelete(log, queryMonth, queryVehicleIdsKey);
      setUndoQueue((prev) => prev.filter((x) => x.token !== token));
      delete undoTimeoutsRef.current[token];
    }, 5000);
  };

  const onUndoDelete = () => {
    const latest = undoQueue[undoQueue.length - 1];
    if (!latest) return;

    const timeoutId = undoTimeoutsRef.current[latest.token];
    if (timeoutId) {
      clearTimeout(timeoutId);
      delete undoTimeoutsRef.current[latest.token];
    }

    const restore = latest.log;
    queryClient.setQueryData<DieselLog[]>(['dieselLogsMonth', latest.queryMonth, latest.queryVehicleIdsKey], (prev) => {
      const list = prev ?? [];
      if (list.some((x) => x.id === restore.id)) return list;
      return [restore, ...list].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
    });
    setUndoQueue((prev) => prev.filter((x) => x.token !== latest.token));
    void appendActivityEvent({ entity: 'diesel_log', action: 'restored', label: restore.date, details: `${round2(restore.litres)}L` });
    void loadHistory();
    notice.showSuccess('Restored', 'Diesel entry restored.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb' }}>
      <View style={{ position: 'absolute', top: 24, left: -48, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' }} />
      <View style={{ position: 'absolute', top: 220, right: -62, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' }} />

      <View style={{ paddingHorizontal: 16, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={18} color="#111111" />
        </TouchableOpacity>
        <Text style={{ color: '#111111', fontSize: 20, fontWeight: '800' }}>Diesel Logs</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Refresh diesel logs"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => { void refetchVehicles(); void refetchLogs(); }}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="refresh" size={16} color="#111111" />
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth((m) => prevMonth(m))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#f2d7e6', backgroundColor: '#ffffffcc' }}>
          <Text style={{ color: '#111111', fontWeight: '700' }}>Prev</Text>
        </TouchableOpacity>
        <Text style={{ color: '#111111', fontSize: 16, fontWeight: '800' }}>{monthLabel(month)}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonth((m) => nextMonth(m))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#f2d7e6', backgroundColor: '#ffffffcc' }}>
          <Text style={{ color: '#111111', fontWeight: '700' }}>Next</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={logsFetching && !loading} onRefresh={() => { void refetchVehicles(); void refetchLogs(); }} tintColor="#ec4899" />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Transport Owner</Text>
        {ownerSelectorCollapsed && selectedOwnerId ? (
          <View style={{ marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 }}>
              <Chip
                text={ownersById.get(selectedOwnerId)?.name ?? 'Selected owner'}
                active
                onPress={() => {}}
              />
            </View>
            <TouchableOpacity
              onPress={() => setOwnerSelectorCollapsed(false)}
              style={{ backgroundColor: '#ffffffcc', borderWidth: 1, borderColor: '#f2d7e6', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }}
            >
              <Text style={{ color: '#111111', fontWeight: '700', fontSize: 12 }}>Change</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            <Chip text="All" active={!selectedOwnerId} onPress={() => { setSelectedOwnerId(null); setSelectedVehicleId(null); }} />
            {owners.map((o) => (
              <Chip key={o.id} text={o.name} active={selectedOwnerId === o.id} onPress={() => { setSelectedOwnerId(o.id); setSelectedVehicleId(null); setOwnerSelectorCollapsed(true); }} />
            ))}
          </ScrollView>
        )}

        <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Vehicle</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <Chip text="All" active={!selectedVehicleId} onPress={() => setSelectedVehicleId(null)} />
          {ownerVehicles.map((v) => (
            <Chip key={v.id} text={v.reg_number} active={selectedVehicleId === v.id} onPress={() => setSelectedVehicleId(v.id)} />
          ))}
        </ScrollView>

        <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Date Split</Text>
        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
          <Chip text="Full month" active={period === 'all'} onPress={() => setPeriod('all')} />
          <Chip text="1-15" active={period === '1'} onPress={() => setPeriod('1')} />
          <Chip text="16-end" active={period === '2'} onPress={() => setPeriod('2')} />
        </View>

        {loading && (
          <>
            <SkeletonCard>
              <SkeletonBlock style={{ width: 120, height: 12, marginBottom: 10 }} />
              <SkeletonBlock style={{ width: '100%', height: 48, marginBottom: 8 }} />
              <SkeletonBlock style={{ width: '100%', height: 48 }} />
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={{ width: 140, height: 12, marginBottom: 10 }} />
              <SkeletonBlock style={{ width: '100%', height: 54, marginBottom: 8 }} />
              <SkeletonBlock style={{ width: '100%', height: 54 }} />
            </SkeletonCard>
          </>
        )}

        {(!loading || !!cachedInsights) && (
          <>
            <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 }}>Month Wise Distributed</Text>
              <Text style={{ color: '#111111', fontSize: 22, fontWeight: '800', marginTop: 4 }}>₹{effectiveInsights.monthTotal.toLocaleString('en-IN')}</Text>
              <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
                <View style={{ flex: 1, backgroundColor: '#fff7fb', borderWidth: 1, borderColor: '#f2d7e6', borderRadius: 12, padding: 10 }}>
                  <Text style={{ color: '#6b5c67', fontSize: 11 }}>1-15</Text>
                  <Text style={{ color: '#111111', fontWeight: '800', marginTop: 2 }}>₹{effectiveInsights.half1Total.toLocaleString('en-IN')}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: '#fff7fb', borderWidth: 1, borderColor: '#f2d7e6', borderRadius: 12, padding: 10 }}>
                  <Text style={{ color: '#6b5c67', fontSize: 11 }}>16-end</Text>
                  <Text style={{ color: '#111111', fontWeight: '800', marginTop: 2 }}>₹{effectiveInsights.half2Total.toLocaleString('en-IN')}</Text>
                </View>
              </View>
              <Text style={{ color: '#6b5c67', fontSize: 12, marginTop: 10 }}>Current filter total: ₹{effectiveInsights.currentTotal.toLocaleString('en-IN')} ({effectiveInsights.displayCount} logs)</Text>
              {!!cachedInsights && loading && <Text style={{ color: '#8d7a86', fontSize: 11, marginTop: 4 }}>Showing cached summary while refreshing...</Text>}
            </View>

            <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <Text style={{ color: '#111111', fontSize: 15, fontWeight: '800', marginBottom: 8 }}>Transport-wise Totals</Text>
              {effectiveInsights.transportTotals.length === 0 && <Text style={{ color: '#6b5c67' }}>No data for this filter.</Text>}
              {effectiveInsights.transportTotals.map((t) => (
                <View key={t.name} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: '#111111', fontWeight: '700' }} numberOfLines={1}>{t.name}</Text>
                    <Text style={{ color: '#6b5c67', fontSize: 11 }}>{round2(t.litres).toLocaleString('en-IN')}L</Text>
                  </View>
                  <Text style={{ color: '#111111', fontWeight: '800' }}>₹{round2(t.amount).toLocaleString('en-IN')}</Text>
                </View>
              ))}
            </View>

            <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <Text style={{ color: '#111111', fontSize: 15, fontWeight: '800', marginBottom: 8 }}>Vehicle-wise Totals</Text>
              {effectiveInsights.vehicleTotals.length === 0 && <Text style={{ color: '#6b5c67' }}>No data for this filter.</Text>}
              {effectiveInsights.vehicleTotals.map((t) => (
                <View key={`${t.owner}-${t.reg}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: '#111111', fontWeight: '700' }} numberOfLines={1}>{t.reg}</Text>
                    <Text style={{ color: '#6b5c67', fontSize: 11 }} numberOfLines={1}>{t.owner} · {round2(t.litres).toLocaleString('en-IN')}L</Text>
                  </View>
                  <Text style={{ color: '#111111', fontWeight: '800' }}>₹{round2(t.amount).toLocaleString('en-IN')}</Text>
                </View>
              ))}
            </View>

            <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <Text style={{ color: '#111111', fontSize: 15, fontWeight: '800', marginBottom: 8 }}>Recent Activity</Text>
              {recentHistory.length === 0 && <Text style={{ color: '#6b5c67' }}>No local activity yet.</Text>}
              {recentHistory.map((h) => (
                <View key={h.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f2d7e6' }}>
                  <Text style={{ color: '#111111', fontWeight: '700' }} numberOfLines={1}>{h.entity} · {h.action}</Text>
                  <Text style={{ color: '#6b5c67', fontSize: 11 }} numberOfLines={1}>{h.label}{h.details ? ` · ${h.details}` : ''}</Text>
                </View>
              ))}
            </View>

            <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#111111', fontSize: 16, fontWeight: '800' }}>Diesel Entries</Text>
              <Text style={{ color: '#8d7a86', fontSize: 12 }}>Swipe left for edit/delete</Text>
            </View>
            {displayLogs.length === 0 && (
              <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 }}>
                <Text style={{ color: '#111111', fontWeight: '700' }}>No diesel logs found</Text>
                <Text style={{ color: '#6b5c67', marginTop: 4 }}>Try another month, owner, vehicle, or date split.</Text>
              </View>
            )}
            {displayLogs.map((log) => {
              const v = vehiclesById.get(log.vehicle_id);
              const owner = ownersById.get(v?.transport_owner_id ?? '');
              return (
                <Swipeable
                  key={log.id}
                  ref={(ref) => {
                    swipeRefs.current[log.id] = ref;
                  }}
                  friction={SWIPE_FRICTION}
                  rightThreshold={SWIPE_RIGHT_THRESHOLD}
                  dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}
                  overshootRight={false}
                  onSwipeableWillOpen={() => {
                    if (openSwipeId && openSwipeId !== log.id) {
                      swipeRefs.current[openSwipeId]?.close();
                    }
                    setOpenSwipeId(log.id);
                    triggerHaptic();
                  }}
                  onSwipeableClose={() => {
                    if (openSwipeId === log.id) setOpenSwipeId(null);
                  }}
                  renderRightActions={() => (
                    <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic();
                          swipeRefs.current[log.id]?.close();
                          setEditing(log);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Edit diesel log"
                        style={{ width: 78, borderRadius: 12, marginRight: 6, backgroundColor: '#db2777', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Ionicons name="create-outline" size={16} color="#ffffff" />
                        <Text style={{ color: '#ffffff', fontSize: 11, marginTop: 3, fontWeight: '700' }}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={deletingId === log.id}
                        onPress={() => {
                          triggerHaptic('strong');
                          swipeRefs.current[log.id]?.close();
                          void onDeleteLog(log);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Delete diesel log"
                        style={{ width: 78, borderRadius: 12, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', opacity: deletingId === log.id ? 0.6 : 1 }}
                      >
                        <Ionicons name="trash-outline" size={16} color="#ffffff" />
                        <Text style={{ color: '#ffffff', fontSize: 11, marginTop: 3, fontWeight: '700' }}>{deletingId === log.id ? '...' : 'Delete'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                >
                  <TouchableOpacity
                    onPress={() => {
                      triggerHaptic();
                      if (openSwipeId === log.id) swipeRefs.current[log.id]?.close();
                      setEditing(log);
                    }}
                    onLongPress={() => {
                      triggerHaptic();
                      if (openSwipeId === log.id) swipeRefs.current[log.id]?.close();
                      setEditing(log);
                    }}
                    delayLongPress={220}
                    style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 8 }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={{ color: '#111111', fontWeight: '800' }} numberOfLines={1}>{v?.reg_number ?? 'Unknown vehicle'}</Text>
                        <Text style={{ color: '#6b5c67', fontSize: 11 }} numberOfLines={1}>{owner?.name ?? 'Unknown owner'}</Text>
                        <Text style={{ color: '#6b5c67', fontSize: 11, marginTop: 2 }}>{log.date} · {Number(log.fortnight) === 1 ? '1-15' : '16-end'} · {round2(Number(log.litres)).toLocaleString('en-IN')}L</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: '#111111', fontWeight: '800' }}>₹{round2(Number(log.amount)).toLocaleString('en-IN')}</Text>
                        <Text style={{ color: '#8d7a86', fontSize: 11 }}>tap to edit</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                </Swipeable>
              );
            })}
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <EditDieselLogModal
        log={editing}
        onClose={() => setEditing(null)}
        onSaved={async (updatedInput) => {
          const previous = monthLogs.find((l) => l.id === updatedInput.id);
          if (previous) {
            const nextMonth = updatedInput.date.substring(0, 7);
            const nextFortnight = getFortnight(updatedInput.date) as 1 | 2;
            const nextAmount = round2(updatedInput.litres * SELL_RATE);
            const nextBuyAmount = round2(updatedInput.litres * BUY_RATE);
            const nextProfit = round2(nextAmount - nextBuyAmount);
            queryClient.setQueryData<DieselLog[]>(['dieselLogsMonth', month, vehicleIdsKey], (prev) => {
              const list = prev ?? [];
              if (nextMonth !== month) return list.filter((x) => x.id !== updatedInput.id);
              return list.map((x) =>
                x.id !== updatedInput.id
                  ? x
                  : {
                      ...x,
                      date: updatedInput.date,
                      month: nextMonth,
                      fortnight: nextFortnight,
                      litres: updatedInput.litres,
                      buy_rate: BUY_RATE,
                      sell_rate: SELL_RATE,
                      amount: nextAmount,
                      buy_amount: nextBuyAmount,
                      profit: nextProfit,
                    }
              );
            });
          }
          setEditing(null);
          await loadHistory();
          void refetchLogs();
          void queryClient.invalidateQueries({ queryKey: ['homeSummary'] });
          void queryClient.invalidateQueries({ queryKey: ['transportersSummary'] });
          void queryClient.invalidateQueries({ queryKey: ['reportsBootstrap'] });
        }}
      />

      {undoQueue.length > 0 && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 18, backgroundColor: '#111111ee', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: '#ffffff', fontWeight: '600', flex: 1, marginRight: 12 }} numberOfLines={1}>
            Entry deleted · Undo {undoCountdown}s{undoQueue.length > 1 ? ` · +${undoQueue.length - 1} more` : ''}
          </Text>
          <TouchableOpacity
            onPress={onUndoDelete}
            accessibilityRole="button"
            accessibilityLabel={`Undo deleted diesel log${undoQueue.length > 1 ? ' entries' : ''}`}
            style={{ backgroundColor: '#ffffff22', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '800' }}>UNDO</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

function Chip({ text, active, onPress, accessibilityLabel }: { text: string; active: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Filter option ${text}${active ? ', selected' : ''}`}
      style={{
        marginRight: 8,
        marginBottom: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? '#d9468f' : '#f2d7e6',
        backgroundColor: active ? '#d9468f' : '#ffffffcc',
      }}
    >
      <Text style={{ color: active ? '#ffffff' : '#111111', fontWeight: '700' }} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
  );
}

function EditDieselLogModal({ log, onClose, onSaved }: { log: DieselLog | null; onClose: () => void; onSaved: (updated: { id: string; date: string; litres: number }) => Promise<void> }) {
  const [date, setDate] = useState('');
  const [litres, setLitres] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  useEffect(() => {
    if (!log) return;
    setDate(log.date);
    setLitres(String(log.litres));
  }, [log]);

  const save = async () => {
    if (!log) return;
    const l = parseFloat(litres);
    if (!date || Number.isNaN(l) || l <= 0) {
      notice.showInfo('Invalid', 'Enter valid date and litres');
      return;
    }

    setSaving(true);
    try {
      await updateDieselLog({ id: log.id, date, litres: l });
      await appendActivityEvent({ entity: 'diesel_log', action: 'edited', label: date, details: `${round2(l)}L` });
      notice.showSuccess('Saved', 'Diesel log updated.');
      await onSaved({ id: log.id, date, litres: l });
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  };

  const amount = !Number.isNaN(parseFloat(litres)) ? round2(parseFloat(litres) * SELL_RATE) : 0;

  return (
    <Modal visible={!!log} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: '#fff7fb', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: '#f2d7e6', padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#111111', fontSize: 18, fontWeight: '800' }}>Edit Diesel Log</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: '#db2777', fontWeight: '700' }}>Close</Text></TouchableOpacity>
          </View>

          <ThemedDateField label="Date" value={date} onChange={setDate} required />

          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>Litres</Text>
            <TextInput
              style={{ backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', color: '#111111', borderRadius: 10, padding: 12 }}
              keyboardType="decimal-pad"
              value={litres}
              onChangeText={setLitres}
              placeholder="e.g. 207.76"
              placeholderTextColor="#9f8b97"
            />
          </View>

          <View style={{ backgroundColor: '#fff0f7', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 12 }}>
            <Text style={{ color: '#6b5c67', fontSize: 11 }}>Distributed amount at ₹94/L</Text>
            <Text style={{ color: '#111111', fontWeight: '800', fontSize: 16 }}>₹{amount.toLocaleString('en-IN')}</Text>
          </View>

          <TouchableOpacity
            onPress={() => { void save(); }}
            disabled={saving}
            style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 12, padding: 14, alignItems: 'center' }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '800' }}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
