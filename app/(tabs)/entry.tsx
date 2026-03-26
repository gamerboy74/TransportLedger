import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../../constants/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import ThemedDateField from '../../components/ThemedDateField';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import { getVehicles, addDieselLog, addTripEntry, addChallanEntry, getChallanEntries, deleteChallanEntry } from '../../lib/queries';
import { appendActivityEvent } from '../../lib/activityHistory';
import { fetchEntryBootstrap } from '../../lib/summaries';
import { monthKey, monthLabel, round2, prevMonth, nextMonth } from '../../constants/defaults';
import type { TransportOwner, Vehicle, Route, GlobalSettings } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { ThemedTextInput } from '../../components/ThemedTextInput';
import UnifiedHeader from '../../components/UnifiedHeader';

export default function EntryScreen() {
  const [tab, setTab] = useState<'diesel' | 'trip' | 'challan'>('diesel');
  const {
    globalActiveOwnerId,
    globalActiveVehicleId,
    setGlobalActiveOwnerId,
    setGlobalActiveVehicleId,
    globalSettings,
  } = useAppStore();

  const listRef = useRef<ScrollView | null>(null);
  const queryClient = useQueryClient();
  const notice = useThemedNotice();

  const { data: bootstrapData, isLoading, isFetching: isBootstrapFetching, error: bootstrapError, refetch: refetchBootstrap } = useQuery({
    queryKey: ['entryBootstrap'],
    queryFn: fetchEntryBootstrap,
  });

  const owners = bootstrapData?.owners ?? [];
  const routes = bootstrapData?.routes ?? [];
  const selOwner = owners.find(o => o.id === globalActiveOwnerId) || null;

  const { data: ownerVehicles = [], isFetching: isVehiclesFetching, error: vehiclesError, refetch: refetchVehicles } = useQuery({
    queryKey: ['ownerVehicles', selOwner?.id ?? 'none'],
    queryFn: () => getVehicles(selOwner!.id),
    enabled: !!selOwner,
  });

  const vehicles = ownerVehicles;
  const selVehicle = vehicles.find(v => v.id === globalActiveVehicleId) || null;
  const loading = isLoading;
  const refreshing = (isBootstrapFetching && !isLoading) || isVehiclesFetching;

  useEffect(() => {
    if (bootstrapError) notice.showError('Error', 'Could not refresh quick entry data.');
  }, [bootstrapError, notice]);

  useEffect(() => {
    if (vehiclesError && selOwner) notice.showError('Error', 'Could not load vehicles for this owner.');
  }, [vehiclesError, selOwner, notice]);

  useEffect(() => {
    if (!selOwner && globalActiveOwnerId) {
      const ownerStillExists = owners.find((o) => o.id === globalActiveOwnerId);
      if (!ownerStillExists && owners.length > 0) {
        setGlobalActiveOwnerId(null);
      }
    }
  }, [owners, globalActiveOwnerId, setGlobalActiveOwnerId, selOwner]);

  useEffect(() => {
    if (globalActiveVehicleId && selOwner && vehicles.length > 0) {
      if (!vehicles.some((v) => v.id === globalActiveVehicleId)) {
        setGlobalActiveVehicleId(null);
      }
    }
  }, [vehicles, globalActiveVehicleId, setGlobalActiveVehicleId, selOwner]);

  const pickOwner = (owner: TransportOwner) => {
    setGlobalActiveOwnerId(owner.id);
  };

  useFocusEffect(
    useCallback(() => {
      listRef.current?.scrollTo({ y: 0, animated: false });
    }, [])
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.bgCircle1} />
      <View style={styles.bgCircle2} />

      <UnifiedHeader />

      <View style={styles.titleSection}>
        <Text style={styles.title}>Quick Entry</Text>
        <Text style={styles.subtitle}>{monthLabel(monthKey())}</Text>
      </View>

      {/* Tab */}
      <View style={styles.tabContainer}>
        {(['diesel', 'trip', 'challan'] as const).map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[
            styles.tabItem,
            tab === t && styles.tabItemActive
          ]}>
            <Text style={[
              styles.tabText,
              tab === t && styles.tabTextActive
            ]}>
              {t === 'diesel' ? '⛽ Diesel' : t === 'trip' ? '🗺 Trip' : '🧾 Challan'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        ref={listRef}
        style={{ flex: 1, padding: 16 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refetchBootstrap(); if (selOwner) void refetchVehicles(); }} tintColor={Theme.colors.light.primary} />}
      >
        {loading && (
          <>
            <SkeletonCard>
              <SkeletonBlock style={styles.skeletonLabel} />
              <View style={styles.rowGap}>
                <SkeletonBlock style={styles.skeletonChip} />
                <SkeletonBlock style={styles.skeletonChip} />
                <SkeletonBlock style={styles.skeletonChip} />
              </View>
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={styles.skeletonLabelSmall} />
              <SkeletonBlock style={styles.skeletonInput} />
              <SkeletonBlock style={styles.skeletonInput} />
              <SkeletonBlock style={styles.skeletonInput} />
            </SkeletonCard>
          </>
        )}

        {!loading && (
          <>
        {/* Owner chips */}
        <Text style={styles.sectionLabel}>Transport Owner</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {owners.map(o => (
            <TouchableOpacity key={o.id} onPress={() => pickOwner(o)} style={[
              styles.chip,
              selOwner?.id === o.id && styles.chipActive
            ]}>
              <Text style={[styles.chipText, selOwner?.id === o.id && styles.chipTextActive]}>
                {o.name.split(' ').slice(0, 2).join(' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Vehicle chips */}
        {selOwner && (
          <>
            <Text style={styles.sectionLabel}>Vehicle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {vehicles.map(v => (
                <TouchableOpacity key={v.id} onPress={() => setGlobalActiveVehicleId(v.id)} style={[
                  styles.chip,
                  selVehicle?.id === v.id && styles.chipActive
                ]}>
                  <Text style={[styles.chipText, selVehicle?.id === v.id && styles.chipTextActive]}>
                    {v.reg_number}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {vehicles.length === 0 && (
              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>No vehicles for this owner yet</Text>
                <Text style={styles.infoCardSub}>Open owner profile and add at least one vehicle to enable entry.</Text>
              </View>
            )}

            {tab === 'diesel' && (
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/diesel-logs', params: { ownerId: selOwner.id, vehicleId: selVehicle?.id ?? '', month: monthKey() } })}
                style={styles.fullScreenLink}
              >
                <View style={styles.fullScreenLinkContent}>
                  <View style={styles.fullScreenLinkIcon}>
                    <Ionicons name="list" size={14} color={Theme.colors.light.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fullScreenLinkTitle} numberOfLines={1}>Open Diesel Logs Full Screen</Text>
                    <Text style={styles.fullScreenLinkSub} numberOfLines={1}>Edit logs and view month/date/vehicle/transport totals</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Theme.colors.light.muted} />
              </TouchableOpacity>
            )}

            {tab === 'trip' && (
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/trip-history' as any, params: { vehicleId: selVehicle?.id ?? '', month: monthKey(), ownerId: selOwner.id } })}
                style={styles.fullScreenLink}
              >
                <View style={styles.fullScreenLinkContent}>
                  <View style={styles.fullScreenLinkIcon}>
                    <Ionicons name="time-outline" size={14} color={Theme.colors.light.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fullScreenLinkTitle} numberOfLines={1}>View Trip History</Text>
                    <Text style={styles.fullScreenLinkSub} numberOfLines={1}>Edit or delete existing trip entries</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Theme.colors.light.muted} />
              </TouchableOpacity>
            )}

            {tab === 'challan' && (
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/challan-logs',
                    params: { vehicleId: selVehicle?.id ?? '', month: monthKey() },
                  } as never)
                }
                style={styles.fullScreenLink}
              >
                <View style={styles.fullScreenLinkContent}>
                  <View style={styles.fullScreenLinkIcon}>
                    <Ionicons name="list-outline" size={14} color={Theme.colors.light.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fullScreenLinkTitle} numberOfLines={1}>View Challan Logs</Text>
                    <Text style={styles.fullScreenLinkSub} numberOfLines={1}>Browse and manage all challan entries</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Theme.colors.light.muted} />
              </TouchableOpacity>
            )}
          </>
        )}

        {selVehicle && tab === 'diesel' && (
          <DieselForm 
            vehicle={selVehicle} 
            settings={globalSettings}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['homeSummary'] });
              void queryClient.invalidateQueries({ queryKey: ['transportersSummary'] });
            }} 
          />
        )}
        {selVehicle && tab === 'trip' && (
          <TripForm vehicle={selVehicle} routes={routes} onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['homeSummary'] });
            void queryClient.invalidateQueries({ queryKey: ['transportersSummary'] });
          }} />
        )}
        {selOwner && tab === 'challan' && selVehicle && (
          <ChallanForm vehicle={selVehicle} currentMonth={monthKey()} />
        )}

        {!selOwner && (
          <View style={styles.emptyOwnerState}>
            <Text style={styles.emptyOwnerEmoji}>☝️</Text>
            <Text style={styles.emptyOwnerText}>
              Select a transport owner to start entering data
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/transporters')}
              style={styles.emptyOwnerButton}
            >
              <Text style={styles.emptyOwnerButtonText}>Go To Owners</Text>
            </TouchableOpacity>
          </View>
        )}
          </>
        )}
        <View style={{ height: 64 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const DieselForm = React.memo(function DieselForm({ vehicle, settings, onSaved }: { vehicle: Vehicle; settings: GlobalSettings; onSaved: () => void }) {
  const sellRate = settings.diesel_sell_rate;
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0]);
  const [litres, setLitres] = useState('');
  const [debouncedLitres, setDebouncedLitres] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  // Debounce calculation to keep input responsive
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedLitres(litres);
    }, 150);
    return () => clearTimeout(handler);
  }, [litres]);

  const save = async () => {
    const l = parseFloat(litres);
    if (isNaN(l) || l <= 0) { notice.showInfo('Invalid', 'Enter valid litres'); return; }
    setSaving(true);
    try {
      await addDieselLog({ 
        vehicle_id: vehicle.id, 
        date, 
        litres: l, 
        buy_rate: settings.diesel_buy_rate, 
        sell_rate: settings.diesel_sell_rate 
      });
      await appendActivityEvent({ entity: 'diesel_log', action: 'created', label: date, details: `${vehicle.reg_number} · ${round2(l)}L` });
      notice.showSuccess('Saved', `${l}L charged to ${vehicle.reg_number}\n₹${round2(l * sellRate).toLocaleString('en-IN')} deducted`);
      setLitres(''); onSaved();
    } catch (e) { notice.showError('Error', String(e)); }
    finally { setSaving(false); }
  };

  const cost = useMemo(() => {
    const l = parseFloat(debouncedLitres);
    return isNaN(l) ? 0 : round2(l * sellRate);
  }, [debouncedLitres, sellRate]);

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>
        ⛽ Diesel — {vehicle.reg_number}
      </Text>
      <ThemedDateField label="Date" value={date} onChange={setDate} required />
      <ThemedTextInput 
        label="Litres" 
        value={litres} 
        onChangeText={setLitres} 
        placeholder="e.g. 207.76" 
        keyboardType="decimal-pad" 
      />
      {!!debouncedLitres && !isNaN(parseFloat(debouncedLitres)) && (
        <View style={styles.calcPreview}>
          <Text style={styles.calcLabel}>Deduction at ₹{sellRate}/L</Text>
          <Text style={styles.calcValue}>
            ₹{cost.toLocaleString('en-IN')}
          </Text>
        </View>
      )}
      <TouchableOpacity 
        onPress={save} 
        disabled={saving}
        style={[styles.saveButton, saving && styles.buttonDisabled]}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Diesel Entry'}</Text>
      </TouchableOpacity>
    </View>
  );
});

