import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  RefreshControl, Modal, Pressable, Vibration, StyleSheet, FlatList, ActivityIndicator
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, useInfiniteQuery, InfiniteData } from '@tanstack/react-query';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ThemedDateField from '../components/ThemedDateField';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';
import { useThemedNotice } from '../components/ThemedNoticeProvider';
import { ThemedTextInput } from '../components/ThemedTextInput';
import {
  getTransportOwners, getVehiclesByOwnerIds, getDieselLogsByVehicleIds,
  softDeleteDieselLog, updateDieselLog,
} from '../lib/queries';
import { appendActivityEvent } from '../lib/activityHistory';
import {
  invalidateDieselInsightsForMonth,
  readDieselInsights,
  writeDieselInsights,
  type DieselInsightsCache,
} from '../lib/dieselInsightsCache';
import { getFortnight, monthKey, monthLabel, round2, prevMonth, nextMonth } from '../constants/defaults';
import { useAppStore } from '../store/useAppStore';
import type { DieselLog, TransportOwner, Vehicle, Route, GlobalSettings } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type PeriodFilter = 'all' | '1' | '2';

type UndoDeleteItem = {
  token: string;
  log: DieselLog;
  queryMonth: string;
  queryVehicleIdsKey: string;
  expiresAt: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FILTERS_KEY = 'transportledger.diesel.logs.filters.v1';
const SWIPE_FRICTION = 1.8;
const SWIPE_RIGHT_THRESHOLD = 32;
const SWIPE_DRAG_OFFSET = 24;

// ─── Pure helpers (defined outside component — never recreated) ───────────────

function sumAmount(logs: DieselLog[]): number {
  return round2(logs.reduce((s, l) => s + Number(l.amount || 0), 0));
}

function sortLogs(a: DieselLog, b: DieselLog): number {
  return (
    String(b.date).localeCompare(String(a.date)) ||
    String(b.created_at).localeCompare(String(a.created_at))
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DieselLogsScreen() {
  const { globalSettings } = useAppStore();
  const params = useLocalSearchParams<{ ownerId?: string; vehicleId?: string; month?: string }>();
  const notice = useThemedNotice();
  const queryClient = useQueryClient();
  const hasInitialOwnerParam = typeof params.ownerId === 'string' && params.ownerId.length > 0;

  // ── State ──
  const [month, setMonth]                               = useState(() =>
    params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthKey()
  );
  const [selectedOwnerId, setSelectedOwnerId]           = useState<string | null>(
    typeof params.ownerId === 'string' ? params.ownerId : null
  );
  const [selectedVehicleId, setSelectedVehicleId]       = useState<string | null>(
    typeof params.vehicleId === 'string' ? params.vehicleId : null
  );
  const [period, setPeriod]                             = useState<PeriodFilter>('all');
  const [ownerSelectorCollapsed, setOwnerSelectorCollapsed] = useState(hasInitialOwnerParam);
  const [editing, setEditing]                           = useState<DieselLog | null>(null);
  const [deletingId, setDeletingId]                     = useState<string | null>(null);
  const [undoQueue, setUndoQueue]                       = useState<UndoDeleteItem[]>([]);
  const [undoCountdown, setUndoCountdown]               = useState(0);
  const [cachedInsights, setCachedInsights]             = useState<DieselInsightsCache | null>(null);
  const [openSwipeId, setOpenSwipeId]                   = useState<string | null>(null);

  // ── Refs ──
  const swipeRefs               = useRef<Record<string, Swipeable | null>>({});
  const undoTimeoutsRef         = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const undoCountdownTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasRestoredFiltersRef   = useRef(false);
  const lastErrorNoticeKeyRef   = useRef('');

  // ── Queries ──
  const { data: owners = [], isLoading: ownersLoading, error: ownersError } = useQuery({
    queryKey: ['dieselLogsOwners'],
    queryFn: getTransportOwners,
  });

  const ownerIds = useMemo(() => owners.map((o) => o.id).sort(), [owners]);
  const ownerIdsKey = useMemo(() => ownerIds.join(','), [ownerIds]);

  const {
    data: vehicles = [],
    isLoading: vehiclesLoading,
    error: vehiclesError,
    refetch: refetchVehicles,
  } = useQuery({
    queryKey: ['dieselLogsVehicles', ownerIdsKey],
    queryFn: () => getVehiclesByOwnerIds(ownerIds),
    enabled: owners.length > 0,
  });

  const allVehicleIds  = useMemo(() => vehicles.map((v) => v.id), [vehicles]);
  const scopedVehicleIds = useMemo(() => {
    if (!selectedOwnerId) return allVehicleIds;
    return vehicles.filter((v) => v.transport_owner_id === selectedOwnerId).map((v) => v.id);
  }, [selectedOwnerId, vehicles, allVehicleIds]);

  const vehicleIdsKey = useMemo(() => [...scopedVehicleIds].sort().join(','), [scopedVehicleIds]);

  const {
    data: infiniteData,
    isLoading: logsLoading,
    isFetching: logsFetching,
    isFetchingNextPage: logsFetchingNextPage,
    fetchNextPage: fetchNextLogsPage,
    hasNextPage: hasNextLogsPage,
    error: logsError,
    refetch: refetchLogs,
  } = useInfiniteQuery({
    queryKey: ['dieselLogsMonth', month, vehicleIdsKey],
    queryFn: ({ pageParam = 0 }) => getDieselLogsByVehicleIds(scopedVehicleIds, month, { page: pageParam as number, pageSize: 50 }),
    getNextPageParam: (lastPage, allPages) => lastPage.length === 50 ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: scopedVehicleIds.length > 0,
    refetchInterval: 120_000,
  });

  const monthLogs = useMemo(() => {
    if (!infiniteData) return [];
    return infiniteData.pages.flat();
  }, [infiniteData]);

  const loading = ownersLoading || vehiclesLoading || logsLoading;

  // ── Derived maps ──
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

  const ownerVehicles = useMemo(
    () => selectedOwnerId ? vehicles.filter((v) => v.transport_owner_id === selectedOwnerId) : vehicles,
    [vehicles, selectedOwnerId]
  );

  // ── Filtered/derived log lists ──
  const ownerScopedLogs = monthLogs; // already scoped by vehicleIdsKey in the query

  const periodScopedLogs = useMemo(
    () => period === 'all' ? ownerScopedLogs : ownerScopedLogs.filter((l) => String(l.fortnight) === period),
    [ownerScopedLogs, period]
  );

  const displayLogs = useMemo(() => {
    const filtered = selectedVehicleId
      ? periodScopedLogs.filter((l) => l.vehicle_id === selectedVehicleId)
      : periodScopedLogs;
    return [...filtered].sort(sortLogs);
  }, [periodScopedLogs, selectedVehicleId]);

  // ── Summary totals — memoized (were plain inline calls before) ──
  const monthTotal   = useMemo(() => sumAmount(ownerScopedLogs), [ownerScopedLogs]);
  const half1Total   = useMemo(() => sumAmount(ownerScopedLogs.filter((l) => Number(l.fortnight) === 1)), [ownerScopedLogs]);
  const half2Total   = useMemo(() => sumAmount(ownerScopedLogs.filter((l) => Number(l.fortnight) === 2)), [ownerScopedLogs]);
  const currentTotal = useMemo(() => sumAmount(displayLogs), [displayLogs]);

  const transportTotals = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; litres: number }>();
    for (const log of periodScopedLogs) {
      const v = vehiclesById.get(log.vehicle_id);
      if (!v) continue;
      const owner = ownersById.get(v.transport_owner_id);
      const key = v.transport_owner_id;
      const ex = map.get(key) ?? { name: owner?.name ?? 'Unknown owner', amount: 0, litres: 0 };
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

  // ── Stable callbacks ──

  // triggerHaptic is pure with no deps — stable ref
  const triggerHaptic = useCallback((intensity: 'light' | 'strong' = 'light') => {
    Vibration.vibrate(intensity === 'strong' ? 16 : 8);
  }, []);

  const handleRefresh = useCallback(() => {
    void refetchVehicles();
    void refetchLogs();
  }, [refetchVehicles, refetchLogs]);

  const goToPrevMonth = useCallback(() => setMonth((m) => prevMonth(m)), []);
  const goToNextMonth = useCallback(() => setMonth((m) => nextMonth(m)), []);

  const selectOwner = useCallback((id: string) => {
    setSelectedOwnerId(id);
    setSelectedVehicleId(null);
    setOwnerSelectorCollapsed(true);
  }, []);

  const clearOwner = useCallback(() => {
    setSelectedOwnerId(null);
    setSelectedVehicleId(null);
  }, []);

  const expandOwnerSelector = useCallback(() => setOwnerSelectorCollapsed(false), []);

  const closeEditing = useCallback(() => setEditing(null), []);

  // ── commitDelete (stable — deps are stable setters + notice + queryClient) ──
  const commitDelete = useCallback(async (log: DieselLog, queryMonth: string, queryVehicleKey: string) => {
    setDeletingId(log.id);
    try {
      await softDeleteDieselLog(log.id, 'Removed from diesel logs screen');
      await invalidateDieselInsightsForMonth(queryMonth);
      await appendActivityEvent({ entity: 'diesel_log', action: 'deleted', label: log.date, details: `${round2(log.litres)}L` });
      void queryClient.invalidateQueries({ queryKey: ['dieselLogsMonth', queryMonth, queryVehicleKey] });
      void queryClient.invalidateQueries({ queryKey: ['homeSummary', queryMonth] });
      void queryClient.invalidateQueries({ queryKey: ['transportersSummary', queryMonth] });
    } catch (e) {
      queryClient.setQueryData<InfiniteData<DieselLog[]>>(
        ['dieselLogsMonth', queryMonth, queryVehicleKey],
        (prev) => {
          if (!prev) return prev;
          const newPages = [...prev.pages];
          if (newPages.length > 0) {
            if (!newPages[0].some((x) => x.id === log.id)) {
              newPages[0] = [log, ...newPages[0]].sort(sortLogs);
            }
          }
          return { ...prev, pages: newPages };
        }
      );
      notice.showError('Error', String(e));
    } finally {
      setDeletingId(null);
    }
  }, [queryClient, notice]);

  const onDeleteLog = useCallback(async (log: DieselLog) => {
    const token = `${log.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const queryMonth = month;
    const queryVehicleIdsKey = vehicleIdsKey;
    const expiresAt = Date.now() + 5000;

    queryClient.setQueryData<InfiniteData<DieselLog[]>>(
      ['dieselLogsMonth', queryMonth, queryVehicleIdsKey],
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map(page => page.filter(x => x.id !== log.id))
        };
      }
    );
    void invalidateDieselInsightsForMonth(queryMonth);
    setUndoQueue((prev) => [...prev, { token, log, queryMonth, queryVehicleIdsKey, expiresAt }]);
    notice.showInfo('Deleted', 'Entry removed. Tap Undo below within 5s to restore.');
    void appendActivityEvent({ entity: 'diesel_log', action: 'deleted', label: log.date, details: `Queued delete · ${round2(log.litres)}L` });

    undoTimeoutsRef.current[token] = setTimeout(() => {
      void commitDelete(log, queryMonth, queryVehicleIdsKey);
      setUndoQueue((prev) => prev.filter((x) => x.token !== token));
      delete undoTimeoutsRef.current[token];
    }, 5000);
  }, [month, vehicleIdsKey, queryClient, notice, commitDelete]);

  const onUndoDelete = useCallback(() => {
    const latest = undoQueue[undoQueue.length - 1];
    if (!latest) return;

    const timeoutId = undoTimeoutsRef.current[latest.token];
    if (timeoutId) {
      clearTimeout(timeoutId);
      delete undoTimeoutsRef.current[latest.token];
    }

    const restore = latest.log;
    queryClient.setQueryData<InfiniteData<DieselLog[]>>(
      ['dieselLogsMonth', latest.queryMonth, latest.queryVehicleIdsKey],
      (prev) => {
        if (!prev) return prev;
        const newPages = [...prev.pages];
        if (newPages.length > 0) {
          if (!newPages[0].some((x) => x.id === restore.id)) {
            newPages[0] = [restore, ...newPages[0]].sort(sortLogs);
          }
        }
        return { ...prev, pages: newPages };
      }
    );
    void invalidateDieselInsightsForMonth(latest.queryMonth);
    setUndoQueue((prev) => prev.filter((x) => x.token !== latest.token));
    void appendActivityEvent({ entity: 'diesel_log', action: 'restored', label: restore.date, details: `${round2(restore.litres)}L` });
    notice.showSuccess('Restored', 'Diesel entry restored.');
  }, [undoQueue, queryClient, notice]);

  const handleEditSaved = useCallback(async (updatedInput: { id: string; date: string; litres: number }) => {
    const previous = monthLogs.find((l) => l.id === updatedInput.id);
    if (previous) {
      const updatedMonth   = updatedInput.date.substring(0, 7);
      const nextFortnight  = getFortnight(updatedInput.date) as 1 | 2;
      const nextAmount     = round2(updatedInput.litres * globalSettings.diesel_sell_rate);
      const nextBuyAmount  = round2(updatedInput.litres * globalSettings.diesel_buy_rate);
      const nextProfit     = round2(nextAmount - nextBuyAmount);
      queryClient.setQueryData<InfiniteData<DieselLog[]>>(['dieselLogsMonth', month, vehicleIdsKey], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map(page => {
            if (updatedMonth !== month) return page.filter(x => x.id !== updatedInput.id);
            return page.map(x =>
              x.id !== updatedInput.id
                ? x
                : {
                    ...x,
                    date: updatedInput.date,
                    month: updatedMonth,
                    fortnight: nextFortnight,
                    litres: updatedInput.litres,
                    buy_rate: globalSettings.diesel_buy_rate,
                    sell_rate: globalSettings.diesel_sell_rate,
                    amount: nextAmount,
                    buy_amount: nextBuyAmount,
                    profit: nextProfit,
                  }
            );
          })
        };
      });
    }
    setEditing(null);
    const updatedMonth = updatedInput.date.substring(0, 7);
    void invalidateDieselInsightsForMonth(month);
    if (updatedMonth !== month) void invalidateDieselInsightsForMonth(updatedMonth);
    void refetchLogs();
    void queryClient.invalidateQueries({ queryKey: ['homeSummary', month] });
    void queryClient.invalidateQueries({ queryKey: ['transportersSummary', month] });
  }, [monthLogs, month, vehicleIdsKey, queryClient, refetchLogs]);

  // ── Effects ──

  useEffect(() => {
    const errorKey = [ownersError, vehiclesError, logsError]
      .filter(Boolean).map((e) => String(e)).join('|');
    if (!errorKey) { lastErrorNoticeKeyRef.current = ''; return; }
    if (lastErrorNoticeKeyRef.current === errorKey) return;
    lastErrorNoticeKeyRef.current = errorKey;
    notice.showError('Error', 'Could not load diesel logs right now.');
  }, [ownersError, vehiclesError, logsError, notice]);

  useEffect(() => {
    if (ownersLoading) return;
    if (!selectedOwnerId) return;
    if (!owners.some((o) => o.id === selectedOwnerId)) {
      setSelectedOwnerId(null);
      setSelectedVehicleId(null);
    }
  }, [owners, ownersLoading, selectedOwnerId]);

  useEffect(() => {
    if (!selectedOwnerId) setOwnerSelectorCollapsed(false);
  }, [selectedOwnerId]);

  useEffect(() => {
    if (vehiclesLoading) return;
    if (!selectedVehicleId) return;
    if (!ownerVehicles.some((v) => v.id === selectedVehicleId)) setSelectedVehicleId(null);
  }, [ownerVehicles, selectedVehicleId, vehiclesLoading]);

  // Restore persisted filters once
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
      } catch { /* ignore */ }
    };
    void restoreFilters();
  }, [hasInitialOwnerParam]);

  // Persist filters on change
  useEffect(() => {
    const saveFilters = async () => {
      try {
        await AsyncStorage.setItem(FILTERS_KEY, JSON.stringify({
          month, selectedOwnerId, selectedVehicleId, period, ownerSelectorCollapsed,
        }));
      } catch { /* ignore */ }
    };
    void saveFilters();
  }, [month, selectedOwnerId, selectedVehicleId, period, ownerSelectorCollapsed]);

  // Undo countdown timer
  useEffect(() => {
    if (undoCountdownTimerRef.current) {
      clearInterval(undoCountdownTimerRef.current);
      undoCountdownTimerRef.current = null;
    }
    if (!undoQueue.length) { setUndoCountdown(0); return; }

    const updateCountdown = () => {
      const latest = undoQueue[undoQueue.length - 1];
      setUndoCountdown(Math.max(0, Math.ceil((latest.expiresAt - Date.now()) / 1000)));
    };
    updateCountdown();
    undoCountdownTimerRef.current = setInterval(updateCountdown, 250);
    return () => {
      if (undoCountdownTimerRef.current) { clearInterval(undoCountdownTimerRef.current); undoCountdownTimerRef.current = null; }
    };
  }, [undoQueue]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      Object.values(undoTimeoutsRef.current).forEach(clearTimeout);
      undoTimeoutsRef.current = {};
      if (undoCountdownTimerRef.current) clearInterval(undoCountdownTimerRef.current);
    };
  }, []);

  // Hydrate cached insights when cacheKey changes
  useEffect(() => {
    const hydrateInsights = async () => {
      const cached = await readDieselInsights(insightsCacheKey);
      setCachedInsights(cached);
    };
    void hydrateInsights();
  }, [insightsCacheKey]);

  // Write fresh insights snapshot (no setCachedInsights to avoid loop)
  useEffect(() => {
    if (loading) return;
    const snapshot: DieselInsightsCache = {
      monthTotal, half1Total, half2Total, currentTotal,
      displayCount: displayLogs.length,
      transportTotals, vehicleTotals,
      updatedAt: new Date().toISOString(),
    };
    void writeDieselInsights(insightsCacheKey, snapshot);
  }, [loading, monthTotal, half1Total, half2Total, currentTotal, displayLogs.length, transportTotals, vehicleTotals, insightsCacheKey]);

  const effectiveInsights: DieselInsightsCache = useMemo(
    () => loading && cachedInsights
      ? cachedInsights
      : { monthTotal, half1Total, half2Total, currentTotal, displayCount: displayLogs.length, transportTotals, vehicleTotals, updatedAt: new Date().toISOString() },
    [loading, cachedInsights, monthTotal, half1Total, half2Total, currentTotal, displayLogs.length, transportTotals, vehicleTotals]
  );

  // ── Render ──
  return (
    <SafeAreaView style={s.root}>
      <View style={s.blobLeft} />
      <View style={s.blobRight} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="chevron-back" size={18} color="#111111" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Diesel Logs</Text>
        <View style={s.headerActions}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open activity history"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => router.push('/activity-history' as never)}
            style={s.iconBtn}
          >
            <Ionicons name="time-outline" size={16} color="#111111" />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Refresh diesel logs"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={handleRefresh} style={s.iconBtn}>
            <Ionicons name="refresh" size={16} color="#111111" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Month nav */}
      <View style={s.monthNav}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month"
          onPress={goToPrevMonth} style={s.monthNavBtn}>
          <Text style={s.monthNavText}>Prev</Text>
        </TouchableOpacity>
        <Text style={s.monthLabel}>{monthLabel(month)}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month"
          onPress={goToNextMonth} style={s.monthNavBtn}>
          <Text style={s.monthNavText}>Next</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        style={s.scroll}
        data={displayLogs}
        keyExtractor={(item) => item.id}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        onEndReached={() => {
          if (hasNextLogsPage && !logsFetchingNextPage) void fetchNextLogsPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={logsFetching && !logsFetchingNextPage && !loading} onRefresh={handleRefresh} tintColor="#ec4899" />
        }
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Owner filter */}
            <Text style={s.filterLabel}>Transport Owner</Text>
            {ownerSelectorCollapsed && selectedOwnerId ? (
              <View style={s.collapsedOwnerRow}>
                <View style={s.collapsedOwnerChip}>
                  <Chip text={ownersById.get(selectedOwnerId)?.name ?? 'Selected owner'} active onPress={() => {}} />
                </View>
                <TouchableOpacity onPress={expandOwnerSelector} style={s.changeBtn}>
                  <Text style={s.changeBtnText}>Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
                <Chip text="All" active={!selectedOwnerId} onPress={clearOwner} />
                {owners.map((o) => (
                  <Chip key={o.id} text={o.name} active={selectedOwnerId === o.id} onPress={() => selectOwner(o.id)} />
                ))}
              </ScrollView>
            )}

            {/* Vehicle filter */}
            <Text style={s.filterLabel}>Vehicle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
              <Chip text="All" active={!selectedVehicleId} onPress={() => setSelectedVehicleId(null)} />
              {ownerVehicles.map((v) => (
                <Chip key={v.id} text={v.reg_number} active={selectedVehicleId === v.id} onPress={() => setSelectedVehicleId(v.id)} />
              ))}
            </ScrollView>

            {/* Period filter */}
            <Text style={s.filterLabel}>Date Split</Text>
            <View style={s.periodRow}>
              <Chip text="Full month" active={period === 'all'} onPress={() => setPeriod('all')} />
              <Chip text="1-15"       active={period === '1'}   onPress={() => setPeriod('1')} />
              <Chip text="16-end"     active={period === '2'}   onPress={() => setPeriod('2')} />
            </View>

            {/* Loading skeletons */}
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
                {/* Summary card */}
                <View style={s.card}>
                  <Text style={s.cardSubLabel}>Month Wise Distributed</Text>
                  <Text style={s.summaryTotal}>₹{effectiveInsights.monthTotal.toLocaleString('en-IN')}</Text>
                  <View style={s.halfRow}>
                    <View style={s.halfCard}>
                      <Text style={s.halfLabel}>1-15</Text>
                      <Text style={s.halfValue}>₹{effectiveInsights.half1Total.toLocaleString('en-IN')}</Text>
                    </View>
                    <View style={s.halfCard}>
                      <Text style={s.halfLabel}>16-end</Text>
                      <Text style={s.halfValue}>₹{effectiveInsights.half2Total.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>
                  <Text style={s.filterSummaryText}>
                    Current filter total: ₹{effectiveInsights.currentTotal.toLocaleString('en-IN')} ({effectiveInsights.displayCount} logs)
                  </Text>
                  {!!cachedInsights && loading && (
                    <Text style={s.cachedNote}>Showing cached summary while refreshing...</Text>
                  )}
                </View>

                {/* Transport totals */}
                <View style={s.card}>
                  <Text style={s.cardTitle}>Transport-wise Totals</Text>
                  {effectiveInsights.transportTotals.length === 0
                    ? <Text style={s.emptyText}>No data for this filter.</Text>
                    : effectiveInsights.transportTotals.map((t) => (
                      <TotalRow key={t.name} primary={t.name} secondary={`${round2(t.litres).toLocaleString('en-IN')}L`} amount={round2(t.amount)} />
                    ))}
                </View>

                {/* Vehicle totals */}
                <View style={s.card}>
                  <Text style={s.cardTitle}>Vehicle-wise Totals</Text>
                  {effectiveInsights.vehicleTotals.length === 0
                    ? <Text style={s.emptyText}>No data for this filter.</Text>
                    : effectiveInsights.vehicleTotals.map((t) => (
                      <TotalRow
                        key={`${t.owner}-${t.reg}`}
                        primary={t.reg}
                        secondary={`${t.owner} · ${round2(t.litres).toLocaleString('en-IN')}L`}
                        amount={round2(t.amount)}
                      />
                    ))}
                </View>

                {/* Diesel entries list */}
                <View style={s.entriesHeader}>
                  <Text style={s.entriesTitle}>Diesel Entries</Text>
                  <Text style={s.swipeHint}>Swipe left for edit/delete</Text>
                </View>
              </>
            )}
          </>
        }
        ListEmptyComponent={
          (!loading || !!cachedInsights) && displayLogs.length === 0 ? (
            <View style={s.emptyCard}>
              <Text style={s.emptyCardTitle}>No diesel logs found</Text>
              <Text style={s.emptyCardSub}>Try another month, owner, vehicle, or date split.</Text>
            </View>
          ) : null
        }
        renderItem={({ item: log }) => (
          (!loading || !!cachedInsights) ? (
            <DieselLogCard
              log={log}
              vehicle={vehiclesById.get(log.vehicle_id)}
              owner={ownersById.get(vehiclesById.get(log.vehicle_id)?.transport_owner_id ?? '')}
              isDeleting={deletingId === log.id}
              isOpen={openSwipeId === log.id}
              swipeRef={(ref) => { swipeRefs.current[log.id] = ref; }}
              onWillOpen={() => {
                if (openSwipeId && openSwipeId !== log.id) swipeRefs.current[openSwipeId]?.close();
                setOpenSwipeId(log.id);
                triggerHaptic();
              }}
              onSwipeClose={() => { if (openSwipeId === log.id) setOpenSwipeId(null); }}
              onEdit={() => {
                triggerHaptic();
                swipeRefs.current[log.id]?.close();
                setEditing(log);
              }}
              onDelete={() => {
                triggerHaptic('strong');
                swipeRefs.current[log.id]?.close();
                void onDeleteLog(log);
              }}
              onPress={() => {
                triggerHaptic();
                if (openSwipeId === log.id) swipeRefs.current[log.id]?.close();
                setEditing(log);
              }}
            />
          ) : null
        )}
        ListFooterComponent={
          <View style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}>
            {logsFetchingNextPage && <ActivityIndicator color="#ec4899" />}
          </View>
        }
      />

      {/* Edit modal — conditionally mounted */}
      {!!editing && (
        <EditDieselLogModal
          log={editing}
          sellRate={globalSettings.diesel_sell_rate}
          buyRate={globalSettings.diesel_buy_rate}
          onClose={closeEditing}
          onSaved={handleEditSaved}
        />
      )}

      {/* Undo toast */}
      {undoQueue.length > 0 && (
        <View style={s.undoToast}>
          <Text style={s.undoText} numberOfLines={1}>
            Entry deleted · Undo {undoCountdown}s{undoQueue.length > 1 ? ` · +${undoQueue.length - 1} more` : ''}
          </Text>
          <TouchableOpacity
            onPress={onUndoDelete}
            accessibilityRole="button"
            accessibilityLabel={`Undo deleted diesel log${undoQueue.length > 1 ? ' entries' : ''}`}
            style={s.undoBtn}
          >
            <Text style={s.undoBtnText}>UNDO</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── DieselLogCard ────────────────────────────────────────────────────────────

interface DieselLogCardProps {
  log: DieselLog;
  vehicle: Vehicle | undefined;
  owner: TransportOwner | undefined;
  isDeleting: boolean;
  isOpen: boolean;
  swipeRef: (ref: Swipeable | null) => void;
  onWillOpen: () => void;
  onSwipeClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPress: () => void;
}

const DieselLogCard = React.memo(function DieselLogCard({
  log, vehicle, owner, isDeleting, swipeRef, onWillOpen, onSwipeClose, onEdit, onDelete, onPress,
}: DieselLogCardProps) {
  return (
    <Swipeable
      ref={swipeRef}
      friction={SWIPE_FRICTION}
      rightThreshold={SWIPE_RIGHT_THRESHOLD}
      dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}
      overshootRight={false}
      onSwipeableWillOpen={onWillOpen}
      onSwipeableClose={onSwipeClose}
      renderRightActions={() => (
        <View style={s.swipeActions}>
          <TouchableOpacity
            onPress={onEdit}
            accessibilityRole="button" accessibilityLabel="Edit diesel log"
            style={[s.swipeBtn, s.swipeBtnEdit]}
          >
            <Ionicons name="create-outline" size={16} color="#ffffff" />
            <Text style={s.swipeBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={isDeleting}
            onPress={onDelete}
            accessibilityRole="button" accessibilityLabel="Delete diesel log"
            style={[s.swipeBtn, s.swipeBtnDelete, isDeleting && s.swipeBtnDisabled]}
          >
            <Ionicons name="trash-outline" size={16} color="#ffffff" />
            <Text style={s.swipeBtnText}>{isDeleting ? '...' : 'Delete'}</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onPress}
        delayLongPress={220}
        style={s.logRow}
      >
        <View style={s.logRowLeft}>
          <Text style={s.logReg} numberOfLines={1}>{vehicle?.reg_number ?? 'Unknown vehicle'}</Text>
          <Text style={s.logOwner} numberOfLines={1}>{owner?.name ?? 'Unknown owner'}</Text>
          <Text style={s.logMeta}>{log.date} · {Number(log.fortnight) === 1 ? '1-15' : '16-end'} · {round2(Number(log.litres)).toLocaleString('en-IN')}L</Text>
        </View>
        <View style={s.logRowRight}>
          <Text style={s.logAmount}>₹{round2(Number(log.amount)).toLocaleString('en-IN')}</Text>
          <Text style={s.logTapHint}>tap to edit</Text>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
});

// ─── TotalRow ─────────────────────────────────────────────────────────────────

interface TotalRowProps { primary: string; secondary: string; amount: number }
const TotalRow = React.memo(function TotalRow({ primary, secondary, amount }: TotalRowProps) {
  return (
    <View style={s.totalRow}>
      <View style={s.totalRowLeft}>
        <Text style={s.totalPrimary} numberOfLines={1}>{primary}</Text>
        <Text style={s.totalSecondary} numberOfLines={1}>{secondary}</Text>
      </View>
      <Text style={s.totalAmount}>₹{amount.toLocaleString('en-IN')}</Text>
    </View>
  );
});

// ─── Chip ─────────────────────────────────────────────────────────────────────

interface ChipProps { text: string; active: boolean; onPress: () => void; accessibilityLabel?: string }
const Chip = React.memo(function Chip({ text, active, onPress, accessibilityLabel }: ChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Filter option ${text}${active ? ', selected' : ''}`}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipText, active && s.chipTextActive]} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
  );
});

