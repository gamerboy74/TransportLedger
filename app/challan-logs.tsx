// app/challan-logs.tsx — Full-screen Challan Logs, mirrors diesel-logs.tsx pattern
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  RefreshControl, Modal, StyleSheet, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Swipeable } from 'react-native-gesture-handler';
import ThemedDateField from '../components/ThemedDateField';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';
import { useThemedNotice } from '../components/ThemedNoticeProvider';
import {
  getTransportOwners,
  getVehiclesByOwnerIds,
  getChallanEntriesByVehicleIds,
  addChallanEntry,
  updateChallanEntry,
  deleteChallanEntry,
  type ChallanEntry,
} from '../lib/queries';
import { monthKey, monthLabel } from '../constants/defaults';
import type { TransportOwner, Vehicle } from '../types';

// ─── Helpers ──────────────────────────────────────────────────

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

const SWIPE_FRICTION = 1.8;
const SWIPE_RIGHT_THRESHOLD = 32;
const SWIPE_DRAG_OFFSET = 24;

// ─── Main Screen ──────────────────────────────────────────────

export default function ChallanLogsScreen() {
  const params = useLocalSearchParams<{ ownerId?: string; vehicleId?: string; month?: string }>();
  const notice = useThemedNotice();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(() =>
    params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthKey()
  );
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(
    typeof params.ownerId === 'string' ? params.ownerId : null
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    typeof params.vehicleId === 'string' ? params.vehicleId : null
  );
  const [editing, setEditing] = useState<ChallanEntry | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const swipeRefs = useRef<Record<string, Swipeable | null>>({});

  // ── Queries ──
  const { data: owners = [], isLoading: ownersLoading } = useQuery({
    queryKey: ['challanLogsOwners'],
    queryFn: getTransportOwners,
  });

  const ownerIds = useMemo(() => owners.map(o => o.id).sort(), [owners]);
  const ownerIdsKey = ownerIds.join(',');

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['challanLogsVehicles', ownerIdsKey],
    queryFn: () => getVehiclesByOwnerIds(ownerIds),
    enabled: owners.length > 0,
  });

  const ownerVehicles = useMemo(
    () => selectedOwnerId ? vehicles.filter(v => v.transport_owner_id === selectedOwnerId) : vehicles,
    [vehicles, selectedOwnerId]
  );

  const scopedVehicleIds = useMemo(() => ownerVehicles.map(v => v.id), [ownerVehicles]);
  const vehicleIdsKey = useMemo(() => [...scopedVehicleIds].sort().join(','), [scopedVehicleIds]);

  // ── SINGLE bulk query — replaces N+1 Promise.all ──
  // getChallanEntriesByVehicleIds fires one .in('vehicle_id', ids) round-trip
  const CHALLAN_QK = ['challanLogs', month, vehicleIdsKey] as const;
  const {
    data: entries = [],
    isLoading: logsLoading,
    isFetching,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: CHALLAN_QK,
    queryFn: () => getChallanEntriesByVehicleIds(scopedVehicleIds, month),
    enabled: scopedVehicleIds.length > 0,
    staleTime: 30_000,        // treat data fresh for 30s — no refetch on tab focus
    refetchInterval: 120_000, // silent background refresh every 2 min
  });

  const loading = ownersLoading || vehiclesLoading || logsLoading;

  // Invalidate helper — broadens to all months of scope if needed
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['challanLogs', month] });
  }, [queryClient, month]);


  const vehiclesById = useMemo(() => {
    const m = new Map<string, Vehicle>();
    vehicles.forEach(v => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const ownersById = useMemo(() => {
    const m = new Map<string, TransportOwner>();
    owners.forEach(o => m.set(o.id, o));
    return m;
  }, [owners]);

  // Filter by vehicle
  const displayEntries = useMemo(() =>
    selectedVehicleId
      ? entries.filter(e => e.vehicle_id === selectedVehicleId)
      : entries,
    [entries, selectedVehicleId]
  );

  // Summary
  const totalNetKg  = useMemo(() => displayEntries.reduce((s, e) => s + Number(e.net_weight_kg ?? 0), 0), [displayEntries]);
  const totalTrips  = displayEntries.length;

  // ── Delete ──
  const handleDelete = useCallback((entry: ChallanEntry) => {
    Alert.alert('Delete Challan', `Remove challan${entry.challan_no ? ` #${entry.challan_no}` : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingId(entry.id);
          // Optimistic remove from cache immediately
          queryClient.setQueryData<ChallanEntry[]>(CHALLAN_QK, (prev = []) =>
            prev.filter(e => e.id !== entry.id)
          );
          try {
            await deleteChallanEntry(entry.id);
          } catch (err) {
            notice.showError('Error', String(err));
            invalidate(); // restore on error
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }, [notice, queryClient, CHALLAN_QK, invalidate]);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.blobLeft} />
      <View style={s.blobRight} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={18} color="#111111" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Challan Logs</Text>
        <View style={s.headerActions}>
          <TouchableOpacity onPress={() => void refetchLogs()} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="refresh" size={16} color="#111111" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowAdd(true)} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="add" size={20} color="#d9468f" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Month nav */}
      <View style={s.monthNav}>
        <TouchableOpacity onPress={() => setMonth(prevMonth)} style={s.monthNavBtn}>
          <Text style={s.monthNavText}>Prev</Text>
        </TouchableOpacity>
        <Text style={s.monthLabel}>{monthLabel(month)}</Text>
        <TouchableOpacity onPress={() => setMonth(nextMonth)} style={s.monthNavBtn}>
          <Text style={s.monthNavText}>Next</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={isFetching && !loading} onRefresh={() => void refetchLogs()} tintColor="#ec4899" />}
        showsVerticalScrollIndicator={false}
      >
        {/* Owner filter chips */}
        <Text style={s.filterLabel}>Transport Owner</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
          <Chip text="All" active={!selectedOwnerId} onPress={() => { setSelectedOwnerId(null); setSelectedVehicleId(null); }} />
          {owners.map(o => (
            <Chip key={o.id} text={o.name} active={selectedOwnerId === o.id} onPress={() => { setSelectedOwnerId(o.id); setSelectedVehicleId(null); }} />
          ))}
        </ScrollView>

        {/* Vehicle filter chips */}
        <Text style={s.filterLabel}>Vehicle</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
          <Chip text="All" active={!selectedVehicleId} onPress={() => setSelectedVehicleId(null)} />
          {ownerVehicles.map(v => (
            <Chip key={v.id} text={v.reg_number} active={selectedVehicleId === v.id} onPress={() => setSelectedVehicleId(v.id)} />
          ))}
        </ScrollView>

        {/* Loading skeletons */}
        {loading && (
          <>
            <SkeletonCard><SkeletonBlock style={{ width: '100%', height: 54, marginBottom: 8 }} /><SkeletonBlock style={{ width: '100%', height: 54 }} /></SkeletonCard>
            <SkeletonCard><SkeletonBlock style={{ width: '100%', height: 54, marginBottom: 8 }} /><SkeletonBlock style={{ width: '100%', height: 54 }} /></SkeletonCard>
          </>
        )}

        {!loading && (
          <>
            {/* Summary card */}
            <View style={s.card}>
              <Text style={s.cardSubLabel}>Month Total</Text>
              <Text style={s.summaryTotal}>{(totalNetKg / 1000).toFixed(3)} T</Text>
              <Text style={s.filterSummaryText}>
                {totalTrips} trips · {displayEntries.reduce((s, e) => s + Number(e.gross_weight_kg ?? 0), 0).toLocaleString()} kg gross
              </Text>
            </View>

            {/* Entries list */}
            <View style={s.entriesHeader}>
              <Text style={s.entriesTitle}>Challan Entries</Text>
              <Text style={s.swipeHint}>Swipe left for edit/delete</Text>
            </View>

            {displayEntries.length === 0 && (
              <View style={s.emptyCard}>
                <Text style={s.emptyCardTitle}>No challans found</Text>
                <Text style={s.emptyCardSub}>Tap + to add a challan for this month.</Text>
              </View>
            )}

            {displayEntries.map(entry => (
              <ChallanCard
                key={entry.id}
                entry={entry}
                vehicle={vehiclesById.get(entry.vehicle_id)}
                isDeleting={deletingId === entry.id}
                isOpen={openSwipeId === entry.id}
                swipeRef={ref => { swipeRefs.current[entry.id] = ref; }}
                onWillOpen={() => {
                  if (openSwipeId && openSwipeId !== entry.id) swipeRefs.current[openSwipeId]?.close();
                  setOpenSwipeId(entry.id);
                }}
                onSwipeClose={() => { if (openSwipeId === entry.id) setOpenSwipeId(null); }}
                onEdit={() => { swipeRefs.current[entry.id]?.close(); setEditing(entry); }}
                onDelete={() => { swipeRefs.current[entry.id]?.close(); handleDelete(entry); }}
                onPress={() => { if (openSwipeId === entry.id) { swipeRefs.current[entry.id]?.close(); } else { setEditing(entry); } }}
              />
            ))}
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Edit modal */}
      {!!editing && (
        <ChallanEditModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={updated => {
            queryClient.setQueryData<ChallanEntry[]>(CHALLAN_QK, (prev = []) =>
              prev.map(e => e.id === updated.id ? updated : e)
                .sort((a: ChallanEntry, b: ChallanEntry) => b.trip_date.localeCompare(a.trip_date))
            );
            setEditing(null);
          }}
        />
      )}

      {/* Add modal */}
      {showAdd && selectedVehicleId && (
        <ChallanAddModal
          vehicleId={selectedVehicleId}
          vehicle={vehiclesById.get(selectedVehicleId)}
          month={month}
          onClose={() => setShowAdd(false)}
          onSaved={entry => {
            queryClient.setQueryData<ChallanEntry[]>(CHALLAN_QK, (prev = []) =>
              [entry, ...prev].sort((a: ChallanEntry, b: ChallanEntry) => b.trip_date.localeCompare(a.trip_date))
            );
            setShowAdd(false);
          }}
        />
      )}
      {showAdd && !selectedVehicleId && (
        (() => { notice.showInfo('Required', 'Select a vehicle first'); setShowAdd(false); return null; })()
      )}
    </SafeAreaView>
  );
}

