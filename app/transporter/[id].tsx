import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  Modal, TextInput, StyleSheet,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import ThemedConfirmModal from '../../components/ThemedConfirmModal';
import ThemedDateField from '../../components/ThemedDateField';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTransportOwner, getVehicles, getTransportIncome, getTotalPayments,
  getPayments, upsertTransportIncome, addPayment, deletePayment, upsertVehicle, deleteVehicle,
  getTripEntries, getDieselLogs, getGSTEntries, getOtherDeductions, getVehiclePayments,
  searchVehiclesByRegNumber,
} from '../../lib/queries';
import type { VehicleSearchResult } from '../../lib/queries';
import { calculateSettlement } from '../../lib/calculations';
import { fmt, fmtDate, monthKey, monthLabel, round2 } from '../../constants/defaults';
import type { TransportOwner, Vehicle, Payment, TransportIncome } from '../../types';
import { useAppStore } from '../../store/useAppStore';

// ─── Constants ───────────────────────────────────────────────────────────────

const SWIPE_FRICTION = 1.8;
const SWIPE_RIGHT_THRESHOLD = 32;
const SWIPE_DRAG_OFFSET = 24;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransporterData {
  owner: TransportOwner | null;
  vehicles: Vehicle[];
  income: TransportIncome | null;
  totalPaid: number;
  payments: Payment[];
  loading: boolean;
  refreshing: boolean;
  load: (force?: boolean) => Promise<void>;
  refresh: () => void;
}


// Modal state managed via useReducer
type ModalState = {
  showIncome: boolean;
  showPayment: boolean;
  showVehicle: boolean;
  editingVehicle: Vehicle | null;
  paymentToDelete: Payment | null;
  vehicleToDelete: Vehicle | null;
};

type ModalAction =
  | { type: 'OPEN_INCOME' }
  | { type: 'CLOSE_INCOME' }
  | { type: 'OPEN_PAYMENT' }
  | { type: 'CLOSE_PAYMENT' }
  | { type: 'OPEN_VEHICLE'; vehicle?: Vehicle }
  | { type: 'CLOSE_VEHICLE' }
  | { type: 'SET_PAYMENT_TO_DELETE'; payment: Payment | null }
  | { type: 'SET_VEHICLE_TO_DELETE'; vehicle: Vehicle | null };

const initialModalState: ModalState = {
  showIncome: false,
  showPayment: false,
  showVehicle: false,
  editingVehicle: null,
  paymentToDelete: null,
  vehicleToDelete: null,
};

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case 'OPEN_INCOME':   return { ...state, showIncome: true };
    case 'CLOSE_INCOME':  return { ...state, showIncome: false };
    case 'OPEN_PAYMENT':  return { ...state, showPayment: true };
    case 'CLOSE_PAYMENT': return { ...state, showPayment: false };
    case 'OPEN_VEHICLE':  return { ...state, showVehicle: true, editingVehicle: action.vehicle ?? null };
    case 'CLOSE_VEHICLE': return { ...state, showVehicle: false, editingVehicle: null };
    case 'SET_PAYMENT_TO_DELETE': return { ...state, paymentToDelete: action.payment };
    case 'SET_VEHICLE_TO_DELETE': return { ...state, vehicleToDelete: action.vehicle };
    default: return state;
  }
}

// ─── Custom Hook: useTransporterData ─────────────────────────────────────────