const TripForm = React.memo(function TripForm({ vehicle, routes, onSaved }: { vehicle: Vehicle; routes: Route[]; onSaved: () => void }) {
  const [selRoute, setSelRoute] = useState<Route | null>(null);
  const [tonnes, setTonnes]     = useState('');
  const [debouncedTonnes, setDebouncedTonnes] = useState('');
  const [month, setMonth]       = useState(monthKey());
  const [saving, setSaving]     = useState(false);
  const notice = useThemedNotice();

  // Debounce calculation to keep input responsive
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTonnes(tonnes);
    }, 150);
    return () => clearTimeout(handler);
  }, [tonnes]);

  const save = async () => {
    if (!selRoute) { notice.showInfo('Required', 'Select a route'); return; }
    const t = parseFloat(tonnes);
    if (isNaN(t) || t <= 0) { notice.showInfo('Invalid', 'Enter valid tonnes'); return; }
    if (!/^\d{4}-\d{2}$/.test(month)) { notice.showInfo('Invalid', 'Month must be in YYYY-MM format'); return; }
    const monthPart = Number(month.split('-')[1]);
    if (monthPart < 1 || monthPart > 12) { notice.showInfo('Invalid', 'Enter a valid month between 01 and 12'); return; }
    setSaving(true);
    try {
      await addTripEntry({ vehicle_id: vehicle.id, route_id: selRoute.id, month, tonnes: t, rate_snapshot: selRoute.rate_per_tonne });
      await appendActivityEvent({ entity: 'trip_entry', action: 'created', label: month, details: `${vehicle.reg_number} · ${selRoute.name} · ${round2(t)}T` });
      notice.showSuccess('Saved', `${t}T on ${selRoute.name}\n₹${round2(t * selRoute.rate_per_tonne).toLocaleString('en-IN')}`);
      setTonnes(''); onSaved();
    } catch (e) { notice.showError('Error', String(e)); }
    finally { setSaving(false); }
  };

  const earning = useMemo(() => {
    const t = parseFloat(debouncedTonnes);
    return (isNaN(t) || !selRoute) ? 0 : round2(t * selRoute.rate_per_tonne);
  }, [debouncedTonnes, selRoute]);

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>
        🗺 Trip — {vehicle.reg_number}
      </Text>
      
      <Text style={styles.sectionLabel}>Route</Text>
      {routes.map(r => (
        <TouchableOpacity key={r.id} onPress={() => setSelRoute(r)} style={[
          styles.routeItem,
          selRoute?.id === r.id && styles.routeItemActive
        ]}>
          <Text style={[styles.routeText, selRoute?.id === r.id && styles.routeTextActive]}>{r.name}</Text>
          <Text style={[styles.routeRate, selRoute?.id === r.id && styles.routeRateActive]}>₹{r.rate_per_tonne}/T</Text>
        </TouchableOpacity>
      ))}
      
      {routes.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No routes found</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/reports')} style={{ marginTop: 8 }}>
            <Text style={styles.linkText}>Add route in Reports tab</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.sectionLabel}>Entry Month</Text>
      <View style={styles.monthNav}>
        <TouchableOpacity
          onPress={() => setMonth(prevMonth(month))}
          style={styles.monthNavButton}
        >
          <Ionicons name="chevron-back" size={20} color={Theme.colors.light.primary} />
        </TouchableOpacity>
        
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.monthName}>{monthLabel(month)}</Text>
          <Text style={styles.monthSublabel}>Selected Month</Text>
        </View>

        <TouchableOpacity
          onPress={() => setMonth(nextMonth(month))}
          style={styles.monthNavButton}
        >
          <Ionicons name="chevron-forward" size={20} color={Theme.colors.light.primary} />
        </TouchableOpacity>
      </View>

      <ThemedTextInput 
        label="Tonnes" 
        value={tonnes} 
        onChangeText={setTonnes} 
        placeholder="e.g. 1609.24" 
        keyboardType="decimal-pad" 
      />

      {!!debouncedTonnes && selRoute && !isNaN(parseFloat(debouncedTonnes)) && (
        <View style={styles.calcPreview}>
          <Text style={styles.calcLabel}>Gross earning</Text>
          <Text style={styles.calcValue}>
            ₹{earning.toLocaleString('en-IN')}
          </Text>
        </View>
      )}

      <TouchableOpacity 
        onPress={save} 
        disabled={saving}
        style={[styles.saveButton, saving && styles.buttonDisabled]}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Trip Entry'}</Text>
      </TouchableOpacity>
    </View>
  );
});