// ─── EditDieselLogModal ───────────────────────────────────────────────────────

interface EditDieselLogModalProps {
  log: DieselLog | null;
  sellRate: number;
  buyRate: number;
  onClose: () => void;
  onSaved: (updated: { id: string; date: string; litres: number }) => Promise<void>;
}

function EditDieselLogModal({ log, sellRate, buyRate, onClose, onSaved }: EditDieselLogModalProps) {
  const [date, setDate]     = useState('');
  const [litres, setLitres] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  useEffect(() => {
    if (!log) return;
    setDate(log.date);
    setLitres(String(log.litres));
  }, [log]);

  const save = useCallback(async () => {
    if (!log) return;
    const l = parseFloat(litres);
    if (!date || Number.isNaN(l) || l <= 0) {
      notice.showInfo('Invalid', 'Enter valid date and litres');
      return;
    }
    setSaving(true);
    try {
      await updateDieselLog({ id: log.id, date, litres: l, buy_rate: buyRate, sell_rate: sellRate });
      await appendActivityEvent({ entity: 'diesel_log', action: 'edited', label: date, details: `${round2(l)}L` });
      notice.showSuccess('Saved', 'Diesel log updated.');
      await onSaved({ id: log.id, date, litres: l });
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  }, [log, date, litres, onSaved, notice]);

  const amount = useMemo(
    () => !Number.isNaN(parseFloat(litres)) ? round2(parseFloat(litres) * sellRate) : 0,
    [litres, sellRate]
  );

  return (
    <Modal visible={!!log} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.modalBackdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={s.modalSheet}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Edit Diesel Log</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.modalClose}>Close</Text></TouchableOpacity>
          </View>

          <ThemedDateField label="Date" value={date} onChange={setDate} required />

          <ThemedTextInput
            label="Litres"
            keyboardType="decimal-pad"
            value={litres}
            onChangeText={setLitres}
            placeholder="e.g. 207.76"
          />

          <View style={s.amountPreview}>
            <Text style={s.amountPreviewLabel}>Distributed amount at ₹{sellRate}/L</Text>
            <Text style={s.amountPreviewValue}>₹{amount.toLocaleString('en-IN')}</Text>
          </View>

          <TouchableOpacity
            onPress={() => { void save(); }}
            disabled={saving}
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
          >
            <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Layout
  root:   { flex: 1, backgroundColor: '#fff7fb' },
  scroll: { flex: 1, paddingHorizontal: 16 },

  // Decorative blobs
  blobLeft:  { position: 'absolute', top: 24, left: -48, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' },
  blobRight: { position: 'absolute', top: 220, right: -62, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' },

  // Header
  header:      { paddingHorizontal: 16, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: '#111111', fontSize: 20, fontWeight: '800' },
  iconBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center' },

  // Month nav
  monthNav:    { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthNavBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#f2d7e6', backgroundColor: '#ffffffcc' },
  monthNavText:{ color: '#111111', fontWeight: '700' },
  monthLabel:  { color: '#111111', fontSize: 16, fontWeight: '800' },

  // Filters
  filterLabel:       { color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow:           { marginBottom: 10 },
  periodRow:         { flexDirection: 'row', marginBottom: 12 },
  collapsedOwnerRow: { marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapsedOwnerChip:{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
  changeBtn:         { backgroundColor: '#ffffffcc', borderWidth: 1, borderColor: '#f2d7e6', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  changeBtnText:     { color: '#111111', fontWeight: '700', fontSize: 12 },

  // Chip
  chip:         { marginRight: 8, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#f2d7e6', backgroundColor: '#ffffffcc' },
  chipActive:   { borderColor: '#d9468f', backgroundColor: '#d9468f' },
  chipText:     { color: '#111111', fontWeight: '700' },
  chipTextActive:{ color: '#ffffff' },

  // Cards
  card:         { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  cardSubLabel: { color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  cardTitle:    { color: '#111111', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  summaryTotal: { color: '#111111', fontSize: 22, fontWeight: '800', marginTop: 4 },
  halfRow:      { flexDirection: 'row', marginTop: 10, gap: 8 },
  halfCard:     { flex: 1, backgroundColor: '#fff7fb', borderWidth: 1, borderColor: '#f2d7e6', borderRadius: 12, padding: 10 },
  halfLabel:    { color: '#6b5c67', fontSize: 11 },
  halfValue:    { color: '#111111', fontWeight: '800', marginTop: 2 },
  filterSummaryText: { color: '#6b5c67', fontSize: 12, marginTop: 10 },
  cachedNote:   { color: '#8d7a86', fontSize: 11, marginTop: 4 },
  emptyText:    { color: '#6b5c67' },

  // Total rows
  totalRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  totalRowLeft:  { flex: 1, paddingRight: 10 },
  totalPrimary:  { color: '#111111', fontWeight: '700' },
  totalSecondary:{ color: '#6b5c67', fontSize: 11 },
  totalAmount:   { color: '#111111', fontWeight: '800' },

  // Entries list header
  entriesHeader: { marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entriesTitle:  { color: '#111111', fontSize: 16, fontWeight: '800' },
  swipeHint:     { color: '#8d7a86', fontSize: 12 },

  // Empty state card
  emptyCard:    { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  emptyCardTitle:{ color: '#111111', fontWeight: '700' },
  emptyCardSub: { color: '#6b5c67', marginTop: 4 },

  // Swipe actions
  swipeActions:   { flexDirection: 'row', marginBottom: 8 },
  swipeBtn:       { width: 78, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swipeBtnEdit:   { marginRight: 6, backgroundColor: '#db2777' },
  swipeBtnDelete: { backgroundColor: '#ef4444' },
  swipeBtnDisabled:{ opacity: 0.6 },
  swipeBtnText:   { color: '#ffffff', fontSize: 11, marginTop: 3, fontWeight: '700' },

  // Diesel log row
  logRow:     { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  logRowLeft: { flex: 1, paddingRight: 10 },
  logRowRight:{ alignItems: 'flex-end' },
  logReg:     { color: '#111111', fontWeight: '800' },
  logOwner:   { color: '#6b5c67', fontSize: 11 },
  logMeta:    { color: '#6b5c67', fontSize: 11, marginTop: 2 },
  logAmount:  { color: '#111111', fontWeight: '800' },
  logTapHint: { color: '#8d7a86', fontSize: 11 },

  // Undo toast
  undoToast:   { position: 'absolute', left: 16, right: 16, bottom: 18, backgroundColor: '#111111ee', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  undoText:    { color: '#ffffff', fontWeight: '600', flex: 1, marginRight: 12 },
  undoBtn:     { backgroundColor: '#ffffff22', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  undoBtnText: { color: '#ffffff', fontWeight: '800' },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: '#fff7fb', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: '#f2d7e6', padding: 16 },
  modalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle:    { color: '#111111', fontSize: 18, fontWeight: '800' },
  modalClose:    { color: '#db2777', fontWeight: '700' },
  fieldLabel:    { color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  textInput:     { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', color: '#111111', borderRadius: 10, padding: 12 },
  amountPreview: { backgroundColor: '#fff0f7', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 12 },
  amountPreviewLabel: { color: '#6b5c67', fontSize: 11 },
  amountPreviewValue: { color: '#111111', fontWeight: '800', fontSize: 16 },
  saveBtn:       { backgroundColor: '#d9468f', borderRadius: 12, padding: 14, alignItems: 'center' },
  saveBtnDisabled:{ backgroundColor: '#d4d4d8' },
  saveBtnText:   { color: '#ffffff', fontWeight: '800' },
});