function useTransporterData(id: string | undefined, month: string): TransporterData {
  const queryClient = useQueryClient();

  const ownerQ = useQuery({
    queryKey: ['transportOwner', id],
    queryFn: () => getTransportOwner(id!),
    enabled: !!id,
  });

  const vehiclesQ = useQuery({
    queryKey: ['vehicles', id],
    queryFn: () => getVehicles(id!),
    enabled: !!id,
  });

  const incomeQ = useQuery({
    queryKey: ['transportIncome', id, month],
    queryFn: () => getTransportIncome(id!, month),
    enabled: !!id,
  });

  const totalPaidQ = useQuery({
    queryKey: ['totalPayments', id, month],
    queryFn: () => getTotalPayments(id!, month),
    enabled: !!id,
  });

  const paymentsQ = useQuery({
    queryKey: ['payments', id, month],
    queryFn: () => getPayments(id!, month),
    enabled: !!id,
  });

  const loading = ownerQ.isLoading || vehiclesQ.isLoading || incomeQ.isLoading || totalPaidQ.isLoading || paymentsQ.isLoading;
  const refreshing = ownerQ.isFetching || vehiclesQ.isFetching || incomeQ.isFetching || totalPaidQ.isFetching || paymentsQ.isFetching;

  const refresh = useCallback(async () => {
    await Promise.all([
      ownerQ.refetch(), vehiclesQ.refetch(), incomeQ.refetch(), totalPaidQ.refetch(), paymentsQ.refetch()
    ]);
  }, [ownerQ, vehiclesQ, incomeQ, totalPaidQ, paymentsQ]);

  return {
    owner: ownerQ.data ?? null,
    vehicles: vehiclesQ.data ?? [],
    income: incomeQ.data ?? null,
    totalPaid: totalPaidQ.data ?? 0,
    payments: paymentsQ.data ?? [],
    loading,
    refreshing,
    load: () => refresh(),
    refresh
  };
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function TransporterDetailScreen() {
  const { id, month: mParam } = useLocalSearchParams<{ id: string; month?: string }>();
  const initialMonth = mParam ?? monthKey();

  // Month state
  const [month, setMonth]       = useState(initialMonth);
  const [monthDate, setMonthDate] = useState(`${initialMonth}-01`);

  // Modal state via reducer
  const [modalState, dispatchModal] = useReducer(modalReducer, initialModalState);

  // Swipe tracking
  const [openVehicleSwipeId, setOpenVehicleSwipeId] = useState<string | null>(null);
  const [openPaymentSwipeId, setOpenPaymentSwipeId] = useState<string | null>(null);
  const vehicleSwipeRefs = useRef<Record<string, Swipeable | null>>({});
  const paymentSwipeRefs = useRef<Record<string, Swipeable | null>>({});

  const queryClient = useQueryClient();
  const notice = useThemedNotice();
  const { owner, vehicles, income, totalPaid, payments, loading, refreshing, load, refresh } =
    useTransporterData(id, month);

  // Derived values
  const totalIncome = useMemo(
    () => round2((income?.transport_payment ?? 0) + (income?.diesel_payment ?? 0)),
    [income?.transport_payment, income?.diesel_payment],
  );
  const balance = useMemo(() => round2(totalIncome - totalPaid), [totalIncome, totalPaid]);
  // Set of vehicle IDs belonging to this owner — used by PaymentCard to detect cross-owner payments
  const ownerVehicleIds = useMemo(() => new Set(vehicles.map(v => v.id)), [vehicles]);

  // Month navigation
  useEffect(() => {
    const nextMonth = monthDate.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(nextMonth) && nextMonth !== month) {
      setMonth(nextMonth);
      refresh();
    }
  }, [monthDate, month, refresh]);

  const shiftMonth = useCallback((delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setMonthDate(`${next}-01`);
  }, [month]);

  // Modal handlers
  const handleOpenIncome  = useCallback(() => dispatchModal({ type: 'OPEN_INCOME' }),  []);
  const handleCloseIncome = useCallback(() => dispatchModal({ type: 'CLOSE_INCOME' }), []);
  const handleIncomeSaved = useCallback(() => {
    dispatchModal({ type: 'CLOSE_INCOME' });
    void queryClient.invalidateQueries({ queryKey: ['transportIncome', id, month] });
    void queryClient.invalidateQueries({ queryKey: ['homeSummary', month] });
  }, [id, month, queryClient]);

  const handleOpenPayment  = useCallback(() => dispatchModal({ type: 'OPEN_PAYMENT' }),  []);
  const handleClosePayment = useCallback(() => dispatchModal({ type: 'CLOSE_PAYMENT' }), []);
  const handlePaymentSaved = useCallback(() => {
    dispatchModal({ type: 'CLOSE_PAYMENT' });
    void queryClient.invalidateQueries({ queryKey: ['payments', id, month] });
    void queryClient.invalidateQueries({ queryKey: ['totalPayments', id, month] });
  }, [id, month, queryClient]);

  const handleOpenVehicle = useCallback((vehicle?: Vehicle) => dispatchModal({ type: 'OPEN_VEHICLE', vehicle }), []);
  const handleCloseVehicle = useCallback(() => dispatchModal({ type: 'CLOSE_VEHICLE' }), []);
  const handleVehicleSaved = useCallback(() => {
    dispatchModal({ type: 'CLOSE_VEHICLE' });
    void queryClient.invalidateQueries({ queryKey: ['vehicles', id] });
  }, [id, queryClient]);

  const closeAllSwipes = useCallback((exceptVehicleId?: string, exceptPaymentId?: string) => {
    if (openVehicleSwipeId && openVehicleSwipeId !== exceptVehicleId) {
      vehicleSwipeRefs.current[openVehicleSwipeId]?.close();
    }
    if (openPaymentSwipeId && openPaymentSwipeId !== exceptPaymentId) {
      paymentSwipeRefs.current[openPaymentSwipeId]?.close();
    }
  }, [openVehicleSwipeId, openPaymentSwipeId]);

  // ── Loading skeleton ──
  if (loading) return (
    <SafeAreaView style={styles.loadingContainer}>
      <View style={{ marginTop: 12 }}>
        <SkeletonBlock style={{ height: 24, width: 220, marginBottom: 8 }} />
        <SkeletonBlock style={{ height: 12, width: 120 }} />
      </View>
      <View style={{ marginTop: 14 }}>
        <SkeletonCard>
          <SkeletonBlock style={{ height: 12, width: 100, marginBottom: 12 }} />
          <SkeletonBlock style={{ height: 42, borderRadius: 10, marginBottom: 10 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SkeletonBlock style={{ height: 36, flex: 1 }} />
            <SkeletonBlock style={{ height: 36, flex: 1 }} />
          </View>
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonBlock style={{ height: 16, width: 180, marginBottom: 10 }} />
          <SkeletonBlock style={{ height: 52, borderRadius: 10, marginBottom: 8 }} />
          <SkeletonBlock style={{ height: 52, borderRadius: 10, marginBottom: 8 }} />
          <SkeletonBlock style={{ height: 52, borderRadius: 10 }} />
        </SkeletonCard>
      </View>
    </SafeAreaView>
  );

  if (!owner) return (
    <SafeAreaView style={styles.notFoundContainer}>
      <Text style={styles.errorText}>Owner not found</Text>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
        <Text style={styles.backLink}>← Go back</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root}>
      {/* Decorative blobs */}
      <View style={styles.blobTopRight} />
      <View style={styles.blobBottomLeft} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">{owner.name}</Text>
          <Text style={styles.headerSubtitle}>{monthLabel(month)}</Text>
        </View>
      </View>

      {/* Month picker */}
      <View style={styles.monthPickerWrap}>
        <View style={styles.monthPickerCard}>
          <Text style={styles.sectionLabel}>Records Month</Text>
          <ThemedDateField label="Month" value={monthDate} onChange={setMonthDate} required />
          <View style={styles.monthNavRow}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.monthNavBtn}>
              <Text style={styles.monthNavText}>Previous Month</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.monthNavBtn}>
              <Text style={styles.monthNavText}>Next Month</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#ec4899" />
        }
      >
        {/* Balance card */}
        <View style={styles.balanceCard}>
          <View style={styles.statsRow}>
            <Stat label="Transport Pay"  value={fmt(income?.transport_payment ?? 0)} />
            <Stat label="Diesel Pay"     value={fmt(income?.diesel_payment ?? 0)} />
            <Stat label="Total Income"   value={fmt(totalIncome)} highlight />
          </View>
          <View style={styles.divider} />
          <View style={styles.paidRow}>
            <View>
              <Text style={styles.smallLabel}>Total Paid Out</Text>
              <Text style={styles.paidValue}>{fmt(totalPaid)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.smallLabel}>Balance</Text>
              <Text style={[styles.balanceValue, { color: balance >= 0 ? '#22c55e' : '#ef4444' }]}>
                {fmt(Math.abs(balance))}
              </Text>
              {balance < 0 && <Text style={styles.overpaidLabel}>OVERPAID</Text>}
            </View>
          </View>
          <TouchableOpacity onPress={handleOpenIncome} style={styles.updateIncomeBtn}>
            <Text style={styles.updateIncomeBtnText}>✏️ Update Income Received</Text>
          </TouchableOpacity>
        </View>

        {/* Vehicles */}
        <View style={styles.swipeHint}>
          <Text style={styles.swipeHintText}>Swipe left for edit/delete</Text>
        </View>
        <SectionHeader title="Vehicles" onAdd={() => handleOpenVehicle()} />
        {vehicles.map(v => (
          <VehicleCard
            key={v.id}
            vehicle={v}
            month={month}
            swipeRef={(ref) => { vehicleSwipeRefs.current[v.id] = ref; }}
            isOpen={openVehicleSwipeId === v.id}
            onWillOpen={() => {
              closeAllSwipes(v.id, undefined);
              setOpenVehicleSwipeId(v.id);
              setOpenPaymentSwipeId(null);
            }}
            onClose={() => { if (openVehicleSwipeId === v.id) setOpenVehicleSwipeId(null); }}
            onEdit={() => {
              vehicleSwipeRefs.current[v.id]?.close();
              handleOpenVehicle(v);
            }}
            onDelete={() => {
              vehicleSwipeRefs.current[v.id]?.close();
              dispatchModal({ type: 'SET_VEHICLE_TO_DELETE', vehicle: v });
            }}
          />
        ))}
        {vehicles.length === 0 && (
          <Text style={styles.emptyText}>No vehicles added yet</Text>
        )}

        {/* Payments */}
        <View style={styles.swipeHint}>
          <Text style={styles.swipeHintText}>Swipe left to delete payment</Text>
        </View>
        <SectionHeader title={`Payments (${payments.length})`} onAdd={handleOpenPayment} />
        {payments.map((p, i) => (
          <PaymentCard
            key={p.id}
            payment={p}
            index={i}
            ownerVehicleIds={ownerVehicleIds}
            swipeRef={(ref) => { paymentSwipeRefs.current[p.id] = ref; }}
            isOpen={openPaymentSwipeId === p.id}
            onWillOpen={() => {
              closeAllSwipes(undefined, p.id);
              setOpenPaymentSwipeId(p.id);
              setOpenVehicleSwipeId(null);
            }}
            onClose={() => { if (openPaymentSwipeId === p.id) setOpenPaymentSwipeId(null); }}
            onDelete={() => {
              paymentSwipeRefs.current[p.id]?.close();
              dispatchModal({ type: 'SET_PAYMENT_TO_DELETE', payment: p });
            }}
          />
        ))}
        {payments.length === 0 && (
          <Text style={styles.emptyText}>No payments this month</Text>
        )}

        <View style={{ height: 64 }} />
      </ScrollView>

      {/* Modals — conditionally mounted */}
      {modalState.showIncome && (
        <IncomeModal
          visible={modalState.showIncome}
          income={income}
          transportOwnerId={owner.id}
          month={month}
          onClose={handleCloseIncome}
          onSaved={handleIncomeSaved}
        />
      )}
      {modalState.showPayment && (
        <PaymentModal
          visible={modalState.showPayment}
          transportOwnerId={owner.id}
          vehicles={vehicles}
          month={month}
          ownerCommissionRate={owner.commission_rate}
          ownerAccidentalRate={owner.accidental_rate}
          maxAllowedAmount={balance}
          onClose={handleClosePayment}
          onSaved={handlePaymentSaved}
        />
      )}
      {modalState.showVehicle && (
        <VehicleModal
          visible={modalState.showVehicle}
          transportOwnerId={owner.id}
          ownerCommissionRate={owner.commission_rate}
          ownerAccidentalRate={owner.accidental_rate}
          vehicle={modalState.editingVehicle}
          onClose={handleCloseVehicle}
          onSaved={handleVehicleSaved}
        />
      )}

      <ThemedConfirmModal
        visible={!!modalState.paymentToDelete}
        title="Delete Payment"
        message={
          modalState.paymentToDelete
            ? `Delete ${fmt(modalState.paymentToDelete.amount)} payment to ${modalState.paymentToDelete.paid_to}?`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onCancel={() => dispatchModal({ type: 'SET_PAYMENT_TO_DELETE', payment: null })}
        onConfirm={async () => {
          if (!modalState.paymentToDelete) return;
          try {
            await deletePayment(modalState.paymentToDelete.id);
            dispatchModal({ type: 'SET_PAYMENT_TO_DELETE', payment: null });
            void queryClient.invalidateQueries({ queryKey: ['payments', id, month] });
            void queryClient.invalidateQueries({ queryKey: ['totalPayments', id, month] });
          } catch (e) {
            notice.showError('Error', String(e));
          }
        }}
      />

      <ThemedConfirmModal
        visible={!!modalState.vehicleToDelete}
        title="Delete Vehicle"
        message={
          modalState.vehicleToDelete
            ? `Delete vehicle ${modalState.vehicleToDelete.reg_number}? All linked entries (trips, diesel, GST, deductions) will also be removed.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onCancel={() => dispatchModal({ type: 'SET_VEHICLE_TO_DELETE', vehicle: null })}
        onConfirm={async () => {
          if (!modalState.vehicleToDelete) return;
          try {
            await deleteVehicle(modalState.vehicleToDelete.id);
            dispatchModal({ type: 'SET_VEHICLE_TO_DELETE', vehicle: null });
            notice.showSuccess('Deleted', 'Vehicle removed successfully.');
            void queryClient.invalidateQueries({ queryKey: ['vehicles', id] });
          } catch (e) {
            notice.showError('Error', String(e));
          }
        }}
      />
    </SafeAreaView>
  );
}

// ─── VehicleCard ─────────────────────────────────────────────────────────────

interface VehicleCardProps {
  vehicle: Vehicle;
  month: string;
  swipeRef: (ref: Swipeable | null) => void;
  isOpen: boolean;
  onWillOpen: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const VehicleCard = React.memo(function VehicleCard({
  vehicle: v, month, swipeRef, onWillOpen, onClose, onEdit, onDelete, isOpen,
}: VehicleCardProps) {
  return (
    <Swipeable
      ref={swipeRef}
      friction={SWIPE_FRICTION}
      rightThreshold={SWIPE_RIGHT_THRESHOLD}
      dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}
      overshootRight={false}
      onSwipeableWillOpen={onWillOpen}
      onSwipeableClose={onClose}
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          <TouchableOpacity
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit vehicle"
            style={[styles.swipeBtn, styles.swipeBtnEdit]}
          >
            <Ionicons name="create-outline" size={16} color="#ffffff" />
            <Text style={styles.swipeBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete vehicle"
            style={[styles.swipeBtn, styles.swipeBtnDelete]}
          >
            <Ionicons name="trash-outline" size={16} color="#ffffff" />
            <Text style={styles.swipeBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <TouchableOpacity
        onPress={() => router.push(`/vehicle/${v.id}?month=${month}`)}
        style={styles.vehicleRow}
      >
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.vehicleReg}>{v.reg_number}</Text>
          <Text style={styles.vehicleOwner}>{v.owner_name}</Text>
          <Text style={styles.vehicleRates}>
            Comm ₹{Number(v.commission_rate).toLocaleString('en-IN')}/T · Acc ₹{Number(v.accidental_rate).toLocaleString('en-IN')}/T
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    </Swipeable>
  );
});

// ─── PaymentCard ─────────────────────────────────────────────────────────────

interface PaymentCardProps {
  payment: Payment;
  index: number;
  /** IDs of vehicles owned by the current transport owner — used to detect cross-owner payments. */
  ownerVehicleIds: Set<string>;
  swipeRef: (ref: Swipeable | null) => void;
  isOpen: boolean;
  onWillOpen: () => void;
  onClose: () => void;
  onDelete: () => void;
}

const PaymentCard = React.memo(function PaymentCard({
  payment: p, index, ownerVehicleIds, swipeRef, onWillOpen, onClose, onDelete,
}: PaymentCardProps) {
  const isCrossOwner = !!p.vehicle_id && !ownerVehicleIds.has(p.vehicle_id);
  return (
    <Swipeable
      ref={swipeRef}
      friction={SWIPE_FRICTION}
      rightThreshold={SWIPE_RIGHT_THRESHOLD}
      dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}
      overshootRight={false}
      onSwipeableWillOpen={onWillOpen}
      onSwipeableClose={onClose}
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          <TouchableOpacity
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete payment"
            style={[styles.swipeBtn, styles.swipeBtnDelete]}
          >
            <Ionicons name="trash-outline" size={16} color="#ffffff" />
            <Text style={styles.swipeBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <View style={styles.paymentRow}>
        <View style={styles.paymentIndex}>
          <Text style={styles.paymentIndexText}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.paymentName}>{p.paid_to}</Text>
          <Text style={styles.paymentMeta}>
            {fmtDate(p.date)} · {p.mode.toUpperCase()}
            {p.reference ? ` #${p.reference}` : ''}
            {p.note ? ` · ${p.note}` : ''}
          </Text>
          {isCrossOwner && (
            <View style={styles.crossOwnerTag}>
              <Ionicons name="link-outline" size={10} color="#ec4899" />
              <Text style={styles.crossOwnerTagText}>Cross-owner vehicle</Text>
            </View>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
          <Text style={styles.paymentAmount}>{fmt(p.amount)}</Text>
        </View>
      </View>
    </Swipeable>
  );
});

// ─── Stat ─────────────────────────────────────────────────────────────────────

interface StatProps { label: string; value: string; highlight?: boolean }

const Stat = React.memo(function Stat({ label, value, highlight }: StatProps) {
  return (
    <View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && { color: '#be185d' }]}>{value}</Text>
    </View>
  );
});

