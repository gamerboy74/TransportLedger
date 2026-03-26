import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import ThemedDateField from '../../components/ThemedDateField';
import {
  addGSTEntry,
  addOtherDeduction,
  deleteGSTEntry,
  deleteOtherDeduction,
  deleteTripEntry,
  getDieselLogs,
  getGSTEntries,
  getOtherDeductions,
  getTransportOwner,
  getTripEntries,
  getVehicle,
  getVehiclePayments,
  softDeleteDieselLog,
} from '../../lib/queries';
import { calculateAdminEarnings, calculateSettlement } from '../../lib/calculations';
import { fmt, fmtDate, monthKey, monthLabel, round2 } from '../../constants/defaults';
import { useAppStore } from '../../store/useAppStore';
import type {
  AdminEarnings,
  DieselLog,
  GSTEntry,
  OtherDeduction,
  SettlementResult,
  TransportOwner,
  TripEntry,
  Vehicle,
} from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeleteModalState {
  type: 'trip' | 'diesel' | 'gst' | 'other';
  id: string;
  label: string;
}

interface ModalVisibilityState {
  showGST: boolean;
  showOther: boolean;
  delModal: DeleteModalState | null;
}

type ModalAction =
  | { type: 'OPEN_GST' }
  | { type: 'CLOSE_GST' }
  | { type: 'OPEN_OTHER' }
  | { type: 'CLOSE_OTHER' }
  | { type: 'OPEN_DEL'; payload: DeleteModalState }
  | { type: 'CLOSE_DEL' };

interface GSTModalProps {
  visible: boolean;
  vehicleId: string;
  gstRate: number;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}

interface OtherModalProps {
  visible: boolean;
  vehicleId: string;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}

interface MHeadProps {
  title: string;
  onClose: () => void;
}

interface MFProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  kb?: 'default' | 'decimal-pad' | 'numeric';
}

interface SaveBtnProps {
  saving: boolean;
  onPress: () => void;
  label: string;
}

interface RowProps {
  label: string;
  value: string;
  red?: boolean;
  green?: boolean;
  onDel?: () => void;
}

interface TRowProps {
  label: string;
  value: string;
  red?: boolean;
}

// ---------------------------------------------------------------------------
// Modal visibility reducer
// ---------------------------------------------------------------------------

const modalInitialState: ModalVisibilityState = {
  showGST: false,
  showOther: false,
  delModal: null,
};

function modalReducer(state: ModalVisibilityState, action: ModalAction): ModalVisibilityState {
  switch (action.type) {
    case 'OPEN_GST':    return { ...state, showGST: true };
    case 'CLOSE_GST':   return { ...state, showGST: false };
    case 'OPEN_OTHER':  return { ...state, showOther: true };
    case 'CLOSE_OTHER': return { ...state, showOther: false };
    case 'OPEN_DEL':    return { ...state, delModal: action.payload };
    case 'CLOSE_DEL':   return { ...state, delModal: null };
    default:            return state;
  }
}

// ---------------------------------------------------------------------------
// Custom hook: useVehicleData
// ---------------------------------------------------------------------------

interface UseVehicleDataResult {
  vehicle: Vehicle | null;
  owner: TransportOwner | null;
  trips: TripEntry[];
  diesel: DieselLog[];
  gst: GSTEntry[];
  others: OtherDeduction[];
  settlement: SettlementResult | null;
  adminE: AdminEarnings | null;
  totalPaid: number;
  loading: boolean;
  refreshing: boolean;
  load: (force?: boolean) => Promise<void>;
}

interface VehicleScreenCacheEntry {
  vehicle: Vehicle;
  owner: TransportOwner;
  trips: TripEntry[];
  diesel: DieselLog[];
  gst: GSTEntry[];
  others: OtherDeduction[];
  settlement: SettlementResult;
  adminE: AdminEarnings | null;
  totalPaid: number;
  at: number;
}

const VEHICLE_SCREEN_CACHE_TTL_MS = 60_000;
const vehicleScreenCache = new Map<string, VehicleScreenCacheEntry>();

function vehicleCacheKey(id: string | undefined, month: string): string {
  return `${id ?? 'none'}|${month}`;
}