// ─── ChallanCard ──────────────────────────────────────────────

function ChallanCard({ entry, vehicle, isDeleting, swipeRef, onWillOpen, onSwipeClose, onEdit, onDelete, onPress }: {
  entry: ChallanEntry;
  vehicle: Vehicle | undefined;
  isDeleting: boolean;
  isOpen: boolean;
  swipeRef: (ref: Swipeable | null) => void;
  onWillOpen: () => void;
  onSwipeClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPress: () => void;
}) {
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
          <TouchableOpacity onPress={onEdit} style={[s.swipeBtn, s.swipeBtnEdit]}>
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={s.swipeBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} disabled={isDeleting} style={[s.swipeBtn, s.swipeBtnDelete, isDeleting && s.swipeBtnDisabled]}>
            <Ionicons name="trash-outline" size={16} color="#fff" />
            <Text style={s.swipeBtnText}>{isDeleting ? '...' : 'Delete'}</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <TouchableOpacity onPress={onPress} style={s.logRow}>
        <View style={s.logRowLeft}>
          <Text style={s.logReg} numberOfLines={1}>{vehicle?.reg_number ?? '—'}</Text>
          <Text style={s.logMeta}>{entry.trip_date}{entry.challan_no ? ` · #${entry.challan_no}` : ''}</Text>
          {(entry.gross_weight_kg != null && entry.tare_weight_kg != null) && (
            <Text style={s.logOwner}>{Number(entry.gross_weight_kg).toLocaleString()} / {Number(entry.tare_weight_kg).toLocaleString()} kg</Text>
          )}
        </View>
        <View style={s.logRowRight}>
          <Text style={s.logAmount}>
            {entry.net_weight_kg != null ? `${(Number(entry.net_weight_kg) / 1000).toFixed(3)} T` : '—'}
          </Text>
          <Text style={s.logTapHint}>tap to edit</Text>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────

function ChallanEditModal({ entry, onClose, onSaved }: {
  entry: ChallanEntry;
  onClose: () => void;
  onSaved: (updated: ChallanEntry) => void;
}) {
  const [date, setDate]           = useState(entry.trip_date);
  const [challanNo, setChallanNo] = useState(entry.challan_no ?? '');
  const [grossKg, setGrossKg]     = useState(entry.gross_weight_kg != null ? String(entry.gross_weight_kg) : '');
  const [tareKg, setTareKg]       = useState(entry.tare_weight_kg  != null ? String(entry.tare_weight_kg)  : '');
  const [netKg, setNetKg]         = useState(entry.net_weight_kg   != null ? String(entry.net_weight_kg)   : '');
  const [saving, setSaving]       = useState(false);
  const notice = useThemedNotice();

  const handleGross = (v: string) => {
    setGrossKg(v);
    const g = parseFloat(v), t = parseFloat(tareKg);
    if (!isNaN(g) && !isNaN(t) && g > t) setNetKg(String(g - t));
  };
  const handleTare = (v: string) => {
    setTareKg(v);
    const g = parseFloat(grossKg), t = parseFloat(v);
    if (!isNaN(g) && !isNaN(t) && g > t) setNetKg(String(g - t));
  };

  const save = async () => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { notice.showInfo('Required', 'Enter valid date'); return; }
    if (!netKg || isNaN(parseFloat(netKg))) { notice.showInfo('Required', 'Enter Net Weight'); return; }
    setSaving(true);
    try {
      // Single atomic PATCH — replaces the old delete+insert (2 round-trips)
      const updated = await updateChallanEntry(entry.id, {
        month:           date.slice(0, 7),
        trip_date:       date,
        challan_no:      challanNo.trim() || null,
        gross_weight_kg: grossKg ? Number(grossKg) : null,
        tare_weight_kg:  tareKg  ? Number(tareKg)  : null,
        net_weight_kg:   Number(netKg),
      });
      onSaved(updated);
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);

    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb', padding: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Text style={{ color: '#111111', fontSize: 20, fontWeight: 'bold' }}>Edit Challan</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: '#db2777', fontSize: 15 }}>Cancel</Text></TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <ThemedDateField label="Date" value={date} onChange={setDate} required />
          <MF label="Challan No" value={challanNo} onChange={setChallanNo} placeholder="e.g. C92501775/877" />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            <View style={{ flex: 1 }}><MF label="Gross (kg)" value={grossKg} onChange={handleGross} kb="decimal-pad" /></View>
            <View style={{ flex: 1 }}><MF label="Tare (kg)"  value={tareKg}  onChange={handleTare}  kb="decimal-pad" /></View>
          </View>
          <MF label="Net Weight (kg) *" value={netKg} onChange={setNetKg} kb="decimal-pad" />
          {!!netKg && !isNaN(parseFloat(netKg)) && (
            <View style={{ backgroundColor: '#fff7fb', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: '#6b5c67', fontSize: 12 }}>Net in tonnes</Text>
              <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>{(parseFloat(netKg) / 1000).toFixed(3)} T</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 }}
          >
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Add Modal ────────────────────────────────────────────────

function ChallanAddModal({ vehicleId, vehicle, month, onClose, onSaved }: {
  vehicleId: string;
  vehicle: Vehicle | undefined;
  month: string;
  onClose: () => void;
  onSaved: (entry: ChallanEntry) => void;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate]           = useState(todayStr);
  const [challanNo, setChallanNo] = useState('');
  const [grossKg, setGrossKg]     = useState('');
  const [tareKg, setTareKg]       = useState('');
  const [netKg, setNetKg]         = useState('');
  const [saving, setSaving]       = useState(false);
  const notice = useThemedNotice();

  const handleGross = (v: string) => { setGrossKg(v); const g = parseFloat(v), t = parseFloat(tareKg); if (!isNaN(g) && !isNaN(t) && g > t) setNetKg(String(g - t)); };
  const handleTare  = (v: string) => { setTareKg(v);  const g = parseFloat(grossKg), t = parseFloat(v);  if (!isNaN(g) && !isNaN(t) && g > t) setNetKg(String(g - t)); };

  const save = async () => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { notice.showInfo('Required', 'Enter valid date'); return; }
    if (!netKg || isNaN(parseFloat(netKg)) || parseFloat(netKg) <= 0) { notice.showInfo('Required', 'Enter Net Weight'); return; }
    setSaving(true);
    try {
      const entry = await addChallanEntry({
        vehicle_id: vehicleId, month: date.slice(0, 7), trip_date: date,
        challan_no: challanNo.trim() || null, vehicle_no: vehicle?.reg_number ?? null,
        tr_no: null, transporter: null, destination: null, source: null,
        gross_weight_kg: grossKg ? Number(grossKg) : null,
        tare_weight_kg:  tareKg  ? Number(tareKg)  : null,
        net_weight_kg:   Number(netKg),
      });
      onSaved(entry);
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb', padding: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Text style={{ color: '#111111', fontSize: 20, fontWeight: 'bold' }}>Add Challan{vehicle ? ` — ${vehicle.reg_number}` : ''}</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: '#db2777', fontSize: 15 }}>Cancel</Text></TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <ThemedDateField label="Date" value={date} onChange={setDate} required />
          <MF label="Challan No" value={challanNo} onChange={setChallanNo} placeholder="e.g. C92501775/877" />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            <View style={{ flex: 1 }}><MF label="Gross (kg)" value={grossKg} onChange={handleGross} kb="decimal-pad" /></View>
            <View style={{ flex: 1 }}><MF label="Tare (kg)"  value={tareKg}  onChange={handleTare}  kb="decimal-pad" /></View>
          </View>
          <MF label="Net Weight (kg) *" value={netKg} onChange={setNetKg} kb="decimal-pad" />
          {!!netKg && !isNaN(parseFloat(netKg)) && parseFloat(netKg) > 0 && (
            <View style={{ backgroundColor: '#fff7fb', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: '#6b5c67', fontSize: 12 }}>Net in tonnes</Text>
              <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>{(parseFloat(netKg) / 1000).toFixed(3)} T</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 }}
          >
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{saving ? 'Saving...' : 'Save Challan'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Shared field component ───────────────────────────────────

function MF({ label, value, onChange, placeholder, kb = 'default' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; kb?: any }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <TextInput
        style={{ backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 12, padding: 14 }}
        value={value} onChangeText={onChange} placeholder={placeholder ?? '—'}
        placeholderTextColor="#9f8b97" keyboardType={kb} autoCapitalize="characters"
      />
    </View>
  );
}

// ─── Chip ─────────────────────────────────────────────────────

function Chip({ text, active, onPress }: { text: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        marginRight: 8, paddingHorizontal: 14, paddingVertical: 9,
        borderRadius: 12, borderWidth: 1,
        borderColor: active ? '#d9468f' : '#f2d7e6',
        backgroundColor: active ? '#d9468f' : '#ffffffcc',
      }}
    >
      <Text style={{ color: active ? 'white' : '#111111', fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#fff7fb' },
  blobLeft:  { position: 'absolute', top: 10, left: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d433' },
  blobRight: { position: 'absolute', top: 160, right: -70, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe844' },

  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  iconBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { flex: 1, color: '#111111', fontSize: 18, fontWeight: 'bold', marginLeft: 10 },
  headerActions: { flexDirection: 'row', gap: 8 },

  monthNav:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 16 },
  monthNavBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, backgroundColor: '#ffffffcc', borderWidth: 1, borderColor: '#f2d7e6' },
  monthNavText:{ color: '#db2777', fontWeight: '700', fontSize: 13 },
  monthLabel:  { color: '#111111', fontWeight: '700', fontSize: 15, minWidth: 100, textAlign: 'center' },

  scroll:       { flex: 1 },
  filterLabel:  { color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, marginLeft: 16, marginTop: 12, marginBottom: 6 },
  chipRow:      { paddingLeft: 16, marginBottom: 4 },

  card:          { marginHorizontal: 16, marginTop: 12, backgroundColor: '#ffffffcc', borderRadius: 18, borderWidth: 1, borderColor: '#f2d7e6', padding: 16 },
  cardSubLabel:  { color: '#6b5c67', fontSize: 12, marginBottom: 4 },
  summaryTotal:  { color: '#111111', fontSize: 32, fontWeight: '700', marginBottom: 4 },
  filterSummaryText: { color: '#6b5c67', fontSize: 12, marginTop: 4 },

  entriesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 16, marginBottom: 6 },
  entriesTitle:  { color: '#111111', fontWeight: '700', fontSize: 15 },
  swipeHint:     { color: '#9f8b97', fontSize: 11 },

  emptyCard:     { marginHorizontal: 16, backgroundColor: '#ffffffcc', borderRadius: 14, borderWidth: 1, borderColor: '#f2d7e6', padding: 20, alignItems: 'center' },
  emptyCardTitle:{ color: '#111111', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  emptyCardSub:  { color: '#6b5c67', fontSize: 12, textAlign: 'center' },

  logRow:      { backgroundColor: '#ffffff', marginHorizontal: 16, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: '#f2d7e6', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  logRowLeft:  { flex: 1, paddingRight: 8 },
  logRowRight: { alignItems: 'flex-end' },
  logReg:      { color: '#111111', fontWeight: '700', fontSize: 14 },
  logOwner:    { color: '#6b5c67', fontSize: 11, marginTop: 2 },
  logMeta:     { color: '#6b5c67', fontSize: 11, marginTop: 2 },
  logAmount:   { color: '#22c55e', fontWeight: '700', fontSize: 15 },
  logTapHint:  { color: '#9f8b97', fontSize: 10, marginTop: 2 },

  swipeActions:    { flexDirection: 'row', marginBottom: 8, marginRight: 16 },
  swipeBtn:        { width: 72, justifyContent: 'center', alignItems: 'center', borderRadius: 14, gap: 4 },
  swipeBtnEdit:    { backgroundColor: '#3b82f6' },
  swipeBtnDelete:  { backgroundColor: '#ef4444' },
  swipeBtnDisabled:{ opacity: 0.5 },
  swipeBtnText:    { color: '#fff', fontSize: 11, fontWeight: '700' },
});