// ─── SectionHeader ────────────────────────────────────────────────────────────

interface SectionHeaderProps { title: string; onAdd: () => void }

const SectionHeader = React.memo(function SectionHeader({ title, onAdd }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity onPress={onAdd}><Text style={styles.addBtn}>+ Add</Text></TouchableOpacity>
    </View>
  );
});

// ─── IncomeModal ──────────────────────────────────────────────────────────────

interface IncomeModalProps {
  visible: boolean;
  income: TransportIncome | null;
  transportOwnerId: string;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}

function IncomeModal({ visible, income, transportOwnerId, month, onClose, onSaved }: IncomeModalProps) {
  const [tp, setTp] = useState(income?.transport_payment?.toString() ?? '');
  const [dp, setDp] = useState(income?.diesel_payment?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  useEffect(() => {
    if (!visible) return;
    setTp(income?.transport_payment?.toString() ?? '');
    setDp(income?.diesel_payment?.toString() ?? '');
  }, [visible, income]);

  const queryClient = useQueryClient();
  const save = useCallback(async () => {
    const t = parseFloat(tp), d = parseFloat(dp);
    if (isNaN(t) || isNaN(d)) { notice.showInfo('Invalid', 'Enter valid amounts'); return; }
    setSaving(true);
    try {
      await upsertTransportIncome({ transport_owner_id: transportOwnerId, month, transport_payment: t, diesel_payment: d });
      void queryClient.invalidateQueries({ queryKey: ['transportIncome', transportOwnerId, month] });
      void queryClient.invalidateQueries({ queryKey: ['homeSummary', month] });
      void queryClient.invalidateQueries({ queryKey: ['transportersSummary', month] });
      onSaved();
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  }, [tp, dp, transportOwnerId, month, onSaved, notice, queryClient]);

  const [debouncedTp, setDebouncedTp] = useState(tp);
  const [debouncedDp, setDebouncedDp] = useState(dp);

  // Debounce for calculation
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTp(tp);
      setDebouncedDp(dp);
    }, 150);
    return () => clearTimeout(handler);
  }, [tp, dp]);

  const previewTotal = useMemo(() => {
    const t = parseFloat(debouncedTp), d = parseFloat(debouncedDp);
    return !isNaN(t) && !isNaN(d) ? round2(t + d) : null;
  }, [debouncedTp, debouncedDp]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <MHead title="Income Received" onClose={onClose} />
        <MF label="Transport Payment (₹) *" value={tp} onChange={setTp} kb="decimal-pad" />
        <MF label="Diesel Payment (₹) *" value={dp} onChange={setDp} kb="decimal-pad" />
        {previewTotal !== null && (
          <View style={styles.previewCard}>
            <Text style={styles.smallLabel}>Total Income</Text>
            <Text style={styles.previewTotal}>{fmt(previewTotal)}</Text>
          </View>
        )}
        <SaveBtn saving={saving} onPress={save} label="Save Income" />
      </View>
    </Modal>
  );
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────