function invalidateVehicleScreenCache(id?: string, month?: string) {
  if (!id && !month) {
    vehicleScreenCache.clear();
    return;
  }
  for (const key of vehicleScreenCache.keys()) {
    const [cachedId, cachedMonth] = key.split('|');
    if (id && cachedId !== id) continue;
    if (month && cachedMonth !== month) continue;
    vehicleScreenCache.delete(key);
  }
}

function useVehicleData(id: string | undefined, month: string): UseVehicleDataResult {
  const [vehicle, setVehicle]       = useState<Vehicle | null>(null);
  const [owner, setOwner]           = useState<TransportOwner | null>(null);
  const [trips, setTrips]           = useState<TripEntry[]>([]);
  const [diesel, setDiesel]         = useState<DieselLog[]>([]);
  const [gst, setGST]               = useState<GSTEntry[]>([]);
  const [others, setOthers]         = useState<OtherDeduction[]>([]);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [adminE, setAdminE]         = useState<AdminEarnings | null>(null);
  const [totalPaid, setTotalPaid]   = useState(0);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const requestSeqRef      = useRef(0);
  const notice             = useThemedNotice();
  const cacheKey = useMemo(() => vehicleCacheKey(id, month), [id, month]);

  useEffect(() => {
    const cached = vehicleScreenCache.get(cacheKey);
    if (!cached) return;
    setVehicle(cached.vehicle);
    setOwner(cached.owner);
    setTrips(cached.trips);
    setDiesel(cached.diesel);
    setGST(cached.gst);
    setOthers(cached.others);
    setSettlement(cached.settlement);
    setAdminE(cached.adminE);
    setTotalPaid(cached.totalPaid);
    setLoading(false);
  }, [cacheKey]);

  const load = useCallback(async (force = false) => {
    if (!id) return;
    const seq = ++requestSeqRef.current;
    const now = Date.now();
    if (force) setRefreshing(true);

    const cached = vehicleScreenCache.get(cacheKey);
    if (!force && cached && now - cached.at < VEHICLE_SCREEN_CACHE_TTL_MS) {
      setRefreshing(false);
      setLoading(false);
      return;
    }

    try {
      const v = await getVehicle(id);
      if (!v) throw new Error('Vehicle not found');
      const o = await getTransportOwner(v.transport_owner_id);
      if (!o) throw new Error('Owner not found');

      const [t, d, g, oth, paid] = await Promise.all([
        getTripEntries(id, month),
        getDieselLogs(id, month),
        getGSTEntries(id, month),
        getOtherDeductions(id, month),
        getVehiclePayments(id, month),
      ]);

      if (seq !== requestSeqRef.current) return;

      const effectiveCommissionRate = Number(v.commission_rate ?? o.commission_rate ?? 0);
      const effectiveAccidentalRate = Number(v.accidental_rate ?? o.accidental_rate ?? 0);

      const { globalSettings } = useAppStore.getState();
      const s = calculateSettlement({
        trips: t,
        diesel: d,
        commissionRate: effectiveCommissionRate,
        accidentalRate: effectiveAccidentalRate,
        tdsRate: globalSettings.tds_rate,
        gstEntries: g,
        otherDeductions: oth,
      });

      const ae = calculateAdminEarnings({
        totalTonnes:    s.totalTonnes,
        commissionRate: effectiveCommissionRate,
        diesel:         d,
        gstEntries:     g,
        buyRate:        globalSettings.diesel_buy_rate,
        sellRate:       globalSettings.diesel_sell_rate,
      });

      const cacheEntry: VehicleScreenCacheEntry = {
        vehicle: v,
        owner: o,
        trips: t,
        diesel: d,
        gst: g,
        others: oth,
        settlement: s,
        adminE: ae,
        totalPaid: paid,
        at: Date.now(),
      };
      vehicleScreenCache.set(cacheKey, cacheEntry);

      setVehicle(v);
      setOwner(o);
      setTrips(t);
      setDiesel(d);
      setGST(g);
      setOthers(oth);
      setSettlement(s);
      setAdminE(ae);
      setTotalPaid(paid);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      notice.showError('Error', String(e));
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [id, cacheKey, notice]);

  return {
    vehicle, owner, trips, diesel, gst, others,
    settlement, adminE, totalPaid,
    loading, refreshing,
    load,
  };
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function VehicleDetailScreen() {
  const { id, month: mParam } = useLocalSearchParams<{ id: string; month?: string }>();
  const initialMonth = mParam ?? monthKey();

  // ── State ─────────────────────────────────────────────────────────────────
  const [month, setMonth]         = useState(initialMonth);
  const [monthDate, setMonthDate] = useState(`${initialMonth}-01`);
  const [delReason, setDelReason] = useState('');
  const [modalState, dispatchModal] = useReducer(modalReducer, modalInitialState);

  const notice = useThemedNotice();

  // ── Data hook ─────────────────────────────────────────────────────────────
  const {
    vehicle, owner, trips, diesel, gst, others,
    settlement, adminE, totalPaid,
    loading, refreshing, load,
  } = useVehicleData(id, month);

  // ── Derived values ────────────────────────────────────────────────────────
  const outstanding = useMemo(
    () => (settlement ? round2(settlement.netPayable - totalPaid) : 0),
    [settlement, totalPaid],
  );

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const nextMonth = monthDate.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(nextMonth) && nextMonth !== month) {
      setMonth(nextMonth);
    }
  }, [monthDate, month]);

  useFocusEffect(useCallback(() => {
    load(false);
  }, [load]));

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const shiftMonth = useCallback((delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const date   = new Date(y, m - 1 + delta, 1);
    const next   = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setMonthDate(`${next}-01`);
  }, [month]);

  const handlePrevMonth = useCallback(() => shiftMonth(-1), [shiftMonth]);
  const handleNextMonth = useCallback(() => shiftMonth(1), [shiftMonth]);

  const handleOpenGST   = useCallback(() => dispatchModal({ type: 'OPEN_GST' }), []);
  const handleCloseGST  = useCallback(() => dispatchModal({ type: 'CLOSE_GST' }), []);
  const handleGSTSaved  = useCallback(() => {
    dispatchModal({ type: 'CLOSE_GST' });
    invalidateVehicleScreenCache(id, month);
    load(true);
  }, [id, month, load]);

  const handleOpenOther  = useCallback(() => dispatchModal({ type: 'OPEN_OTHER' }), []);
  const handleCloseOther = useCallback(() => dispatchModal({ type: 'CLOSE_OTHER' }), []);
  const handleOtherSaved = useCallback(() => {
    dispatchModal({ type: 'CLOSE_OTHER' });
    invalidateVehicleScreenCache(id, month);
    load(true);
  }, [id, month, load]);

  const handleCloseDel = useCallback(() => {
    dispatchModal({ type: 'CLOSE_DEL' });
    setDelReason('');
  }, []);

  const handleDelete = useCallback(async () => {
    const { delModal } = modalState;
    if (!delModal) return;
    if (delModal.type === 'diesel' && !delReason.trim()) {
      notice.showInfo('Required', 'Enter a reason');
      return;
    }
    try {
      if (delModal.type === 'diesel') await softDeleteDieselLog(delModal.id, delReason.trim());
      else if (delModal.type === 'trip')  await deleteTripEntry(delModal.id);
      else if (delModal.type === 'other') await deleteOtherDeduction(delModal.id);
      else if (delModal.type === 'gst')   await deleteGSTEntry(delModal.id);
      invalidateVehicleScreenCache(id, month);
      handleCloseDel();
      load(true);
    } catch (e) {
      notice.showError('Error', String(e));
    }
  }, [modalState, delReason, handleCloseDel, id, month, load, notice]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const tripRows = useMemo(() => trips.map(t => (
    <Row
      key={t.id}
      label={`${t.route_name ?? 'Route'} — ${t.tonnes}T × ₹${t.rate_snapshot}`}
      value={fmt(t.amount)}
      onDel={() => dispatchModal({ type: 'OPEN_DEL', payload: { type: 'trip', id: t.id, label: `${t.tonnes}T trip` } })}
    />
  )), [trips]);

  const dieselRows = useMemo(() => diesel.map(d => (
    <Row
      key={d.id}
      label={`${fmtDate(d.date)} — ${d.litres}L × ₹${d.sell_rate}`}
      value={`− ${fmt(d.amount)}`}
      red
      onDel={() => dispatchModal({ type: 'OPEN_DEL', payload: { type: 'diesel', id: d.id, label: `${d.litres}L diesel` } })}
    />
  )), [diesel]);

  const gstRows = useMemo(() => gst.map(g => (
    <Row
      key={g.id}
      label={`GST for ${monthLabel(g.belongs_to_month)}`}
      value={`+ ${fmt(g.net_gst)}`}
      green
      onDel={() => dispatchModal({ type: 'OPEN_DEL', payload: { type: 'gst', id: g.id, label: 'GST entry' } })}
    />
  )), [gst]);

  const otherRows = useMemo(() => others.map(o => (
    <Row
      key={o.id}
      label={o.label}
      value={`− ${fmt(o.amount)}`}
      red
      onDel={() => dispatchModal({ type: 'OPEN_DEL', payload: { type: 'other', id: o.id, label: o.label } })}
    />
  )), [others]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.loadingContainer}>
        <View style={{ marginTop: 12 }}>
          <SkeletonBlock style={{ height: 24, width: 240, marginBottom: 8 }} />
          <SkeletonBlock style={{ height: 12, width: 180 }} />
        </View>
        <View style={{ marginTop: 14 }}>
          <SkeletonCard>
            <SkeletonBlock style={{ height: 12, width: 110, marginBottom: 12 }} />
            <SkeletonBlock style={{ height: 42, borderRadius: 10, marginBottom: 10 }} />
            <View style={s.skeletonRow}>
              <SkeletonBlock style={{ height: 36, flex: 1 }} />
              <SkeletonBlock style={{ height: 36, flex: 1 }} />
            </View>
          </SkeletonCard>
          <SkeletonCard>
            <SkeletonBlock style={{ height: 18, width: 200, marginBottom: 10 }} />
            <SkeletonBlock style={{ height: 14, width: 140, marginBottom: 10 }} />
            <SkeletonBlock style={{ height: 14, width: 170, marginBottom: 10 }} />
            <SkeletonBlock style={{ height: 14, width: 150, marginBottom: 10 }} />
            <SkeletonBlock style={{ height: 40, borderRadius: 10 }} />
          </SkeletonCard>
        </View>
      </SafeAreaView>
    );
  }

  if (!vehicle || !owner || !settlement) {
    return (
      <SafeAreaView style={s.errorContainer}>
        <Text style={s.errorText}>Could not load vehicle data</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={s.backLink}>← Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      {/* Decorative blobs */}
      <View style={s.blobTopLeft} />
      <View style={s.blobBottomRight} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={s.headerTextGroup}>
          <Text style={s.headerTitle}>{vehicle.reg_number}</Text>
          <Text style={s.headerSub} numberOfLines={1} ellipsizeMode="tail">
            {owner.name} · {monthLabel(month)}
          </Text>
        </View>
        <View style={s.headerAmount}>
          <Text style={[s.headerAmountValue, { color: outstanding <= 0 ? '#22c55e' : '#f59e0b' }]}>
            {fmt(Math.abs(outstanding))}
          </Text>
          <Text style={s.headerAmountLabel}>{outstanding <= 0 ? '✓ PAID' : 'outstanding'}</Text>
        </View>
      </View>

      {/* Month picker */}
      <View style={s.monthPickerWrapper}>
        <View style={s.monthPickerCard}>
          <Text style={s.sectionLabel}>Settlement Month</Text>
          <ThemedDateField label="Month" value={monthDate} onChange={setMonthDate} required />
          <View style={s.monthBtnRow}>
            <TouchableOpacity onPress={handlePrevMonth} style={s.monthBtn}>
              <Text style={s.monthBtnText}>Previous Month</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleNextMonth} style={s.monthBtn}>
              <Text style={s.monthBtnText}>Next Month</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor="#ec4899"
          />
        }
      >
        {/* Settlement breakdown */}
        <View style={s.card}>
          <Text style={s.cardTitle}>📋 Settlement Breakdown</Text>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
  <SL>① WEIGHT EARNINGS</SL>
  <TouchableOpacity onPress={() => router.push({ pathname: '/trip-history' as any, params: { vehicleId: id, month, ownerId: vehicle?.transport_owner_id } })}>
    <Ionicons name="time-outline" size={18} color="#d9468f" />
  </TouchableOpacity>