// ─── ChallanForm ──────────────────────────────────────────────
// Lightweight form — only the fields needed for the Excel sheet

const ChallanForm = React.memo(function ChallanForm({ vehicle, currentMonth }: { vehicle: Vehicle; currentMonth: string }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Form state
  const [date, setDate]               = useState(todayStr);
  const [challanNo, setChallanNo]     = useState('');
  const [grossKg, setGrossKg]         = useState('');
  const [tareKg, setTareKg]           = useState('');
  const [netKg, setNetKg]             = useState('');
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [saving, setSaving]           = useState(false);

  // Saved entries for this vehicle + month (for duplicate check + month total)
  const [entries, setEntries]     = useState<import('../../lib/queries').ChallanEntry[]>([]);
  const notice = useThemedNotice();

  // Total net for the month
  const monthTotalKg = entries.reduce((s, c) => s + Number(c.net_weight_kg ?? 0), 0);

  // Load work order from AsyncStorage once on mount (keyed per owner)
  const WO_KEY = `@challan_wo:${vehicle.transport_owner_id}`;
  useEffect(() => {
    void AsyncStorage.getItem(WO_KEY).then(v => { setWorkOrderNo(v || ''); });
  }, [WO_KEY]);

  // Load saved entries for this vehicle/month
  const loadEntries = useCallback(async () => {
    try {
      const list = await getChallanEntries(vehicle.id, currentMonth);
      setEntries(list);
    } catch { /* silent */ }
  }, [vehicle.id, currentMonth]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  // Auto-calc net = gross − tare with debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      const g = parseFloat(grossKg), t = parseFloat(tareKg);
      if (!isNaN(g) && !isNaN(t) && g > t) {
        setNetKg(String(g - t));
      }
    }, 150);
    return () => clearTimeout(handler);
  }, [grossKg, tareKg]);

  const handleGross = useCallback((v: string) => setGrossKg(v), []);
  const handleTare = useCallback((v: string) => setTareKg(v), []);

  // ── Duplicate check ────────────────────────────────────────────
  const isDuplicate = useCallback((cn: string): boolean => {
    if (!cn.trim()) return false;
    return entries.some(
      e => e.challan_no?.trim().toLowerCase() === cn.trim().toLowerCase()
    );
  }, [entries]);

  // ── Save ──────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      notice.showInfo('Required', 'Enter date as YYYY-MM-DD'); return;
    }
    if (!netKg || isNaN(parseFloat(netKg)) || parseFloat(netKg) <= 0) {
      notice.showInfo('Required', 'Enter or calculate a valid Net Weight'); return;
    }

    if (challanNo.trim() && isDuplicate(challanNo)) {
      Alert.alert(
        'Duplicate Challan',
        `Challan No "${challanNo.trim()}" already exists for this vehicle this month. Save anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save Anyway', style: 'destructive', onPress: () => void doSave() },
        ],
      );
      return;
    }
    void doSave();
  }, [date, netKg, challanNo, isDuplicate]);

  const doSave = async () => {
    const month = date.slice(0, 7);
    setSaving(true);
    if (workOrderNo.trim()) {
      void AsyncStorage.setItem(WO_KEY, workOrderNo.trim());
    }
    try {
      const entry = await addChallanEntry({
        vehicle_id:      vehicle.id,
        month,
        trip_date:       date,
        challan_no:      challanNo.trim() || null,
        vehicle_no:      vehicle.reg_number,
        tr_no:           workOrderNo.trim() || null,
        transporter:     null,
        destination:     null,
        source:          null,
        gross_weight_kg: grossKg ? Number(grossKg) : null,
        tare_weight_kg:  tareKg  ? Number(tareKg)  : null,
        net_weight_kg:   Number(netKg),
      });
      setEntries(prev => [...prev, entry].sort((a, b) => a.trip_date.localeCompare(b.trip_date)));
      notice.showSuccess('Saved', `Challan saved · ${(Number(netKg) / 1000).toFixed(3)} T`);
      setChallanNo(''); setGrossKg(''); setTareKg(''); setNetKg('');
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  };

  const dupWarning = challanNo.trim() && isDuplicate(challanNo);

  return (
    <View style={styles.formCard}>
      {/* Header */}
      <View style={styles.challanHeader}>
        <Text style={styles.formTitle}>
          🧾 Challan — {vehicle.reg_number}
        </Text>
        {monthTotalKg > 0 && (
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeText}>
              {(monthTotalKg / 1000).toFixed(3)} T
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.sectionLabel}>Metadata</Text>
      <View style={{ marginBottom: Theme.spacing.md }}>
        <View style={styles.labelSubRow}>
          <Text style={styles.labelSubText}>Work Order No</Text>
          {!workOrderNo.trim() && (
            <Text style={styles.warningHint}>⚠ Set once for this owner</Text>
          )}
        </View>
        <ThemedTextInput
          value={workOrderNo}
          onChangeText={setWorkOrderNo}
          placeholder="e.g. 0429"
          autoCapitalize="characters"
        />
      </View>

      <ThemedDateField label="Date" value={date} onChange={setDate} required />

      <View style={{ marginBottom: Theme.spacing.md }}>
        <View style={styles.labelSubRow}>
          <Text style={styles.labelSubText}>Challan No</Text>
          {dupWarning && (
            <Text style={[styles.warningHint, { color: Theme.colors.light.error }]}>⚠ Duplicate!</Text>
          )}
        </View>
        <ThemedTextInput
          value={challanNo}
          onChangeText={setChallanNo}
          placeholder="e.g. C92501775/877"
          autoCapitalize="characters"
          error={dupWarning ? 'Duplicate Challan No' : undefined}
        />
      </View>

      <Text style={styles.sectionLabel}>Weights (Kg)</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: Theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <ThemedTextInput
             label="Gross (Kg)"
             value={grossKg} onChangeText={handleGross}
             placeholder="56050" keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedTextInput
            label="Tare (Kg)"
            value={tareKg} onChangeText={handleTare}
            placeholder="16800" keyboardType="decimal-pad"
          />
        </View>
      </View>

      <ThemedTextInput
        label="Net Weight (Kg) *"
        value={netKg} onChangeText={setNetKg}
        placeholder="Auto-calculated from Gross − Tare"
        keyboardType="decimal-pad"
      />

      {!!netKg && !isNaN(parseFloat(netKg)) && parseFloat(netKg) > 0 && (
        <View style={styles.calcPreview}>
          <Text style={styles.calcLabel}>Net in tonnes</Text>
          <Text style={styles.calcValue}>
            {(parseFloat(netKg) / 1000).toFixed(3)} T
          </Text>
        </View>
      )}

      <TouchableOpacity
        onPress={save}
        disabled={saving}
        style={[styles.saveButton, saving && styles.buttonDisabled, { marginBottom: Theme.spacing.md }]}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Challan'}</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Theme.colors.light.background },
  bgCircle1: { position: 'absolute', top: 12, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' },
  bgCircle2: { position: 'absolute', top: 140, right: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' },
  headerRow: { paddingHorizontal: Theme.spacing.lg, paddingTop: Theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatarContainer: { width: 34, height: 34, borderRadius: 17, backgroundColor: Theme.colors.light.white, borderWidth: 1, borderColor: Theme.colors.light.border, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 16 },
  topActions: { flexDirection: 'row', gap: Theme.spacing.sm },
  iconButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: Theme.colors.light.white, borderWidth: 1, borderColor: Theme.colors.light.border, alignItems: 'center', justifyContent: 'center' },
  titleSection: { paddingHorizontal: Theme.spacing.lg, paddingTop: Theme.spacing.xs, paddingBottom: Theme.spacing.sm },
  title: { color: Theme.colors.light.text, fontSize: Theme.typography.sizes.title, fontWeight: Theme.typography.weights.bold },
  subtitle: { color: Theme.colors.light.subtext, fontSize: Theme.typography.sizes.caption, marginTop: 2 },
  tabContainer: { flexDirection: 'row', marginHorizontal: Theme.spacing.lg, backgroundColor: Theme.colors.light.card, borderRadius: Theme.borderRadius.lg, padding: 4, borderWidth: 1, borderColor: Theme.colors.light.border },
  tabItem: { flex: 1, paddingVertical: 11, borderRadius: Theme.borderRadius.md, alignItems: 'center' },
  tabItemActive: { backgroundColor: Theme.colors.light.secondary },
  tabText: { color: Theme.colors.light.subtext, fontWeight: Theme.typography.weights.bold, fontSize: Theme.typography.sizes.caption },
  tabTextActive: { color: Theme.colors.light.white },
  formCard: { backgroundColor: Theme.colors.light.card, borderColor: Theme.colors.light.border, borderWidth: 1, borderRadius: Theme.borderRadius.lg, padding: Theme.spacing.lg },
  formTitle: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.bold, fontSize: Theme.typography.sizes.subheading, marginBottom: Theme.spacing.lg },
  calcPreview: { backgroundColor: Theme.colors.light.background, borderColor: Theme.colors.light.border, borderWidth: 1, borderRadius: Theme.borderRadius.md, padding: Theme.spacing.md, marginBottom: Theme.spacing.md },
  calcLabel: { color: Theme.colors.light.subtext, fontSize: Theme.typography.sizes.caption },
  calcValue: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.bold, fontSize: Theme.typography.sizes.subheading },
  saveButton: { backgroundColor: Theme.colors.light.secondary, borderRadius: Theme.borderRadius.md, padding: Theme.spacing.md, alignItems: 'center' },
  buttonDisabled: { backgroundColor: Theme.colors.light.disabled },
  saveButtonText: { color: Theme.colors.light.white, fontWeight: Theme.typography.weights.bold },
  sectionLabel: { color: Theme.colors.light.subtext, fontSize: Theme.typography.sizes.tiny, fontWeight: Theme.typography.weights.bold, marginBottom: Theme.spacing.sm, textTransform: 'uppercase', letterSpacing: 0.7 },
  routeItem: { marginBottom: Theme.spacing.sm, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.md, borderRadius: Theme.borderRadius.md, backgroundColor: Theme.colors.light.white, borderWidth: 1, borderColor: Theme.colors.light.border, flexDirection: 'row', justifyContent: 'space-between' },
  routeItemActive: { backgroundColor: Theme.colors.light.secondary, borderColor: Theme.colors.light.secondary },
  routeText: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.semibold },
  routeTextActive: { color: Theme.colors.light.white },
  routeRate: { color: Theme.colors.light.subtext },
  routeRateActive: { color: '#ffe4ef' },
  emptyCard: { backgroundColor: Theme.colors.light.white, borderColor: Theme.colors.light.border, borderWidth: 1, borderRadius: Theme.borderRadius.md, padding: Theme.spacing.md, marginBottom: Theme.spacing.md },
  emptyText: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.semibold },
  linkText: { color: Theme.colors.light.primary, fontWeight: Theme.typography.weights.bold },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Theme.colors.light.card, borderWidth: 1, borderColor: Theme.colors.light.border, borderRadius: Theme.borderRadius.lg, padding: Theme.spacing.sm, marginBottom: Theme.spacing.md },
  monthNavButton: { padding: 10, borderRadius: Theme.borderRadius.md, backgroundColor: Theme.colors.light.background, borderWidth: 1, borderColor: Theme.colors.light.border },
  monthName: { color: Theme.colors.light.text, fontSize: Theme.typography.sizes.heading3, fontWeight: Theme.typography.weights.bold },
  monthSublabel: { color: Theme.colors.light.subtext, fontSize: Theme.typography.sizes.tiny, textTransform: 'uppercase', letterSpacing: 0.5 },
  challanHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.lg },
  totalBadge: { backgroundColor: '#f0fdf4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#bbf7d0' },
  totalBadgeText: { color: '#15803d', fontWeight: Theme.typography.weights.bold, fontSize: Theme.typography.sizes.caption },
  labelSubRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  labelSubText: { color: Theme.colors.light.subtext, fontSize: Theme.typography.sizes.tiny, fontWeight: Theme.typography.weights.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  warningHint: { color: Theme.colors.light.warning, fontSize: 10, fontWeight: Theme.typography.weights.bold },
  browseLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Theme.spacing.md, borderTopWidth: 1, borderTopColor: Theme.colors.light.border },
  browseLinkTitle: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.bold, fontSize: 13 },
  browseLinkSub: { color: Theme.colors.light.subtext, fontSize: 11, marginTop: 2 },
  skeletonLabel: { height: 12, width: 120, marginBottom: Theme.spacing.sm },
  skeletonLabelSmall: { height: 12, width: 80, marginBottom: Theme.spacing.md },
  skeletonChip: { height: 32, flex: 1, borderRadius: Theme.borderRadius.sm },
  skeletonInput: { height: 44, borderRadius: Theme.borderRadius.sm, marginBottom: Theme.spacing.sm },
  rowGap: { flexDirection: 'row', gap: Theme.spacing.sm },
  chipScroll: { marginBottom: Theme.spacing.lg },
  chip: { marginRight: Theme.spacing.sm, paddingHorizontal: Theme.spacing.md, paddingVertical: 9, borderRadius: Theme.borderRadius.md, borderWidth: 1, borderColor: Theme.colors.light.border, backgroundColor: Theme.colors.light.white },
  chipActive: { borderColor: Theme.colors.light.secondary, backgroundColor: Theme.colors.light.secondary },
  chipText: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.semibold },
  chipTextActive: { color: Theme.colors.light.white },
  infoCard: { backgroundColor: Theme.colors.light.card, borderColor: Theme.colors.light.border, borderWidth: 1, borderRadius: Theme.borderRadius.md, padding: Theme.spacing.md, marginBottom: Theme.spacing.lg },
  infoCardTitle: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.semibold, marginBottom: 4 },
  infoCardSub: { color: Theme.colors.light.subtext, fontSize: Theme.typography.sizes.caption },
  fullScreenLink: { marginBottom: Theme.spacing.lg, backgroundColor: Theme.colors.light.card, borderWidth: 1, borderColor: Theme.colors.light.border, borderRadius: Theme.borderRadius.md, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fullScreenLinkContent: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
  fullScreenLinkIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fde7f1', alignItems: 'center', justifyContent: 'center', marginRight: Theme.spacing.sm },
  fullScreenLinkTitle: { color: Theme.colors.light.text, fontWeight: Theme.typography.weights.bold },
  fullScreenLinkSub: { color: Theme.colors.light.subtext, fontSize: 11 },
  challanLogsPrompt: { color: Theme.colors.light.subtext, fontSize: 13, marginBottom: Theme.spacing.lg },
  emptyOwnerState: { alignItems: 'center', marginTop: 64 },
  emptyOwnerEmoji: { fontSize: 48 },
  emptyOwnerText: { color: Theme.colors.light.subtext, fontSize: 14, marginTop: 12, textAlign: 'center' },
  emptyOwnerButton: { marginTop: 12, backgroundColor: Theme.colors.light.secondary, borderRadius: Theme.borderRadius.md, paddingHorizontal: Theme.spacing.md, paddingVertical: 10 },
  emptyOwnerButtonText: { color: Theme.colors.light.white, fontWeight: Theme.typography.weights.bold },
});
