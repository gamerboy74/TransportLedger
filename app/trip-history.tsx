// app/trip-history.tsx — Full-screen Trip Logs with swipe-to-action
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  RefreshControl, Modal, StyleSheet, Alert, FlatList, ActivityIndicator, Pressable
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, useInfiniteQuery, InfiniteData } from '@tanstack/react-query';
import { Swipeable } from 'react-native-gesture-handler';
import ThemedDateField from '../components/ThemedDateField';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';
import { useThemedNotice } from '../components/ThemedNoticeProvider';
import { ThemedTextInput } from '../components/ThemedTextInput';
import {
  getTransportOwners,
  getVehiclesByOwnerIds,
  getTripEntriesByVehicleIdsDetail,
  addTripEntry,
  updateTripEntry,
  deleteTripEntry,
  getActiveRoutes,
} from '../lib/queries';
import { monthKey, monthLabel, fmt, round2 } from '../constants/defaults';
import type { TransportOwner, Vehicle, TripEntry, Route } from '../types';

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

export default function TripHistoryScreen() {
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
  const [editing, setEditing] = useState<TripEntry | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const swipeRefs = useRef<Record<string, Swipeable | null>>({});

  // ── Queries ──
  const { data: owners = [], isLoading: ownersLoading } = useQuery({
    queryKey: ['tripHistoryOwners'],
    queryFn: getTransportOwners,
  });

  const ownerIds = useMemo(() => owners.map(o => o.id).sort(), [owners]);
  const ownerIdsKey = ownerIds.join(',');

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['tripHistoryVehicles', ownerIdsKey],
    queryFn: () => getVehiclesByOwnerIds(ownerIds),
    enabled: owners.length > 0,
  });

  const ownerVehicles = useMemo(
    () => selectedOwnerId ? vehicles.filter(v => v.transport_owner_id === selectedOwnerId) : vehicles,
    [vehicles, selectedOwnerId]
  );

  const scopedVehicleIds = useMemo(() => ownerVehicles.map(v => v.id), [ownerVehicles]);
  const vehicleIdsKey = useMemo(() => [...scopedVehicleIds].sort().join(','), [scopedVehicleIds]);

  const TRIP_QK = ['tripHistory', month, vehicleIdsKey] as const;
  const {
    data: infiniteData,
    isLoading: logsLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch: refetchLogs,
  } = useInfiniteQuery({
    queryKey: TRIP_QK,
    queryFn: ({ pageParam = 0 }) => getTripEntriesByVehicleIdsDetail(scopedVehicleIds, month, { page: pageParam as number, pageSize: 50 }),
    getNextPageParam: (lastPage, allPages) => lastPage.length === 50 ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: scopedVehicleIds.length > 0,
  });

  const entries = useMemo(() => {
    if (!infiniteData) return [];
    return infiniteData.pages.flat();
  }, [infiniteData]);

  const loading = ownersLoading || vehiclesLoading || logsLoading;

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tripHistory', month] });
  }, [queryClient, month]);

  const vehiclesById = useMemo(() => {
    const m = new Map<string, Vehicle>();
    vehicles.forEach(v => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const displayEntries = useMemo(() =>
    selectedVehicleId
      ? entries.filter(e => e.vehicle_id === selectedVehicleId)
      : entries,
    [entries, selectedVehicleId]
  );

  const totalTonnes = useMemo(() => displayEntries.reduce((s, e) => s + Number(e.tonnes), 0), [displayEntries]);
  const totalAmount = useMemo(() => displayEntries.reduce((s, e) => s + Number(e.amount), 0), [displayEntries]);

  const handleDelete = useCallback((entry: TripEntry) => {
    Alert.alert('Delete Trip', `Remove trip for ${entry.route_name ?? 'route'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingId(entry.id);
          queryClient.setQueryData<InfiniteData<TripEntry[]>>(TRIP_QK, (prev) => {
            if (!prev) return prev;
            return { ...prev, pages: prev.pages.map(page => page.filter(e => e.id !== entry.id)) };
          });
          try {
            await deleteTripEntry(entry.id);
          } catch (err) {
            notice.showError('Error', String(err));
            invalidate();
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }, [notice, queryClient, TRIP_QK, invalidate]);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.blobLeft} />
      <View style={s.blobRight} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <Ionicons name="chevron-back" size={18} color="#111111" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Trip History</Text>
        <View style={s.headerActions}>
          <TouchableOpacity onPress={() => void refetchLogs()} style={s.iconBtn}>
            <Ionicons name="refresh" size={16} color="#111111" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowAdd(true)} style={s.iconBtn}>
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

      <FlatList
        style={s.scroll}
        data={displayEntries}
        keyExtractor={(item) => item.id}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={isFetching && !isFetchingNextPage && !loading} onRefresh={() => void refetchLogs()} tintColor="#ec4899" />}
        ListHeaderComponent={
          <>
            <Text style={s.filterLabel}>Transport Owner</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
              <Chip text="All" active={!selectedOwnerId} onPress={() => { setSelectedOwnerId(null); setSelectedVehicleId(null); }} />
              {owners.map(o => (
                <Chip key={o.id} text={o.name} active={selectedOwnerId === o.id} onPress={() => { setSelectedOwnerId(o.id); setSelectedVehicleId(null); }} />
              ))}
            </ScrollView>

            <Text style={s.filterLabel}>Vehicle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
              <Chip text="All" active={!selectedVehicleId} onPress={() => setSelectedVehicleId(null)} />
              {ownerVehicles.map(v => (
                <Chip key={v.id} text={v.reg_number} active={selectedVehicleId === v.id} onPress={() => setSelectedVehicleId(v.id)} />
              ))}
            </ScrollView>

            {loading && (
              <View style={{ padding: 16 }}>
                <SkeletonCard><SkeletonBlock style={{ height: 60 }} /></SkeletonCard>
                <SkeletonCard><SkeletonBlock style={{ height: 60 }} /></SkeletonCard>
              </View>
            )}

            {!loading && (
              <View style={s.card}>
                <Text style={s.cardSubLabel}>Month Total</Text>
                <Text style={s.summaryTotal}>{totalTonnes.toFixed(2)} T</Text>
                <Text style={s.filterSummaryText}>
                  {displayEntries.length} trips · {fmt(totalAmount)} total earnings
                </Text>
              </View>
            )}

            {!loading && (
              <View style={s.entriesHeader}>
                <Text style={s.entriesTitle}>Trip Entries</Text>
                <Text style={s.swipeHint}>Swipe left for edit/delete</Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={s.emptyCard}>
              <Text style={s.emptyCardTitle}>No trips found</Text>
              <Text style={s.emptyCardSub}>Add a trip for this month.</Text>
            </View>
          ) : null
        }
        renderItem={({ item: entry }) => (
          <TripCard
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
            onPress={() => { if (openSwipeId === entry.id) { swipeRefs.current[openSwipeId]?.close(); } else { setEditing(entry); } }}
          />
        )}
      />

      {!!editing && (
        <TripEditModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={updated => {
            queryClient.invalidateQueries({ queryKey: TRIP_QK });
            setEditing(null);
          }}
        />
      )}

      {showAdd && selectedVehicleId && (
        <TripAddModal
          vehicleId={selectedVehicleId}
          vehicle={vehiclesById.get(selectedVehicleId)}
          month={month}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: TRIP_QK });
            setShowAdd(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────

const TripCard = React.memo(function TripCard({ entry, vehicle, isDeleting, isOpen, swipeRef, onWillOpen, onSwipeClose, onEdit, onDelete, onPress }: {
  entry: TripEntry;
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
            <Text style={s.swipeBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <TouchableOpacity onPress={onPress} style={s.logRow}>
        <View style={s.logRowLeft}>
          <Text style={s.logReg}>{vehicle?.reg_number ?? '—'}</Text>
          <Text style={s.logMeta}>{entry.route_name ?? 'Unknown Route'}</Text>
          <Text style={s.logOwner}>{entry.tonnes} T × ₹{entry.rate_snapshot}/T</Text>
        </View>
        <View style={s.logRowRight}>
          <Text style={s.logAmount}>{fmt(entry.amount)}</Text>
          <Text style={s.logTapHint}>tap to edit</Text>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
});

function TripEditModal({ entry, onClose, onSaved }: { entry: TripEntry; onClose: () => void; onSaved: (u: TripEntry) => void }) {
  const [tonnes, setTonnes] = useState(String(entry.tonnes));
  const [rate, setRate]     = useState(String(entry.rate_snapshot));
  const [routeId, setRouteId] = useState(entry.route_id);
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  const { data: routes = [] } = useQuery({ queryKey: ['activeRoutes'], queryFn: getActiveRoutes });

  const save = async () => {
    const t = parseFloat(tonnes), r = parseFloat(rate);
    if (isNaN(t) || isNaN(r) || t <= 0) { notice.showInfo('Invalid', 'Enter valid tonnes and rate'); return; }
    setSaving(true);
    try {
      const updated = await updateTripEntry(entry.id, { 
        route_id: routeId, 
        month: entry.month, 
        tonnes: t, 
        rate_snapshot: r 
      });
      onSaved(updated);
    } catch (e) { notice.showError('Error', String(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSheet}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Edit Trip</Text>
          <TouchableOpacity onPress={onClose}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={s.fieldLabel}>Route</Text>
          <View style={s.routeGrid}>
            {routes.map(rt => (
              <TouchableOpacity
                key={rt.id}
                onPress={() => { setRouteId(rt.id); setRate(String(rt.rate_per_tonne)); }}
                style={[s.routeChip, routeId === rt.id && s.routeChipActive]}
              >
                <Text style={[s.routeChipText, routeId === rt.id && s.routeChipTextActive]}>{rt.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ThemedTextInput label="Tonnes" value={tonnes} onChangeText={setTonnes} keyboardType="decimal-pad" />
          <ThemedTextInput label="Rate Snapshot (₹/T)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
          
          <View style={s.previewCard}>
            <Text style={s.previewLabel}>Calculated Amount</Text>
            <Text style={s.previewValue}>{fmt(round2(parseFloat(tonnes || '0') * parseFloat(rate || '0')))}</Text>
          </View>

          <TouchableOpacity onPress={save} disabled={saving} style={[s.saveBtn, saving && s.saveBtnDisabled]}>
            <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function TripAddModal({ vehicleId, vehicle, month, onClose, onSaved }: { vehicleId: string; vehicle: Vehicle | undefined; month: string; onClose: () => void; onSaved: () => void }) {
  const [tonnes, setTonnes] = useState('');
  const [rate, setRate]     = useState('');
  const [routeId, setRouteId] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  const { data: routes = [] } = useQuery({ queryKey: ['activeRoutes'], queryFn: getActiveRoutes });

  const save = async () => {
    const t = parseFloat(tonnes), r = parseFloat(rate);
    if (!routeId) { notice.showInfo('Required', 'Select a route'); return; }
    if (isNaN(t) || isNaN(r) || t <= 0) { notice.showInfo('Invalid', 'Enter valid tonnes and rate'); return; }
    setSaving(true);
    try {
      await addTripEntry({ vehicle_id: vehicleId, route_id: routeId, month, tonnes: t, rate_snapshot: r });
      onSaved();
    } catch (e) { notice.showError('Error', String(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.modalSheet}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Add Trip — {vehicle?.reg_number}</Text>
          <TouchableOpacity onPress={onClose}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={s.fieldLabel}>Select Route</Text>
          <View style={s.routeGrid}>
            {routes.map(rt => (
              <TouchableOpacity
                key={rt.id}
                onPress={() => { setRouteId(rt.id); setRate(String(rt.rate_per_tonne)); }}
                style={[s.routeChip, routeId === rt.id && s.routeChipActive]}
              >
                <Text style={[s.routeChipText, routeId === rt.id && s.routeChipTextActive]}>{rt.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ThemedTextInput label="Tonnes" value={tonnes} onChangeText={setTonnes} keyboardType="decimal-pad" placeholder="e.g. 25.4" />
          <ThemedTextInput label="Rate Snapshot (₹/T)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
          
          <View style={s.previewCard}>
            <Text style={s.previewLabel}>Estimated Amount</Text>
            <Text style={s.previewValue}>{fmt(round2(parseFloat(tonnes || '0') * parseFloat(rate || '0')))}</Text>
          </View>

          <TouchableOpacity onPress={save} disabled={saving} style={[s.saveBtn, saving && s.saveBtnDisabled]}>
            <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Add Trip'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff7fb' },
  blobLeft:  { position: 'absolute', top: 10, left: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d433' },
  blobRight: { position: 'absolute', top: 160, right: -70, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe844' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: '#111111', fontSize: 18, fontWeight: 'bold', marginLeft: 10 },
  headerActions: { flexDirection: 'row', gap: 8 },

  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 16 },
  monthNavBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, backgroundColor: '#ffffffcc', borderWidth: 1, borderColor: '#f2d7e6' },
  monthNavText:{ color: '#db2777', fontWeight: '700', fontSize: 13 },
  monthLabel: { color: '#111111', fontWeight: '700', fontSize: 15, minWidth: 100, textAlign: 'center' },

  scroll: { flex: 1 },
  filterLabel: { color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, marginLeft: 16, marginTop: 12, marginBottom: 6 },
  chipRow: { paddingLeft: 16, marginBottom: 4 },

  card: { marginHorizontal: 16, marginTop: 12, backgroundColor: '#ffffffcc', borderRadius: 18, borderWidth: 1, borderColor: '#f2d7e6', padding: 16 },
  cardSubLabel: { color: '#6b5c67', fontSize: 12, marginBottom: 4 },
  summaryTotal: { color: '#111111', fontSize: 32, fontWeight: '700', marginBottom: 4 },
  filterSummaryText: { color: '#6b5c67', fontSize: 12, marginTop: 4 },

  entriesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 16, marginBottom: 6 },
  entriesTitle: { color: '#111111', fontWeight: '700', fontSize: 15 },
  swipeHint: { color: '#9f8b97', fontSize: 11 },

  emptyCard: { marginHorizontal: 16, backgroundColor: '#ffffffcc', borderRadius: 14, borderWidth: 1, borderColor: '#f2d7e6', padding: 20, alignItems: 'center' },
  emptyCardTitle: { color: '#111111', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  emptyCardSub: { color: '#6b5c67', fontSize: 12, textAlign: 'center' },

  logRow: { backgroundColor: '#ffffff', marginHorizontal: 16, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: '#f2d7e6', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  logRowLeft: { flex: 1, paddingRight: 8 },
  logRowRight: { alignItems: 'flex-end' },
  logReg: { color: '#111111', fontWeight: '700', fontSize: 14 },
  logMeta: { color: '#6b5c67', fontSize: 12, marginTop: 1 },
  logOwner: { color: '#9f8b97', fontSize: 11, marginTop: 3 },
  logAmount: { color: '#111111', fontWeight: '700', fontSize: 15 },
  logTapHint: { color: '#9f8b97', fontSize: 10, marginTop: 2 },

  swipeActions: { flexDirection: 'row', marginBottom: 8, marginRight: 16 },
  swipeBtn: { width: 72, justifyContent: 'center', alignItems: 'center', borderRadius: 14, gap: 4 },
  swipeBtnEdit: { backgroundColor: '#3b82f6' },
  swipeBtnDelete: { backgroundColor: '#ef4444' },
  swipeBtnDisabled: { opacity: 0.5 },
  swipeBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  modalSheet: { flex: 1, backgroundColor: '#fff7fb', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: '#111111', fontSize: 20, fontWeight: 'bold' },
  cancelText: { color: '#db2777', fontSize: 15 },
  fieldLabel: { color: '#6b5c67', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  routeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  routeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6' },
  routeChipActive: { backgroundColor: '#d9468f', borderColor: '#d9468f' },
  routeChipText: { color: '#111111', fontSize: 13, fontWeight: '600' },
  routeChipTextActive: { color: '#ffffff' },
  previewCard: { backgroundColor: '#ffffffcc', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#f2d7e6', marginBottom: 16 },
  previewLabel: { color: '#6b5c67', fontSize: 11 },
  previewValue: { color: '#111111', fontSize: 20, fontWeight: 'bold', marginTop: 2 },
  saveBtn: { backgroundColor: '#d9468f', padding: 16, borderRadius: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
});