</View>
          {tripRows}
          {trips.length === 0 && <Text style={s.emptyText}>No trips this month</Text>}
          <TRow label="GROSS EARNING" value={fmt(settlement.gross)} />

          <SL>② DEDUCTIONS</SL>
          <Row 
            label={`TDS @ ${(useAppStore.getState().globalSettings.tds_rate * 100).toFixed(1)}%`} 
            value={`− ${fmt(settlement.tds)}`} 
            red 
          />
          <Row
            label={`Commission (${settlement.totalTonnes}T × ₹${vehicle.commission_rate})`}
            value={`− ${fmt(settlement.commission)}`}
            red
          />
          <Row
            label={`Accidental (${settlement.totalTonnes}T × ₹${vehicle.accidental_rate})`}
            value={`− ${fmt(settlement.accidental)}`}
            red
          />

          <SL>⛽ DIESEL</SL>
          {dieselRows}
          {diesel.length === 0 && <Text style={s.emptyText}>No diesel this month</Text>}
          <TRow label="DIESEL TOTAL" value={`− ${fmt(settlement.dieselTotal)}`} red />

          <View style={s.sectionHeaderRow}>
            <SL>③ GST RECEIVED</SL>
            <TouchableOpacity onPress={handleOpenGST}>
              <Text style={s.addLink}>+ Add GST</Text>
            </TouchableOpacity>
          </View>
          {gstRows}
          {gst.length === 0 && <Text style={s.emptyText}>No GST this month</Text>}

          <View style={s.sectionHeaderRow}>
            <SL>④ OTHER DEDUCTIONS</SL>
            <TouchableOpacity onPress={handleOpenOther}>
              <Text style={s.addLink}>+ Add</Text>
            </TouchableOpacity>
          </View>
          {otherRows}

          <View style={s.divider} />

          <View style={s.netPayableRow}>
            <Text style={s.netPayableLabel}>NET PAYABLE</Text>
            <Text style={s.netPayableValue}>{fmt(settlement.netPayable)}</Text>
          </View>
          <View style={s.paidRow}>
            <Text style={s.subLabel}>Paid so far</Text>
            <Text style={s.subLabel}>{fmt(totalPaid)}</Text>
          </View>
          <View style={s.outstandingRow}>
            <Text style={s.outstandingLabel}>OUTSTANDING</Text>
            <Text style={[s.outstandingValue, { color: outstanding <= 0 ? '#22c55e' : '#f59e0b' }]}>
              {fmt(Math.abs(outstanding))}
            </Text>
          </View>
        </View>

        {/* Admin earnings */}
        {adminE && (
          <View style={s.adminCard}>
            <Text style={s.adminCardTitle}>🔒 YOUR EARNINGS (Private)</Text>
            {(
              [
                { label: 'Commission Income',    value: adminE.commissionIncome },
                { label: 'Diesel Profit (₹1.08/L)', value: adminE.dieselProfit },
                { label: 'GST Commission',       value: adminE.gstCommission },
              ] as const
            ).map(e => (
              <View key={e.label} style={s.adminRow}>
                <Text style={s.adminRowLabel}>{e.label}</Text>
                <Text style={s.adminRowValue}>{fmt(e.value)}</Text>
              </View>
            ))}
            <View style={s.divider} />
            <View style={s.adminTotalRow}>
              <Text style={s.adminTotalLabel}>TOTAL EARNED</Text>
              <Text style={s.adminTotalValue}>{fmt(adminE.totalEarnings)}</Text>
            </View>
          </View>
        )}

        <View style={{ height: 64 }} />
      </ScrollView>

      {/* Modals — conditionally rendered */}
      {modalState.showGST && vehicle && (
        <GSTModal
          visible={modalState.showGST}
          vehicleId={vehicle.id}
          gstRate={vehicle.gst_commission_rate}
          month={month}
          onClose={handleCloseGST}
          onSaved={handleGSTSaved}
        />
      )}

      {modalState.showOther && vehicle && (
        <OtherModal
          visible={modalState.showOther}
          vehicleId={vehicle.id}
          month={month}
          onClose={handleCloseOther}
          onSaved={handleOtherSaved}
        />
      )}

      {/* Delete modal */}
      <Modal
        visible={!!modalState.delModal}
        animationType="fade"
        transparent
        onRequestClose={handleCloseDel}
      >
        <Pressable style={s.modalOverlay} onPress={handleCloseDel}>
          <Pressable onPress={e => e.stopPropagation()} style={s.delSheet}>
            <Text style={s.delTitle}>Delete Entry</Text>
            <Text style={s.delSubtitle}>{modalState.delModal?.label}</Text>
            {modalState.delModal?.type === 'diesel' && (
              <View style={{ marginBottom: 16 }}>
                <Text style={s.fieldLabel}>Reason *</Text>
                <TextInput
                  style={s.textInput}
                  value={delReason}
                  onChangeText={setDelReason}
                  placeholder="e.g. Wrong entry, duplicate"
                  placeholderTextColor="#9f8b97"
                />
              </View>
            )}
            <View style={s.delBtnRow}>
              <TouchableOpacity onPress={handleCloseDel} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete} style={s.deleteBtn}>
                <Text style={s.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const SL = React.memo(function SL({ children }: { children: string }) {
  return <Text style={s.slText}>{children}</Text>;
});

const Row = React.memo(function Row({ label, value, red, green, onDel }: RowProps) {
  return (
    <View style={s.rowContainer}>
      <Text style={s.rowLabel} numberOfLines={2}>{label}</Text>
      <Text style={[s.rowValue, red ? s.redText : green ? s.greenText : s.darkText]}>{value}</Text>
      {onDel && (
        <TouchableOpacity onPress={onDel} style={{ marginLeft: 8 }}>
          <Text style={s.delIcon}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

const TRow = React.memo(function TRow({ label, value, red }: TRowProps) {
  return (
    <View style={s.tRowContainer}>
      <Text style={s.tRowLabel}>{label}</Text>
      <Text style={[s.tRowValue, red ? s.redText : s.darkText]}>{value}</Text>
    </View>
  );
});

// ---------------------------------------------------------------------------
// GSTModal
// ---------------------------------------------------------------------------

const GSTModal = React.memo(function GSTModal({
  visible, vehicleId, gstRate, month, onClose, onSaved,
}: GSTModalProps) {
  const [grossGST, setGrossGST] = useState('');
  const [forMonth, setForMonth] = useState(month);
  const [saving, setSaving]     = useState(false);
  const notice = useThemedNotice();

  const preview = useMemo(() => {
    const g = parseFloat(grossGST);
    if (isNaN(g)) return null;
    return { comm: round2(g * gstRate), net: round2(g - round2(g * gstRate)) };
  }, [grossGST, gstRate]);

  const save = useCallback(async () => {
    const g = parseFloat(grossGST);
    if (isNaN(g) || g <= 0) { notice.showInfo('Invalid', 'Enter valid GST amount'); return; }
    setSaving(true);
    try {
      await addGSTEntry({ vehicle_id: vehicleId, belongs_to_month: forMonth, gross_gst: g, gst_commission_rate: gstRate });
      setGrossGST('');
      onSaved();
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  }, [grossGST, vehicleId, forMonth, gstRate, notice, onSaved]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.modalSheet}>
        <MHead title="Add GST Entry" onClose={onClose} />
        <MF label="Gross GST Received (₹) *" value={grossGST} onChange={setGrossGST} placeholder="e.g. 89155" kb="decimal-pad" />
        <MF label="For Month (YYYY-MM) *" value={forMonth} onChange={setForMonth} />
        {preview && (
          <View style={s.previewCard}>
            <Text style={s.previewTitle}>GST BREAKDOWN</Text>
            <View style={s.previewRow}>
              <Text style={s.previewRowLabel}>Gross GST</Text>
              <Text style={s.darkText}>{fmt(parseFloat(grossGST))}</Text>
            </View>
            <View style={s.previewRow}>
              <Text style={s.previewRowLabel}>Your commission ({(gstRate * 100).toFixed(0)}%)</Text>
              <Text style={s.previewComm}>− {fmt(preview.comm)}</Text>
            </View>
            <View style={s.previewRow}>
              <Text style={s.previewNetLabel}>Net GST to owner</Text>
              <Text style={s.previewNetValue}>+ {fmt(preview.net)}</Text>
            </View>
          </View>
        )}
        <SaveBtn saving={saving} onPress={save} label="Save GST Entry" />
      </View>
    </Modal>
  );
});

// ---------------------------------------------------------------------------
// OtherModal
// ---------------------------------------------------------------------------

const OtherModal = React.memo(function OtherModal({
  visible, vehicleId, month, onClose, onSaved,
}: OtherModalProps) {
  const [label, setLabel]   = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  const save = useCallback(async () => {
    if (!label.trim()) { notice.showInfo('Required', 'Enter label'); return; }
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) { notice.showInfo('Invalid', 'Enter valid amount'); return; }
    setSaving(true);
    try {
      await addOtherDeduction({ vehicle_id: vehicleId, month, label: label.trim(), amount: a });
      setLabel('');
      setAmount('');
      onSaved();
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  }, [label, amount, vehicleId, month, notice, onSaved]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.modalSheet}>
        <MHead title="Add Deduction" onClose={onClose} />
        <MF label="Label *" value={label} onChange={setLabel} placeholder="e.g. GPS, Larcha" />
        <MF label="Amount (₹) *" value={amount} onChange={setAmount} placeholder="e.g. 6500" kb="decimal-pad" />
        <SaveBtn saving={saving} onPress={save} label="Save Deduction" />
      </View>
    </Modal>
  );
});

// ---------------------------------------------------------------------------
// Shared modal helpers
// ---------------------------------------------------------------------------

const MHead = React.memo(function MHead({ title, onClose }: MHeadProps) {
  return (
    <View style={s.mHeadRow}>
      <Text style={s.mHeadTitle}>{title}</Text>
      <TouchableOpacity onPress={onClose}>
        <Text style={s.mHeadCancel}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
});

const MF = React.memo(function MF({ label, value, onChange, placeholder, kb = 'default' }: MFProps) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.textInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#475569"
        keyboardType={kb}
        autoCapitalize="none"
      />
    </View>
  );
});

const SaveBtn = React.memo(function SaveBtn({ saving, onPress, label }: SaveBtnProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={saving}
      style={[s.saveBtn, saving && s.saveBtnDisabled]}
    >
      <Text style={s.saveBtnText}>{saving ? 'Saving...' : label}</Text>
    </TouchableOpacity>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  // Layout
  root:            { flex: 1, backgroundColor: '#fff7fb' },
  loadingContainer:{ flex: 1, backgroundColor: '#fff7fb', padding: 16 },
  errorContainer:  { flex: 1, backgroundColor: '#fff7fb', alignItems: 'center', justifyContent: 'center' },
  errorText:       { color: '#ef4444' },
  backLink:        { color: '#db2777' },
  scroll:          { flex: 1, paddingHorizontal: 16 },

  // Decorative blobs
  blobTopLeft:     { position: 'absolute', top: 18, left: -46, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' },
  blobBottomRight: { position: 'absolute', top: 180, right: -66, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' },

  // Skeleton
  skeletonRow: { flexDirection: 'row', gap: 8 },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 20 },
  backArrow:        { color: '#db2777', fontSize: 18 },
  headerTextGroup:  { flex: 1, minWidth: 0 },
  headerTitle:      { color: '#111111', fontSize: 20, fontWeight: 'bold' },
  headerSub:        { color: '#6b5c67', fontSize: 12 },
  headerAmount:     { alignItems: 'flex-end' },
  headerAmountValue:{ fontWeight: 'bold', fontSize: 16 },
  headerAmountLabel:{ color: '#6b5c67', fontSize: 11 },

  // Month picker
  monthPickerWrapper: { paddingHorizontal: 16, paddingBottom: 8 },
  monthPickerCard:    { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 12 },
  sectionLabel:       { color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  monthBtnRow:        { flexDirection: 'row', gap: 8 },
  monthBtn:           { flex: 1, backgroundColor: '#fce7f3', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  monthBtnText:       { color: '#111111', fontWeight: '700' },

  // Cards
  card:      { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#111111', fontWeight: 'bold', fontSize: 16, marginBottom: 16 },
  adminCard: { backgroundColor: '#ffffffcc', borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f2d7e6' },

  // SL
  slText: { color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },

  // Row
  rowContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowLabel:     { color: '#6b5c67', fontSize: 12, flex: 1, marginRight: 8 },
  rowValue:     { fontSize: 12, fontWeight: '600' },

  // TRow
  tRowContainer: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f2d7e6', marginTop: 4 },
  tRowLabel:     { color: '#6b5c67', fontSize: 12, fontWeight: 'bold' },
  tRowValue:     { fontSize: 13, fontWeight: 'bold' },

  // Colors
  redText:   { color: '#ef4444' },
  greenText: { color: '#22c55e' },
  darkText:  { color: '#111111', fontSize: 13 },
  delIcon:   { color: '#6b5c67', fontSize: 13 },

  // Section header row (GST / Other)
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addLink:          { color: '#db2777', fontSize: 12, fontWeight: '700' },

  // Empty
  emptyText: { color: '#6b5c67', fontSize: 12, marginBottom: 8 },

  // Divider
  divider: { height: 1, backgroundColor: '#f2d7e6', marginVertical: 14 },

  // Net payable
  netPayableRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  netPayableLabel: { color: '#111111', fontWeight: 'bold', fontSize: 16 },
  netPayableValue: { color: '#be185d', fontWeight: 'bold', fontSize: 22 },
  paidRow:         { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  subLabel:        { color: '#6b5c67', fontSize: 12 },
  outstandingRow:  { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  outstandingLabel:{ color: '#111111', fontWeight: '700' },
  outstandingValue:{ fontWeight: 'bold', fontSize: 18 },

  // Admin card
  adminCardTitle: { color: '#be185d', fontWeight: 'bold', marginBottom: 12 },
  adminRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  adminRowLabel:  { color: '#6b5c67', fontSize: 13 },
  adminRowValue:  { color: '#111111', fontSize: 13, fontWeight: '500' },
  adminTotalRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  adminTotalLabel:{ color: '#be185d', fontWeight: '700' },
  adminTotalValue:{ color: '#be185d', fontWeight: 'bold', fontSize: 16 },

  // Modal overlay / delete sheet
  modalOverlay: { flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' },
  delSheet:     { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  delTitle:     { color: '#111111', fontWeight: 'bold', fontSize: 18, marginBottom: 4 },
  delSubtitle:  { color: '#6b5c67', marginBottom: 16 },
  delBtnRow:    { flexDirection: 'row', gap: 10 },
  cancelBtn:    { flex: 1, backgroundColor: '#fce7f3', borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelBtnText:{ color: '#111111', fontWeight: '700' },
  deleteBtn:    { flex: 1, backgroundColor: '#ef4444', borderRadius: 12, padding: 14, alignItems: 'center' },
  deleteBtnText:{ color: 'white', fontWeight: 'bold' },

  // Modal sheet
  modalSheet: { flex: 1, backgroundColor: '#fff7fb', padding: 20 },

  // MHead
  mHeadRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  mHeadTitle:  { color: '#111111', fontSize: 20, fontWeight: 'bold' },
  mHeadCancel: { color: '#db2777' },

  // MF / TextInput
  fieldLabel: { color: '#6b5c67', fontSize: 11, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  textInput:  { backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 12, padding: 14 },

  // SaveBtn
  saveBtn:        { backgroundColor: '#ec4899', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnDisabled:{ backgroundColor: '#d4d4d8' },
  saveBtnText:    { color: 'white', fontWeight: 'bold', fontSize: 16 },

  // GST preview
  previewCard:     { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  previewTitle:    { color: '#6b5c67', fontSize: 12, marginBottom: 8 },
  previewRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  previewRowLabel: { color: '#6b5c67', fontSize: 13 },
  previewComm:     { color: '#be185d', fontSize: 13 },
  previewNetLabel: { color: '#111111', fontSize: 13, fontWeight: 'bold' },
  previewNetValue: { color: '#22c55e', fontSize: 13, fontWeight: 'bold' },
});