interface PaymentModalProps {
  visible: boolean;
  transportOwnerId: string;
  vehicles: Vehicle[];
  month: string;
  ownerCommissionRate: number;
  ownerAccidentalRate: number;
  maxAllowedAmount: number;
  onClose: () => void;
  onSaved: () => void;
}

function PaymentModal({
  visible, transportOwnerId, vehicles, month,
  ownerCommissionRate, ownerAccidentalRate, maxAllowedAmount, onClose, onSaved,
}: PaymentModalProps) {
  const [paidTo, setPaidTo]   = useState('');
  const [amount, setAmount]   = useState('');
  const [date, setDate]       = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode]       = useState<'cheque' | 'upi' | 'other'>('cheque');
  const [ref, setRef]         = useState('');
  const [note, setNote]       = useState('');
  const [vehicleId, setVehicleId]               = useState<string | null>(null);
  const [vehicleNetPayable, setVehicleNetPayable] = useState<number | null>(null);
  const [loadingVehicleNet, setLoadingVehicleNet] = useState(false);
  const [saving, setSaving]   = useState(false);

  // ── Cross-owner vehicle search state ──
  const [vehicleTab, setVehicleTab]               = useState<'own' | 'other'>('own');
  const [crossOwnerVehicle, setCrossOwnerVehicle] = useState<VehicleSearchResult | null>(null);
  const [searchQuery, setSearchQuery]             = useState('');
  const [searchResults, setSearchResults]         = useState<VehicleSearchResult[]>([]);
  const [isSearching, setIsSearching]             = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notice = useThemedNotice();

  // ── Load net payable for any selected vehicle (own OR cross-owner) ──
  useEffect(() => {
    if (!visible || !vehicleId) { setVehicleNetPayable(null); return; }
    let cancelled = false;
    const loadVehicleNetPayable = async () => {
      setLoadingVehicleNet(true);
      try {
        // Use the selected vehicle's own rates (accurate for cross-owner vehicles)
        const ownVehicle    = vehicles.find(v => v.id === vehicleId);
        const effectiveVeh  = ownVehicle ?? crossOwnerVehicle;
        const effectiveCommissionRate = Number(effectiveVeh?.commission_rate ?? ownerCommissionRate ?? 0);
        const effectiveAccidentalRate = Number(effectiveVeh?.accidental_rate ?? ownerAccidentalRate ?? 0);
        const [trips, diesel, gst, others, paid] = await Promise.all([
          getTripEntries(vehicleId, month),
          getDieselLogs(vehicleId, month),
          getGSTEntries(vehicleId, month),
          getOtherDeductions(vehicleId, month),
          getVehiclePayments(vehicleId, month),
        ]);
        if (cancelled) return;
        const { globalSettings } = useAppStore.getState();
        const settlement = calculateSettlement({
          trips, diesel,
          commissionRate: effectiveCommissionRate,
          accidentalRate: effectiveAccidentalRate,
          tdsRate: globalSettings.tds_rate,
          gstEntries: gst,
          otherDeductions: others,
        });
        const payable = round2(settlement.netPayable - paid);
        setVehicleNetPayable(payable);
        setAmount(payable > 0 ? String(payable) : '');
      } catch (e) {
        if (!cancelled) {
          setVehicleNetPayable(null);
          notice.showError('Error', 'Could not load selected vehicle payable.');
        }
      } finally {
        if (!cancelled) setLoadingVehicleNet(false);
      }
    };
    void loadVehicleNetPayable();
    return () => { cancelled = true; };
  }, [visible, vehicleId, month, ownerCommissionRate, ownerAccidentalRate, notice, vehicles, crossOwnerVehicle]);

  const queryClient = useQueryClient();
  const save = useCallback(async () => {
    if (!paidTo.trim()) { notice.showInfo('Required', 'Enter payee name'); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { notice.showInfo('Invalid', 'Enter valid amount'); return; }
    if (amt > maxAllowedAmount) {
      notice.showError('Overpayment Not Allowed', `Remaining balance for ${monthLabel(month)} is ${fmt(maxAllowedAmount)}. You cannot pay more than this.`);
      return;
    }
    if (mode === 'cheque' && !ref.trim()) { notice.showInfo('Required', 'Cheque reference is required'); return; }
    setSaving(true);
    try {
      await addPayment({
        transport_owner_id: transportOwnerId,
        vehicle_id: vehicleId,
        paid_to: paidTo.trim(),
        amount: amt,
        date,
        mode,
        reference: ref.trim() || null,
        note: note.trim() || null,
        month,
      });
      void queryClient.invalidateQueries({ queryKey: ['payments', transportOwnerId, month] });
      void queryClient.invalidateQueries({ queryKey: ['totalPayments', transportOwnerId, month] });
      void queryClient.invalidateQueries({ queryKey: ['transportersSummary', month] });
      setPaidTo(''); setAmount(''); setRef(''); setNote('');
      setVehicleId(null); setCrossOwnerVehicle(null);
      setSearchQuery(''); setSearchResults([]);
      setVehicleTab('own');
      onSaved();
      notice.showSuccess('Saved', 'Payment added successfully.');
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  }, [paidTo, amount, mode, ref, note, transportOwnerId, vehicleId, date, month, maxAllowedAmount, onSaved, notice, queryClient]);

  /** Clear vehicle selection, resetting all related state */
  const clearVehicle = useCallback(() => {
    setVehicleId(null);
    setVehicleNetPayable(null);
    setCrossOwnerVehicle(null);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  /** Switch tabs — always clears the current vehicle selection */
  const switchTab = useCallback((tab: 'own' | 'other') => {
    setVehicleTab(tab);
    setVehicleId(null);
    setVehicleNetPayable(null);
    setCrossOwnerVehicle(null);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  /** Debounced cross-owner vehicle search */
  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (q.trim().length < 2) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchVehiclesByRegNumber(q.trim());
        // Exclude vehicles that already belong to the current owner
        setSearchResults(results.filter(r => !vehicles.some(v => v.id === r.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }, [vehicles]);

  /** Select a cross-owner vehicle from search results */
  const selectCrossOwner = useCallback((v: VehicleSearchResult) => {
    setVehicleId(v.id);
    setCrossOwnerVehicle(v);
    setSearchQuery(v.reg_number);
    setSearchResults([]);
    // Auto-fill payee name if still empty
    setPaidTo(prev => prev.trim() ? prev : v.owner_name);
  }, []);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={[styles.modalRoot, { flex: 1 }]} keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20 }}>
          <MHead title="Add Payment" onClose={onClose} />
          <MF label="Paid To *" value={paidTo} onChange={setPaidTo} placeholder="e.g. Amar Prasad" />
          <MF label="Amount (₹) *" value={amount} onChange={setAmount} placeholder="e.g. 308500" kb="decimal-pad" />
          <ThemedDateField label="Date" value={date} onChange={setDate} required />

          <Text style={styles.fieldLabel}>Payment Mode *</Text>
          <View style={styles.modeToggle}>
            {(['cheque', 'upi', 'other'] as const).map(m => (
              <TouchableOpacity key={m} onPress={() => setMode(m)} style={[styles.modeBtn, mode === m && styles.modeBtnActive]}>
                <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>{m.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <MF
            label={`Reference ${mode === 'cheque' ? '*' : '(optional)'}`}
            value={ref}
            onChange={setRef}
            placeholder={mode === 'cheque' ? 'Cheque number e.g. 13581' : mode === 'upi' ? 'UTR if available' : 'Optional reference'}
          />
          <MF label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. cash, tfs, card" />

          {/* ── Vehicle Picker ── */}
          <Text style={styles.fieldLabel}>Link to Vehicle (optional)</Text>

          {/* Tab switcher */}
          <View style={styles.vehicleTabRow}>
            <TouchableOpacity
              onPress={() => switchTab('own')}
              style={[styles.vehicleTabBtn, vehicleTab === 'own' && styles.vehicleTabBtnActive]}
            >
              <Text style={[styles.vehicleTabText, vehicleTab === 'own' && styles.vehicleTabTextActive]}>
                Own ({vehicles.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => switchTab('other')}
              style={[styles.vehicleTabBtn, vehicleTab === 'other' && styles.vehicleTabBtnActive]}
            >
              <Text style={[styles.vehicleTabText, vehicleTab === 'other' && styles.vehicleTabTextActive]}>
                🔗 Other Owner
              </Text>
            </TouchableOpacity>
          </View>

          {/* Own vehicles — horizontal chip scroll */}
          {vehicleTab === 'own' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <TouchableOpacity
                onPress={clearVehicle}
                style={[styles.vehicleChip, !vehicleId && styles.vehicleChipActive]}
              >
                <Text style={[styles.vehicleChipText, !vehicleId && styles.vehicleChipTextActive]}>None</Text>
              </TouchableOpacity>
              {vehicles.map(v => (
                <TouchableOpacity
                  key={v.id}
                  onPress={() => { setVehicleId(v.id); setCrossOwnerVehicle(null); }}
                  style={[styles.vehicleChip, vehicleId === v.id && styles.vehicleChipActive]}
                >
                  <Text style={[styles.vehicleChipText, vehicleId === v.id && styles.vehicleChipTextActive]}>
                    {v.reg_number}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            /* Cross-owner vehicle search */
            <View style={{ marginBottom: 16 }}>
              <SearchInput
                style={styles.crossOwnerSearchInput}
                value={searchQuery}
                onChangeText={handleSearchChange}
                placeholder="Type reg. no. e.g. MH12AB1234"
                placeholderTextColor="#9f8b97"
              />

              {isSearching && (
                <Text style={styles.crossOwnerHint}>Searching…</Text>
              )}

              {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <Text style={styles.crossOwnerHint}>No vehicles found for "{searchQuery}"</Text>
              )}

              {searchResults.length > 0 && (
                <View style={styles.searchResultsList}>
                  {searchResults.map(r => (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => selectCrossOwner(r)}
                      style={[
                        styles.searchResultItem,
                        vehicleId === r.id && styles.searchResultItemActive,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.searchResultReg}>{r.reg_number}</Text>
                        <Text style={styles.searchResultSub}>{r.owner_name} · {r.transporter_name}</Text>
                      </View>
                      {vehicleId === r.id && (
                        <Ionicons name="checkmark-circle" size={18} color="#ec4899" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {crossOwnerVehicle && vehicleId && (
                <View style={styles.crossOwnerSelectedBadge}>
                  <Ionicons name="link-outline" size={13} color="#d9468f" />
                  <Text style={styles.crossOwnerSelectedText} numberOfLines={1}>
                    {crossOwnerVehicle.reg_number} · {crossOwnerVehicle.transporter_name}
                  </Text>
                  <TouchableOpacity onPress={clearVehicle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={16} color="#d9468f" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Net payable preview — shared for own and cross-owner vehicles */}
          {vehicleId && (
            <View style={styles.previewCard}>
              <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>
                {crossOwnerVehicle
                  ? `Net Payable · ${crossOwnerVehicle.reg_number} (${crossOwnerVehicle.transporter_name})`
                  : 'Selected Vehicle Net Payable'}
              </Text>

              {loadingVehicleNet ? (
                <Text style={styles.vehicleNetAmount}>Calculating...</Text>
              ) : typeof vehicleNetPayable === 'number' ? (
                vehicleNetPayable > 0 ? (
                  // Outstanding amount — pre-fill the amount field
                  <>
                    <Text style={styles.vehicleNetAmount}>{fmt(vehicleNetPayable)}</Text>
                    <Text style={styles.vehicleNetHint}>
                      Amount field prefilled from net payable. You can edit it.
                    </Text>
                  </>
                ) : vehicleNetPayable < 0 ? (
                  // Already overpaid — warn clearly, do NOT pre-fill amount
                  <>
                    <Text style={[styles.vehicleNetAmount, { color: '#f59e0b' }]}>
                      OVERPAID  {fmt(Math.abs(vehicleNetPayable))}
                    </Text>
                    <Text style={styles.vehicleNetHint}>
                      This vehicle has been overpaid this month. Enter a custom amount only if intentional.
                    </Text>
                  </>
                ) : (
                  // Exactly fully paid
                  <>
                    <Text style={[styles.vehicleNetAmount, { color: '#22c55e' }]}>✓ Fully Paid</Text>
                    <Text style={styles.vehicleNetHint}>
                      No outstanding balance. You can still enter a custom amount if needed.
                    </Text>
                  </>
                )
              ) : null}
            </View>
          )}

          <SaveBtn saving={saving} onPress={save} label="Save Payment" />
          <View style={{ height: 32 }} />
        </View>
      </ScrollView>
    </Modal>
  );
}

// ─── VehicleModal ─────────────────────────────────────────────────────────────

interface VehicleModalProps {
  visible: boolean;
  transportOwnerId: string;
  ownerCommissionRate: number;
  ownerAccidentalRate: number;
  vehicle: Vehicle | null;
  onClose: () => void;
  onSaved: () => void;
}

function VehicleModal({
  visible, transportOwnerId, ownerCommissionRate, ownerAccidentalRate, vehicle, onClose, onSaved,
}: VehicleModalProps) {
  const [reg, setReg]               = useState('');
  const [ownerName, setOwnerName]   = useState('');
  const [contact, setContact]       = useState('');
  const [gstRate, setGstRate]       = useState('0.10');
  const [commissionRate, setCommissionRate] = useState('0');
  const [accidentalRate, setAccidentalRate] = useState('0');
  const [saving, setSaving]         = useState(false);
  const notice = useThemedNotice();

  useEffect(() => {
    if (!visible) return;
    if (vehicle) {
      setReg(vehicle.reg_number ?? '');
      setOwnerName(vehicle.owner_name ?? '');
      setContact(vehicle.owner_contact ?? '');
      setGstRate(String(vehicle.gst_commission_rate ?? '0.10'));
      setCommissionRate(String(vehicle.commission_rate ?? ownerCommissionRate ?? 0));
      setAccidentalRate(String(vehicle.accidental_rate ?? ownerAccidentalRate ?? 0));
      return;
    }
    setReg('');
    setOwnerName('');
    setContact('');
    setGstRate('0.10');
    setCommissionRate(String(ownerCommissionRate ?? 0));
    setAccidentalRate(String(ownerAccidentalRate ?? 0));
  }, [visible, vehicle, ownerCommissionRate, ownerAccidentalRate]);

  const save = useCallback(async () => {
    if (!reg.trim() || !ownerName.trim()) { notice.showInfo('Required', 'Reg number and owner name required'); return; }
    const gr = parseFloat(gstRate);
    const cr = parseFloat(commissionRate);
    const ar = parseFloat(accidentalRate);
    if (isNaN(gr)) { notice.showInfo('Invalid', 'Enter valid GST rate e.g. 0.10'); return; }
    if (isNaN(cr) || isNaN(ar)) { notice.showInfo('Invalid', 'Enter valid commission and accidental rates'); return; }
    setSaving(true);
    try {
      await upsertVehicle({
        id: vehicle?.id,
        transport_owner_id: transportOwnerId,
        reg_number: reg.trim().toUpperCase(),
        owner_name: ownerName.trim(),
        owner_contact: contact || null,
        gst_commission_rate: gr,
        commission_rate: cr,
        accidental_rate: ar,
      });
      setReg(''); setOwnerName(''); setContact(''); setGstRate('0.10');
      setCommissionRate(String(ownerCommissionRate ?? 0));
      setAccidentalRate(String(ownerAccidentalRate ?? 0));
      onSaved();
      notice.showSuccess('Saved', vehicle ? 'Vehicle updated successfully.' : 'Vehicle added successfully.');
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  }, [reg, ownerName, contact, gstRate, commissionRate, accidentalRate, vehicle, transportOwnerId, ownerCommissionRate, ownerAccidentalRate, onSaved, notice]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <MHead title={vehicle ? 'Edit Vehicle' : 'Add Vehicle'} onClose={onClose} />
        <MF label="Registration Number *" value={reg} onChange={setReg} placeholder="e.g. JH04AB3444" />
        <MF label="Owner Name *" value={ownerName} onChange={setOwnerName} placeholder="e.g. Amar Prasad" />
        <MF label="Owner Contact" value={contact} onChange={setContact} placeholder="Phone number" kb="phone-pad" />
        <MF label="Commission Rate (₹/T) *" value={commissionRate} onChange={setCommissionRate} placeholder="e.g. 140" kb="decimal-pad" />
        <MF label="Accidental Rate (₹/T) *" value={accidentalRate} onChange={setAccidentalRate} placeholder="e.g. 60" kb="decimal-pad" />
        <MF label="GST Commission Rate *" value={gstRate} onChange={setGstRate} placeholder="0.10 = 10%" kb="decimal-pad" />
        <SaveBtn saving={saving} onPress={save} label={vehicle ? 'Update Vehicle' : 'Save Vehicle'} />
      </View>
    </Modal>
  );
}

// ─── Helper UI Components ──────────────────────────────────────────────────────

interface MHeadProps { title: string; onClose: () => void }
function MHead({ title, onClose }: MHeadProps) {
  return (
    <View style={styles.modalHeader}>
      <Text style={styles.modalTitle}>{title}</Text>
      <TouchableOpacity onPress={onClose}><Text style={styles.cancelBtn}>Cancel</Text></TouchableOpacity>
    </View>
  );
}

interface MFProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  kb?: string;
}
function MF({ label, value, onChange, placeholder, kb = 'default' }: MFProps) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { if (value !== local) setLocal(value || ''); }, [value]);

  const hChange = (t: string) => {
    setLocal(t);
    onChange(t);
  };

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.textInput}
        value={local}
        onChangeText={hChange}
        placeholder={placeholder}
        placeholderTextColor="#9f8b97"
        keyboardType={kb as any}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
    </View>
  );
}

function SearchInput({ value, onChangeText, placeholder, placeholderTextColor, style }: { value: string; onChangeText: (t: string) => void; placeholder: string; placeholderTextColor: string; style: any }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { if (value !== local) setLocal(value || ''); }, [value]);

  const hChange = (t: string) => {
    setLocal(t);
    onChangeText(t);
  };

  return (
    <TextInput
      style={style}
      value={local}
      onChangeText={hChange}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      autoCapitalize="characters"
      autoCorrect={false}
      spellCheck={false}
      returnKeyType="search"
    />
  );
}

interface SaveBtnProps { saving: boolean; onPress: () => void; label: string }
function SaveBtn({ saving, onPress, label }: SaveBtnProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={saving}
      style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
    >
      <Text style={styles.saveBtnText}>{saving ? 'Saving...' : label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

import React from 'react';

const styles = StyleSheet.create({
  // Layout
  root:             { flex: 1, backgroundColor: '#fff7fb' },
  loadingContainer: { flex: 1, backgroundColor: '#fff7fb', padding: 16 },
  notFoundContainer: { flex: 1, backgroundColor: '#fff7fb', alignItems: 'center', justifyContent: 'center' },

  // Decorative blobs
  blobTopRight:   { position: 'absolute', top: 24, right: -70, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' },
  blobBottomLeft: { position: 'absolute', top: 210, left: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' },

  // Header
  header:         { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 20 },
  headerTitleWrap:{ flex: 1, minWidth: 0 },
  headerTitle:    { color: '#111111', fontSize: 20, fontWeight: 'bold' },
  headerSubtitle: { color: '#6b5c67', fontSize: 12 },
  backArrow:      { color: '#db2777', fontSize: 18 },
  backLink:       { color: '#db2777' },
  errorText:      { color: '#ef4444' },

  // Month picker
  monthPickerWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  monthPickerCard: { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 12 },
  monthNavRow:     { flexDirection: 'row', gap: 8 },
  monthNavBtn:     { flex: 1, backgroundColor: '#fce7f3', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  monthNavText:    { color: '#111111', fontWeight: '700' },

  // Balance card
  balanceCard:    { margin: 16, backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 20, padding: 20 },
  statsRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  divider:        { height: 1, backgroundColor: '#f2d7e6', marginBottom: 16 },
  paidRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paidValue:      { color: '#111111', fontWeight: 'bold', fontSize: 18 },
  balanceValue:   { fontWeight: 'bold', fontSize: 24 },
  overpaidLabel:  { color: '#ef4444', fontSize: 11 },
  updateIncomeBtn:{ marginTop: 14, backgroundColor: '#fce7f3', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 10, alignItems: 'center' },
  updateIncomeBtnText: { color: '#be185d', fontWeight: '700' },

  // Stat
  statLabel: { color: '#6b5c67', fontSize: 11 },
  statValue: { color: '#111111', fontWeight: 'bold', marginTop: 2 },

  // Section header
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 20, marginBottom: 10 },
  sectionTitle:  { color: '#111111', fontWeight: 'bold', fontSize: 16 },
  addBtn:        { color: '#db2777', fontWeight: '700' },

  // Swipe hints
  swipeHint:     { marginHorizontal: 16, marginBottom: 2 },
  swipeHintText: { color: '#8d7a86', fontSize: 12 },
  swipeActions:  { flexDirection: 'row', marginBottom: 8 },
  swipeBtn:      { width: 78, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swipeBtnEdit:  { marginRight: 6, backgroundColor: '#db2777' },
  swipeBtnDelete:{ backgroundColor: '#ef4444' },
  swipeBtnText:  { color: '#ffffff', fontSize: 11, marginTop: 3, fontWeight: '700' },

  // Vehicle card
  vehicleRow:    { marginHorizontal: 16, marginBottom: 8, backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, paddingLeft: 16, paddingVertical: 12, paddingRight: 12, flexDirection: 'row', alignItems: 'center' },
  vehicleReg:    { color: '#111111', fontWeight: 'bold' },
  vehicleOwner:  { color: '#6b5c67', fontSize: 12, marginTop: 2 },
  vehicleRates:  { color: '#8d7a86', fontSize: 11, marginTop: 3 },
  chevron:       { color: '#db2777', fontSize: 20, marginLeft: 4 },

  // Payment card
  paymentRow:        { marginHorizontal: 16, marginBottom: 8, backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center' },
  paymentIndex:      { width: 28, height: 28, backgroundColor: '#fce7f3', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  paymentIndexText:  { color: '#6b5c67', fontSize: 12 },
  paymentName:       { color: '#111111', fontWeight: '600' },
  paymentMeta:       { color: '#6b5c67', fontSize: 11, marginTop: 2 },
  paymentAmount:     { color: '#111111', fontWeight: 'bold' },

  // Empty state
  emptyText: { color: '#6b5c67', textAlign: 'center', marginTop: 4 },

  // Modal
  modalRoot:   { flex: 1, backgroundColor: '#fff7fb', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle:  { color: '#111111', fontSize: 20, fontWeight: 'bold' },
  cancelBtn:   { color: '#db2777' },

  // Form fields
  fieldLabel: { color: '#6b5c67', fontSize: 11, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
  textInput:  { backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 12, padding: 14 },

  // Payment mode toggle
  modeToggle:       { flexDirection: 'row', backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 4, marginBottom: 16 },
  modeBtn:          { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  modeBtnActive:    { backgroundColor: '#ec4899' },
  modeBtnText:      { color: '#6b5c67', fontWeight: '600' },
  modeBtnTextActive:{ color: 'white' },

  // Vehicle chips
  vehicleChip:         { marginRight: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#ffffffcc', borderWidth: 1, borderColor: '#f2d7e6' },
  vehicleChipActive:   { backgroundColor: '#ec4899' },
  vehicleChipText:     { color: '#111111' },
  vehicleChipTextActive:{ color: 'white' },

  // Preview card
  previewCard:    { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  previewTotal:   { color: '#be185d', fontWeight: 'bold', fontSize: 20 },
  vehicleNetAmount:{ color: '#111111', fontSize: 18, fontWeight: '800', marginTop: 4 },
  vehicleNetHint: { color: '#8d7a86', fontSize: 11, marginTop: 2 },

  // Labels
  smallLabel: { color: '#6b5c67', fontSize: 12 },
  sectionLabel:{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },

  // Save button
  saveBtn:        { backgroundColor: '#ec4899', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnDisabled:{ backgroundColor: '#d4d4d8' },
  saveBtnText:    { color: 'white', fontWeight: 'bold', fontSize: 16 },

  // Cross-owner vehicle payment — vehicle tab picker (matches modeToggle style)
  vehicleTabRow:      { flexDirection: 'row', backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 4, marginBottom: 12 },
  vehicleTabBtn:      { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  vehicleTabBtnActive:{ backgroundColor: '#ec4899' },
  vehicleTabText:     { color: '#6b5c67', fontWeight: '600', fontSize: 13 },
  vehicleTabTextActive:{ color: 'white' },

  // Cross-owner search input + results
  crossOwnerSearchInput: { backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 12, padding: 14, marginBottom: 8 },
  crossOwnerHint:    { color: '#8d7a86', fontSize: 12, marginBottom: 8, paddingHorizontal: 2 },
  searchResultsList: { backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  searchResultItem:  { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#fde7f3' },
  searchResultItemActive: { backgroundColor: '#fce7f3' },
  searchResultReg:   { color: '#111111', fontWeight: '700', fontSize: 14 },
  searchResultSub:   { color: '#6b5c67', fontSize: 11, marginTop: 2 },

  // Selected cross-owner badge (inside search tab)
  crossOwnerSelectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fce7f3', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  crossOwnerSelectedText:  { flex: 1, color: '#be185d', fontWeight: '600', fontSize: 12 },

  // Cross-owner tag on PaymentCard
  crossOwnerTag:     { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  crossOwnerTagText: { color: '#ec4899', fontSize: 10, fontWeight: '700' },
});
