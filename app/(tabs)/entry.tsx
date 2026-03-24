import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, ScrollView, TouchableOpacity, TextInput, RefreshControl, Pressable, ActivityIndicator, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import ThemedDateField from '../../components/ThemedDateField';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import { getVehicles, addDieselLog, addTripEntry, addChallanEntry, getChallanEntries, deleteChallanEntry } from '../../lib/queries';
import { appendActivityEvent } from '../../lib/activityHistory';
import { fetchEntryBootstrap } from '../../lib/summaries';
import { monthKey, monthLabel, round2, SELL_RATE } from '../../constants/defaults';
import type { TransportOwner, Vehicle, Route } from '../../types';

export default function EntryScreen() {
  const [tab, setTab]               = useState<'diesel' | 'trip' | 'challan'>('diesel');
  const [selOwner, setSelOwner]     = useState<TransportOwner | null>(null);
  const [selVehicle, setSelVehicle] = useState<Vehicle | null>(null);
  const listRef = useRef<ScrollView | null>(null);
  const queryClient = useQueryClient();
  const notice = useThemedNotice();

  const { data: bootstrapData, isLoading, isFetching: isBootstrapFetching, error: bootstrapError, refetch: refetchBootstrap } = useQuery({
    queryKey: ['entryBootstrap'],
    queryFn: fetchEntryBootstrap,
  });

  const { data: ownerVehicles = [], isFetching: isVehiclesFetching, error: vehiclesError, refetch: refetchVehicles } = useQuery({
    queryKey: ['ownerVehicles', selOwner?.id ?? 'none'],
    queryFn: () => getVehicles(selOwner!.id),
    enabled: !!selOwner,
  });

  const owners = bootstrapData?.owners ?? [];
  const routes = bootstrapData?.routes ?? [];
  const vehicles = ownerVehicles;
  const loading = isLoading;
  const refreshing = (isBootstrapFetching && !isLoading) || isVehiclesFetching;

  useEffect(() => {
    if (bootstrapError) notice.showError('Error', 'Could not refresh quick entry data.');
  }, [bootstrapError, notice]);

  useEffect(() => {
    if (vehiclesError && selOwner) notice.showError('Error', 'Could not load vehicles for this owner.');
  }, [vehiclesError, selOwner, notice]);

  useEffect(() => {
    if (!selOwner) return;
    const ownerStillExists = owners.find((o) => o.id === selOwner.id);
    if (!ownerStillExists) {
      setSelOwner(null);
      setSelVehicle(null);
      return;
    }
    if (selVehicle && !vehicles.some((v) => v.id === selVehicle.id)) {
      setSelVehicle(null);
    }
  }, [owners, vehicles, selOwner, selVehicle]);

  const pickOwner = (owner: TransportOwner) => {
    setSelOwner(owner);
    setSelVehicle(null);
  };

  useFocusEffect(
    useCallback(() => {
      listRef.current?.scrollTo({ y: 0, animated: false });
    }, [])
  );

  const S = { flex: 1, backgroundColor: '#fff7fb' as const };

  return (
    <SafeAreaView style={S}>
      <View style={{ position: 'absolute', top: 12, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' }} />
      <View style={{ position: 'absolute', top: 140, right: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' }} />

      <View style={{ paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>👨🏽</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => router.push('/(tabs)/entry')} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Ionicons name="add" size={18} color="#111111" />
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/reports')} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color="#111111" />
          </Pressable>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 }}>
        <Text style={{ color: '#111111', fontSize: 26, fontWeight: '800' }}>Quick Entry</Text>
        <Text style={{ color: '#6b5c67', fontSize: 13, marginTop: 2 }}>{monthLabel(monthKey())}</Text>
      </View>

      {/* Tab */}
      <View style={{ flexDirection: 'row', marginHorizontal: 16, backgroundColor: '#ffffffcc', borderRadius: 16, padding: 4, borderWidth: 1, borderColor: '#f2d7e6' }}>
        {(['diesel', 'trip', 'challan'] as const).map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={{
            flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center',
            backgroundColor: tab === t ? '#d9468f' : 'transparent'
          }}>
            <Text style={{ color: tab === t ? 'white' : '#6b5c67', fontWeight: '700', fontSize: 12 }}>
              {t === 'diesel' ? '⛽ Diesel' : t === 'trip' ? '🗺 Trip' : '🧾 Challan'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        ref={listRef}
        style={{ flex: 1, padding: 16 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refetchBootstrap(); if (selOwner) void refetchVehicles(); }} tintColor="#ec4899" />}
      >
        {loading && (
          <>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 12, width: 120, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SkeletonBlock style={{ height: 32, flex: 1, borderRadius: 10 }} />
                <SkeletonBlock style={{ height: 32, flex: 1, borderRadius: 10 }} />
                <SkeletonBlock style={{ height: 32, flex: 1, borderRadius: 10 }} />
              </View>
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 12, width: 80, marginBottom: 12 }} />
              <SkeletonBlock style={{ height: 44, borderRadius: 10, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 44, borderRadius: 10, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 44, borderRadius: 10 }} />
            </SkeletonCard>
          </>
        )}

        {!loading && (
          <>
        {/* Owner chips */}
        <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 }}>Transport Owner</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          {owners.map(o => (
            <TouchableOpacity key={o.id} onPress={() => pickOwner(o)} style={{
              marginRight: 8,
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: selOwner?.id === o.id ? '#d9468f' : '#f2d7e6',
              backgroundColor: selOwner?.id === o.id ? '#d9468f' : '#ffffffcc'
            }}>
              <Text style={{ color: selOwner?.id === o.id ? 'white' : '#111111', fontWeight: '600' }}>
                {o.name.split(' ').slice(0, 2).join(' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Vehicle chips */}
        {selOwner && (
          <>
            <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 }}>Vehicle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {vehicles.map(v => (
                <TouchableOpacity key={v.id} onPress={() => setSelVehicle(v)} style={{
                  marginRight: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: selVehicle?.id === v.id ? '#d9468f' : '#f2d7e6',
                  backgroundColor: selVehicle?.id === v.id ? '#d9468f' : '#ffffffcc'
                }}>
                  <Text style={{ color: selVehicle?.id === v.id ? 'white' : '#111111', fontWeight: '600' }}>
                    {v.reg_number}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {vehicles.length === 0 && (
              <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 }}>
                <Text style={{ color: '#111111', fontWeight: '600', marginBottom: 4 }}>No vehicles for this owner yet</Text>
                <Text style={{ color: '#6b5c67', fontSize: 12 }}>Open owner profile and add at least one vehicle to enable entry.</Text>
              </View>
            )}

            {tab === 'diesel' && (
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/diesel-logs', params: { ownerId: selOwner.id, vehicleId: selVehicle?.id ?? '', month: monthKey() } })}
                style={{
                  marginBottom: 16,
                  backgroundColor: '#ffffffcc',
                  borderWidth: 1,
                  borderColor: '#f2d7e6',
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#fde7f1', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                    <Ionicons name="list" size={14} color="#111111" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#111111', fontWeight: '800' }} numberOfLines={1}>Open Diesel Logs Full Screen</Text>
                    <Text style={{ color: '#6b5c67', fontSize: 11 }} numberOfLines={1}>Edit logs and view month/date/vehicle/transport totals</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#8d7a86" />
              </TouchableOpacity>
            )}
          </>
        )}

        {selVehicle && tab === 'diesel' && (
          <DieselForm vehicle={selVehicle} onSaved={() => {
            setSelVehicle(null);
            void queryClient.invalidateQueries({ queryKey: ['homeSummary'] });
            void queryClient.invalidateQueries({ queryKey: ['transportersSummary'] });
          }} />
        )}
        {selVehicle && tab === 'trip' && (
          <TripForm vehicle={selVehicle} routes={routes} onSaved={() => {
            setSelVehicle(null);
            void queryClient.invalidateQueries({ queryKey: ['homeSummary'] });
            void queryClient.invalidateQueries({ queryKey: ['transportersSummary'] });
          }} />
        )}
        {selVehicle && tab === 'challan' && (
          <ChallanForm vehicle={selVehicle} currentMonth={monthKey()} />
        )}

        {!selOwner && (
          <View style={{ alignItems: 'center', marginTop: 64 }}>
            <Text style={{ fontSize: 48 }}>☝️</Text>
            <Text style={{ color: '#6b5c67', fontSize: 14, marginTop: 12, textAlign: 'center' }}>
              Select a transport owner to start entering data
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/transporters')}
              style={{ marginTop: 12, backgroundColor: '#d9468f', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Go To Owners</Text>
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

function DieselForm({ vehicle, onSaved }: { vehicle: Vehicle; onSaved: () => void }) {
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0]);
  const [litres, setLitres] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  const save = async () => {
    const l = parseFloat(litres);
    if (isNaN(l) || l <= 0) { notice.showInfo('Invalid', 'Enter valid litres'); return; }
    setSaving(true);
    try {
      await addDieselLog({ vehicle_id: vehicle.id, date, litres: l });
      await appendActivityEvent({ entity: 'diesel_log', action: 'created', label: date, details: `${vehicle.reg_number} · ${round2(l)}L` });
      notice.showSuccess('Saved', `${l}L charged to ${vehicle.reg_number}\n₹${round2(l * SELL_RATE).toLocaleString('en-IN')} deducted`);
      setLitres(''); onSaved();
    } catch (e) { notice.showError('Error', String(e)); }
    finally { setSaving(false); }
  };

  return (
    <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 18, padding: 16 }}>
      <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16, marginBottom: 16 }}>
        ⛽ Diesel — {vehicle.reg_number}
      </Text>
      <ThemedDateField label="Date" value={date} onChange={setDate} required />
      <EF label="Litres" value={litres} onChange={setLitres} placeholder="e.g. 207.76" kb="decimal-pad" />
      {litres && !isNaN(parseFloat(litres)) && (
        <View style={{ backgroundColor: '#fff7fb', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#6b5c67', fontSize: 12 }}>Deduction at ₹94/L</Text>
          <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>
            ₹{round2(parseFloat(litres) * SELL_RATE).toLocaleString('en-IN')}
          </Text>
        </View>
      )}
      <TouchableOpacity onPress={save} disabled={saving}
        style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 12, padding: 14, alignItems: 'center' }}>
        <Text style={{ color: 'white', fontWeight: 'bold' }}>{saving ? 'Saving...' : 'Save Diesel Entry'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function TripForm({ vehicle, routes, onSaved }: { vehicle: Vehicle; routes: Route[]; onSaved: () => void }) {
  const [selRoute, setSelRoute] = useState<Route | null>(null);
  const [tonnes, setTonnes]     = useState('');
  const [month, setMonth]       = useState(monthKey());
  const [saving, setSaving]     = useState(false);
  const notice = useThemedNotice();

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

  return (
    <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 18, padding: 16 }}>
      <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16, marginBottom: 16 }}>
        🗺 Trip — {vehicle.reg_number}
      </Text>
      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 }}>Route</Text>
      {routes.map(r => (
        <TouchableOpacity key={r.id} onPress={() => setSelRoute(r)} style={{
          marginBottom: 8,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 12,
          backgroundColor: selRoute?.id === r.id ? '#d9468f' : '#ffffff',
          borderWidth: 1,
          borderColor: selRoute?.id === r.id ? '#d9468f' : '#f2d7e6',
          flexDirection: 'row',
          justifyContent: 'space-between'
        }}>
          <Text style={{ color: selRoute?.id === r.id ? 'white' : '#111111', fontWeight: '600' }}>{r.name}</Text>
          <Text style={{ color: selRoute?.id === r.id ? '#ffe4ef' : '#6b5c67' }}>₹{r.rate_per_tonne}/T</Text>
        </TouchableOpacity>
      ))}
      {routes.length === 0 && (
        <View style={{ backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#111111', fontWeight: '600' }}>No routes found</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/reports')} style={{ marginTop: 8 }}>
            <Text style={{ color: '#db2777', fontWeight: '700' }}>Add route in Reports tab</Text>
          </TouchableOpacity>
        </View>
      )}
      <EF label="Month (YYYY-MM)" value={month} onChange={setMonth} />
      <EF label="Tonnes" value={tonnes} onChange={setTonnes} placeholder="e.g. 1609.24" kb="decimal-pad" />
      {tonnes && selRoute && !isNaN(parseFloat(tonnes)) && (
        <View style={{ backgroundColor: '#fff7fb', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#6b5c67', fontSize: 12 }}>Gross earning</Text>
          <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>
            ₹{round2(parseFloat(tonnes) * selRoute.rate_per_tonne).toLocaleString('en-IN')}
          </Text>
        </View>
      )}
      <TouchableOpacity onPress={save} disabled={saving}
        style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 12, padding: 14, alignItems: 'center' }}>
        <Text style={{ color: 'white', fontWeight: 'bold' }}>{saving ? 'Saving...' : 'Save Trip Entry'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function EF({ label, value, onChange, placeholder, kb = 'default' }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <TextInput style={{ backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', color: '#111111', borderRadius: 10, padding: 12 }}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#9f8b97" keyboardType={kb} autoCapitalize="none" />
    </View>
  );
}

// ─── ChallanForm ──────────────────────────────────────────────
// Lightweight form — only the fields needed for the Excel sheet

function ChallanForm({ vehicle, currentMonth }: { vehicle: Vehicle; currentMonth: string }) {
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

  // Load work order from AsyncStorage once on mount (keyed per vehicle)
  const WO_KEY = `@challan_wo:${vehicle.id}`;
  useEffect(() => {
    void AsyncStorage.getItem(WO_KEY).then(v => { if (v) setWorkOrderNo(v); });
  }, [WO_KEY]);

  // Load saved entries for this vehicle/month
  const loadEntries = useCallback(async () => {
    try {
      const list = await getChallanEntries(vehicle.id, currentMonth);
      setEntries(list);
    } catch { /* silent */ }
  }, [vehicle.id, currentMonth]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  // Auto-calc net = gross − tare
  const handleGross = useCallback((v: string) => {
    setGrossKg(v);
    const g = parseFloat(v), t = parseFloat(tareKg);
    if (!isNaN(g) && !isNaN(t) && g > t) setNetKg(String(g - t));
  }, [tareKg]);

  const handleTare = useCallback((v: string) => {
    setTareKg(v);
    const g = parseFloat(grossKg), t = parseFloat(v);
    if (!isNaN(g) && !isNaN(t) && g > t) setNetKg(String(g - t));
  }, [grossKg]);

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

    // Duplicate challan_no guard
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
    // Persist work order once set
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
      // Optimistic update for month total + duplicate guard
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

  // ── Render ─────────────────────────────────────────────────────
  return (
    <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 18, padding: 16 }}>

      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>
          🧾 Challan — {vehicle.reg_number}
        </Text>
        {monthTotalKg > 0 && (
          <View style={{ backgroundColor: '#f0fdf4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#bbf7d0' }}>
            <Text style={{ color: '#15803d', fontWeight: '700', fontSize: 12 }}>
              {(monthTotalKg / 1000).toFixed(3)} T
            </Text>
          </View>
        )}
      </View>

      {/* Work Order No — prominent if not yet set */}
      <View style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 }}>Work Order No</Text>
          {!workOrderNo.trim() && (
            <Text style={{ color: '#f59e0b', fontSize: 10, fontWeight: '700' }}>⚠ Set once for all entries</Text>
          )}
        </View>
        <TextInput
          style={{
            backgroundColor: '#ffffff', borderWidth: 1,
            borderColor: !workOrderNo.trim() ? '#fbbf24' : '#f2d7e6',
            color: '#111111', borderRadius: 10, padding: 12,
          }}
          value={workOrderNo}
          onChangeText={setWorkOrderNo}
          placeholder="e.g. 0429"
          placeholderTextColor="#9f8b97"
          autoCapitalize="characters"
        />
      </View>

      {/* Date */}
      <ThemedDateField label="Date" value={date} onChange={setDate} required />

      {/* Challan No with duplicate warning */}
      <View style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Challan No
          </Text>
          {dupWarning && (
            <Text style={{ color: '#ef4444', fontSize: 10, fontWeight: '700' }}>⚠ Duplicate!</Text>
          )}
        </View>
        <TextInput
          style={{
            backgroundColor: '#ffffff', borderWidth: 1,
            borderColor: dupWarning ? '#ef4444' : '#f2d7e6',
            color: '#111111', borderRadius: 10, padding: 12,
          }}
          value={challanNo}
          onChangeText={setChallanNo}
          placeholder="e.g. C92501775/877"
          placeholderTextColor="#9f8b97"
          autoCapitalize="characters"
        />
      </View>

      {/* Gross + Tare side by side */}
      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        Weights (Kg)
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#6b5c67', fontSize: 10, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' }}>Gross</Text>
          <TextInput
            style={{ backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', color: '#111111', borderRadius: 10, padding: 12 }}
            value={grossKg} onChangeText={handleGross}
            placeholder="56050" placeholderTextColor="#9f8b97" keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#6b5c67', fontSize: 10, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' }}>Tare</Text>
          <TextInput
            style={{ backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', color: '#111111', borderRadius: 10, padding: 12 }}
            value={tareKg} onChangeText={handleTare}
            placeholder="16800" placeholderTextColor="#9f8b97" keyboardType="decimal-pad"
          />
        </View>
      </View>

      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        Net Weight (Kg) *
      </Text>
      <TextInput
        style={{ backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', color: '#111111', borderRadius: 10, padding: 12, marginBottom: 14 }}
        value={netKg} onChangeText={setNetKg}
        placeholder="Auto-calculated from Gross − Tare"
        placeholderTextColor="#9f8b97" keyboardType="decimal-pad"
      />

      {/* Tonnes preview */}
      {!!netKg && !isNaN(parseFloat(netKg)) && parseFloat(netKg) > 0 && (
        <View style={{ backgroundColor: '#fff7fb', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#6b5c67', fontSize: 12 }}>Net in tonnes</Text>
          <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>
            {(parseFloat(netKg) / 1000).toFixed(3)} T
          </Text>
        </View>
      )}

      {/* Save */}
      <TouchableOpacity
        onPress={save}
        disabled={saving}
        style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 16 }}
      >
        <Text style={{ color: 'white', fontWeight: 'bold' }}>{saving ? 'Saving...' : 'Save Challan'}</Text>
      </TouchableOpacity>

      {/* View logs link */}
      <TouchableOpacity
        onPress={() =>
          router.push({
            pathname: '/challan-logs',
            params: { vehicleId: vehicle.id, month: currentMonth },
          } as never)
        }
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f2d7e6' }}
      >
        <View>
          <Text style={{ color: '#111111', fontWeight: '700', fontSize: 13 }}>
            View Challan Logs
          </Text>
          <Text style={{ color: '#6b5c67', fontSize: 11, marginTop: 2 }}>
            {(monthTotalKg / 1000).toFixed(3)} T this month · tap to browse & edit
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#d9468f" />
      </TouchableOpacity>
    </View>
  );
}
