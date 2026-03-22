import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import ThemedDateField from '../../components/ThemedDateField';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import { getVehicles, upsertRoute, getActiveRoutes } from '../../lib/queries';
import { fetchReportsBootstrap } from '../../lib/summaries';
import { fmt, monthLabel } from '../../constants/defaults';
import type { TransportOwner, Vehicle, Route } from '../../types';

export default function ReportsScreen() {
  const [selOwner, setSelOwner]       = useState<TransportOwner | null>(null);
  const [selVehicle, setSelVehicle]   = useState<Vehicle | null>(null);
  const [exportDate, setExportDate]   = useState(new Date().toISOString().split('T')[0]);
  const [dieselPeriod, setDieselPeriod] = useState<'full' | 1 | 2>('full');
  const [exporting, setExporting]     = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const listRef = useRef<ScrollView | null>(null);
  const queryClient = useQueryClient();
  const notice = useThemedNotice();
  const progressMatch = exportProgress.match(/^(\d{1,3})%/);
  const progressValue = progressMatch ? Math.min(100, Math.max(0, Number(progressMatch[1]))) : 0;

  const { data: bootstrapData, isLoading, isFetching: isBootstrapFetching, error: bootstrapError, refetch: refetchBootstrap } = useQuery({
    queryKey: ['reportsBootstrap'],
    queryFn: fetchReportsBootstrap,
    refetchInterval: 45_000,
  });

  const { data: ownerVehicles = [], isFetching: isVehiclesFetching, error: vehiclesError, refetch: refetchVehicles } = useQuery({
    queryKey: ['ownerVehicles', selOwner?.id ?? 'none'],
    queryFn: () => getVehicles(selOwner!.id),
    enabled: !!selOwner,
    refetchInterval: 45_000,
  });

  const owners = bootstrapData?.owners ?? [];
  const vehicles = ownerVehicles;
  const loading = isLoading;
  const refreshing = (isBootstrapFetching && !isLoading) || isVehiclesFetching;

  useEffect(() => {
    if (bootstrapError) notice.showError('Error', 'Could not refresh reports data.');
  }, [bootstrapError, notice]);

  useEffect(() => {
    if (vehiclesError && selOwner) notice.showError('Error', 'Could not load vehicles for selected owner.');
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

  const doExport = async (type: 'diesel' | 'ledger' | 'vehicle') => {
    if (!selOwner) { notice.showInfo('Required', 'Select an owner first'); return; }
    if (type === 'vehicle' && !selVehicle) { notice.showInfo('Required', 'Select a vehicle first'); return; }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(exportDate)) {
      notice.showInfo('Invalid date', 'Please select a valid date.');
      return;
    }

    const month = exportDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month) || Number(month.split('-')[1]) < 1 || Number(month.split('-')[1]) > 12) {
      notice.showInfo('Invalid month', 'Please select a valid month for export.');
      return;
    }

    setExporting(true);
    setExportProgress('Preparing export...');
    try {
      const { exportDieselSheet, exportTransporterLedger, exportVehicleSettlement } = require('../../lib/excel');
      const onProgress = (message: string) => setExportProgress(message);
      if (type === 'diesel')  await exportDieselSheet(selOwner, vehicles, month, dieselPeriod === 'full' ? undefined : dieselPeriod, onProgress);
      if (type === 'ledger')  await exportTransporterLedger(selOwner, vehicles, month, onProgress);
      if (type === 'vehicle' && selVehicle) await exportVehicleSettlement(selVehicle, selOwner, month, onProgress);
      notice.showSuccess('Export Ready', 'File generated successfully.');
    } catch (e) { notice.showError('Export failed', String(e)); }
    finally {
      setExporting(false);
      setExportProgress('');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb' }}>
      <View style={{ position: 'absolute', top: 40, right: -70, width: 240, height: 240, borderRadius: 120, backgroundColor: '#fbcfe855' }} />
      <View style={{ position: 'absolute', top: 210, left: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: '#f9a8d455' }} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={listRef}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 34 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refetchBootstrap(); if (selOwner) void refetchVehicles(); }} tintColor="#d9468f" />}
      >
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

        <View style={{ padding: 16, paddingTop: 8 }}>
          <Text style={{ color: '#111111', fontSize: 26, fontWeight: '800' }}>Reports & Export</Text>
          <Text style={{ color: '#6b5c67', marginTop: 2 }}>Export files and manage live route rates</Text>
        </View>

        {loading && (
          <View style={{ paddingHorizontal: 16 }}>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 12, width: 120, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <SkeletonBlock style={{ height: 32, flex: 1, borderRadius: 10 }} />
                <SkeletonBlock style={{ height: 32, flex: 1, borderRadius: 10 }} />
                <SkeletonBlock style={{ height: 32, flex: 1, borderRadius: 10 }} />
              </View>
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 12, width: 100, marginBottom: 12 }} />
              <SkeletonBlock style={{ height: 44, borderRadius: 10, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 64, borderRadius: 10, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 64, borderRadius: 10 }} />
            </SkeletonCard>
          </View>
        )}

        {!loading && (
          <>

        {/* Owner selector */}
        <View style={{ paddingHorizontal: 16 }}>
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

          {selOwner && (
            <>
              <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 }}>Vehicle (for vehicle export)</Text>
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
            </>
          )}
        </View>

        {/* Export buttons */}
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.7 }}>Export Month</Text>
          <ThemedDateField label="Month" value={exportDate} onChange={setExportDate} required />

          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 }}>Diesel Sheet Period</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'full' as const, label: 'Full Month' },
              { key: 1 as const, label: '1-15' },
              { key: 2 as const, label: '16-End' },
            ].map((p) => (
              <TouchableOpacity
                key={String(p.key)}
                onPress={() => setDieselPeriod(p.key)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: dieselPeriod === p.key ? '#d9468f' : '#f2d7e6',
                  backgroundColor: dieselPeriod === p.key ? '#d9468f' : '#ffffffcc',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: dieselPeriod === p.key ? 'white' : '#111111', fontWeight: '700', fontSize: 12 }}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.7 }}>Excel Exports</Text>
          {[
            { emoji: '⛽', title: 'Diesel Tracking Sheet', sub: 'Selected month diesel log', type: 'diesel' as const, needsVehicle: false },
            { emoji: '💳', title: 'Transporter Ledger', sub: 'Selected month payment ledger', type: 'ledger' as const, needsVehicle: false },
            { emoji: '📄', title: 'Vehicle Settlement Voucher', sub: 'Selected month settlement', type: 'vehicle' as const, needsVehicle: true },
          ].map(btn => {
            const disabled = !selOwner || exporting || (btn.needsVehicle && !selVehicle);
            return (
              <TouchableOpacity key={btn.type} onPress={() => doExport(btn.type)} disabled={disabled}
                style={{
                  backgroundColor: '#ffffffcc', borderRadius: 16, padding: 16,
                  borderWidth: 1, borderColor: '#f2d7e6',
                  flexDirection: 'row', alignItems: 'center', marginBottom: 10,
                  opacity: disabled ? 0.4 : 1,
                }}>
                <Text style={{ fontSize: 28 }}>{btn.emoji}</Text>
                <View style={{ marginLeft: 14, flex: 1 }}>
                  <Text style={{ color: '#111111', fontWeight: '700' }}>{btn.title}</Text>
                  <Text style={{ color: '#6b5c67', fontSize: 12, marginTop: 2 }}>{btn.sub}</Text>
                </View>
                <Text style={{ color: '#db2777', fontSize: 20 }}>↑</Text>
              </TouchableOpacity>
            );
          })}

          {exporting && (
            <View style={{ alignItems: 'center', padding: 16 }}>
              <ActivityIndicator color="#d9468f" />
              <Text style={{ color: '#6b5c67', marginTop: 8 }}>{exportProgress || 'Generating export file...'}</Text>
              <View style={{ width: '100%', height: 8, borderRadius: 999, backgroundColor: '#f4e9ef', marginTop: 10, overflow: 'hidden' }}>
                <View style={{ width: `${progressValue}%`, height: 8, backgroundColor: '#ec4899' }} />
              </View>
              <Text style={{ color: '#6b5c67', fontSize: 11, marginTop: 6 }}>{progressValue}%</Text>
            </View>
          )}
        </View>

        <RouteManager onRouteSaved={() => { void queryClient.invalidateQueries({ queryKey: ['entryBootstrap'] }); }} />
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RouteManager({ onRouteSaved }: { onRouteSaved: () => void }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [name, setName]     = useState('');
  const [rate, setRate]     = useState('');
  const [saving, setSaving] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const notice = useThemedNotice();

  const loadRoutes = useCallback(async () => {
    try {
      setLoadingRoutes(true);
      const data = await getActiveRoutes();
      setRoutes(data);
    } catch {
      notice.showError('Error', 'Could not load routes.');
    } finally {
      setLoadingRoutes(false);
    }
  }, [notice]);

  useFocusEffect(useCallback(() => { void loadRoutes(); }, [loadRoutes]));

  const save = async () => {
    if (!name.trim() || !rate) { notice.showInfo('Required', 'Enter name and rate'); return; }
    const r = parseFloat(rate);
    if (isNaN(r)) { notice.showInfo('Invalid', 'Enter valid rate'); return; }
    setSaving(true);
    try {
      await upsertRoute({
        id: editingRoute?.id,
        name: name.trim(),
        rate_per_tonne: r,
        effective_from: new Date().toISOString().split('T')[0],
      });
      setName(''); setRate('');
      setEditingRoute(null);
      void loadRoutes();
      onRouteSaved();
      notice.showSuccess('Saved', 'Route updated successfully.');
    } catch (e) { notice.showError('Error', String(e)); }
    finally { setSaving(false); }
  };

  return (
    <View style={{ padding: 16 }}>
      <View style={{ backgroundColor: '#ffffffcc', borderRadius: 20, borderWidth: 1, borderColor: '#f2d7e6', padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 }}>Manage Routes</Text>
          <Text style={{ color: '#6b5c67', fontSize: 12 }}>{routes.length} active</Text>
        </View>

        <ScrollView nestedScrollEnabled style={{ maxHeight: 220, marginBottom: 12 }} keyboardShouldPersistTaps="handled">
          {loadingRoutes && (
            <>
              <SkeletonBlock style={{ height: 42, borderRadius: 10, marginBottom: 8 }} />
              <SkeletonBlock style={{ height: 42, borderRadius: 10, marginBottom: 8 }} />
              <SkeletonBlock style={{ height: 42, borderRadius: 10, marginBottom: 8 }} />
            </>
          )}
          {routes.map(r => (
            <TouchableOpacity
              key={r.id}
              onPress={() => {
                setEditingRoute(r);
                setName(r.name);
                setRate(String(r.rate_per_tonne));
              }}
              style={{
                backgroundColor: editingRoute?.id === r.id ? '#fce7f3' : '#ffffff',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: editingRoute?.id === r.id ? '#ec4899' : '#f2d7e6',
                paddingHorizontal: 14,
                paddingVertical: 12,
                marginBottom: 8,
                flexDirection: 'row',
                justifyContent: 'space-between',
              }}>
              <Text style={{ color: '#111111', fontWeight: '600' }}>{r.name}</Text>
              <Text style={{ color: '#db2777', fontWeight: '700' }}>₹{r.rate_per_tonne}/T</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ color: '#111111', fontWeight: '700' }}>{editingRoute ? 'Edit Route' : 'Add / Update Route'}</Text>
          {editingRoute && (
            <TouchableOpacity onPress={() => { setEditingRoute(null); setName(''); setRate(''); }}>
              <Text style={{ color: '#db2777', fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#6b5c67', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', fontWeight: '700', letterSpacing: 0.6 }}>Route Name</Text>
            <TextInput style={{ backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 10, padding: 12 }}
              value={name} onChangeText={setName} placeholder="e.g. Kurwa" placeholderTextColor="#9f8b97" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#6b5c67', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', fontWeight: '700', letterSpacing: 0.6 }}>Rate ₹/T</Text>
            <TextInput style={{ backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 10, padding: 12 }}
              value={rate} onChangeText={setRate} placeholder="312.79" placeholderTextColor="#9f8b97" keyboardType="decimal-pad" />
          </View>
        </View>
        <TouchableOpacity onPress={save} disabled={saving}
          style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 12 }}>
          <Text style={{ color: 'white', fontWeight: 'bold' }}>{saving ? 'Saving...' : editingRoute ? 'Update Route' : 'Save Route'}</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: 44 }} />
    </View>
  );
}
