import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Modal, TextInput } from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ThemedConfirmModal from '../../components/ThemedConfirmModal';
import ThemedDateField from '../../components/ThemedDateField';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import {
  getTransportOwner, getVehicles, getTransportIncome, getTotalPayments,
  getPayments, upsertTransportIncome, addPayment, deletePayment, upsertVehicle,
} from '../../lib/queries';
import { fmt, fmtDate, monthKey, monthLabel, round2 } from '../../constants/defaults';
import type { TransportOwner, Vehicle, Payment, TransportIncome } from '../../types';

export default function TransporterDetailScreen() {
  const { id, month: mParam } = useLocalSearchParams<{ id: string; month?: string }>();
  const initialMonth = mParam ?? monthKey();
  const [month, setMonth] = useState(initialMonth);
  const [monthDate, setMonthDate] = useState(`${initialMonth}-01`);
  const [owner, setOwner]       = useState<TransportOwner | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [income, setIncome]     = useState<TransportIncome | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totalPaid, setTotalPaid] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showIncome, setShowIncome]   = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showVehicle, setShowVehicle] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const lastLoadedAtRef = useRef(0);
  const lastLoadedMonthRef = useRef('');
  const requestSeqRef = useRef(0);
  const notice = useThemedNotice();

  useEffect(() => {
    const nextMonth = monthDate.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(nextMonth) && nextMonth !== month) {
      setMonth(nextMonth);
      setRefreshing(true);
    }
  }, [monthDate, month]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setMonthDate(`${next}-01`);
  };

  const load = useCallback(async (force = false) => {
    if (!id) return;
    const seq = ++requestSeqRef.current;
    const now = Date.now();
    if (!force && initialized && month === lastLoadedMonthRef.current && now - lastLoadedAtRef.current < 15000) {
      setRefreshing(false);
      return;
    }

    try {
      const [o, v, inc, paid, pmts] = await Promise.all([
        getTransportOwner(id), getVehicles(id),
        getTransportIncome(id, month), getTotalPayments(id, month), getPayments(id, month),
      ]);
      if (seq !== requestSeqRef.current) return;
      setOwner(o); setVehicles(v); setIncome(inc); setTotalPaid(paid); setPayments(pmts);
      lastLoadedAtRef.current = Date.now();
      lastLoadedMonthRef.current = month;
      if (!initialized) setInitialized(true);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      notice.showError('Error', String(e));
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [id, month, initialized, notice]);

  useFocusEffect(useCallback(() => {
    if (!initialized) setLoading(true);
    load(false);
  }, [load, initialized]));

  if (loading) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb', padding: 16 }}>
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
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ef4444' }}>Owner not found</Text>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
        <Text style={{ color: '#db2777' }}>← Go back</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const totalIncome = round2((income?.transport_payment ?? 0) + (income?.diesel_payment ?? 0));
  const balance     = round2(totalIncome - totalPaid);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb' }}>
      <View style={{ position: 'absolute', top: 24, right: -70, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' }} />
      <View style={{ position: 'absolute', top: 210, left: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 20 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Text style={{ color: '#db2777', fontSize: 18 }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: '#111111', fontSize: 20, fontWeight: 'bold' }} numberOfLines={1} ellipsizeMode="tail">{owner.name}</Text>
          <Text style={{ color: '#6b5c67', fontSize: 12 }}>{monthLabel(month)}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 12 }}>
          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
            Records Month
          </Text>
          <ThemedDateField label="Month" value={monthDate} onChange={setMonthDate} required />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => shiftMonth(-1)}
              style={{ flex: 1, backgroundColor: '#fce7f3', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: '#111111', fontWeight: '700' }}>Previous Month</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => shiftMonth(1)}
              style={{ flex: 1, backgroundColor: '#fce7f3', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: '#111111', fontWeight: '700' }}>Next Month</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor="#ec4899" />}>

        {/* Balance card */}
        <View style={{ margin: 16, backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 20, padding: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
            <Stat label="Transport Pay"  value={fmt(income?.transport_payment ?? 0)} />
            <Stat label="Diesel Pay"     value={fmt(income?.diesel_payment ?? 0)} />
            <Stat label="Total Income"   value={fmt(totalIncome)} highlight />
          </View>
          <View style={{ height: 1, backgroundColor: '#f2d7e6', marginBottom: 16 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ color: '#6b5c67', fontSize: 12 }}>Total Paid Out</Text>
              <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 18 }}>{fmt(totalPaid)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: '#6b5c67', fontSize: 12 }}>Balance</Text>
              <Text style={{ color: balance >= 0 ? '#22c55e' : '#ef4444', fontWeight: 'bold', fontSize: 24 }}>
                {fmt(Math.abs(balance))}
              </Text>
              {balance < 0 && <Text style={{ color: '#ef4444', fontSize: 11 }}>OVERPAID</Text>}
            </View>
          </View>
          <TouchableOpacity onPress={() => setShowIncome(true)}
            style={{ marginTop: 14, backgroundColor: '#fce7f3', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 10, alignItems: 'center' }}>
            <Text style={{ color: '#be185d', fontWeight: '700' }}>✏️ Update Income Received</Text>
          </TouchableOpacity>
        </View>

        {/* Vehicles */}
        <SectionHeader title="Vehicles" onAdd={() => setShowVehicle(true)} />
        {vehicles.map(v => (
          <TouchableOpacity key={v.id} onPress={() => router.push(`/vehicle/${v.id}?month=${month}`)}
            style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#111111', fontWeight: 'bold' }}>{v.reg_number}</Text>
              <Text style={{ color: '#6b5c67', fontSize: 12, marginTop: 2 }}>{v.owner_name}</Text>
            </View>
            <Text style={{ color: '#db2777', fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        ))}
        {vehicles.length === 0 && <Text style={{ color: '#6b5c67', textAlign: 'center', marginTop: 4 }}>No vehicles added yet</Text>}

        {/* Payments */}
        <SectionHeader title={`Payments (${payments.length})`} onAdd={() => setShowPayment(true)} />
        {payments.map((p, i) => (
          <View key={p.id} style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 28, height: 28, backgroundColor: '#fce7f3', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Text style={{ color: '#6b5c67', fontSize: 12 }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#111111', fontWeight: '600' }}>{p.paid_to}</Text>
              <Text style={{ color: '#6b5c67', fontSize: 11, marginTop: 2 }}>
                {fmtDate(p.date)} · {p.mode.toUpperCase()}{p.reference ? ` #${p.reference}` : ''}{p.note ? ` · ${p.note}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
              <Text style={{ color: '#111111', fontWeight: 'bold' }}>{fmt(p.amount)}</Text>
              <TouchableOpacity onPress={() => setPaymentToDelete(p)}>
                <Text style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {payments.length === 0 && <Text style={{ color: '#6b5c67', textAlign: 'center', marginTop: 4 }}>No payments this month</Text>}

        <View style={{ height: 64 }} />
      </ScrollView>

      <IncomeModal visible={showIncome} income={income} transportOwnerId={owner.id} month={month}
        onClose={() => setShowIncome(false)} onSaved={() => { setShowIncome(false); load(true); }} />
      <PaymentModal visible={showPayment} transportOwnerId={owner.id} vehicles={vehicles} month={month}
        onClose={() => setShowPayment(false)} onSaved={() => { setShowPayment(false); load(true); }} />
      <VehicleModal visible={showVehicle} transportOwnerId={owner.id}
        onClose={() => setShowVehicle(false)} onSaved={() => { setShowVehicle(false); load(true); }} />

      <ThemedConfirmModal
        visible={!!paymentToDelete}
        title="Delete Payment"
        message={paymentToDelete ? `Delete ${fmt(paymentToDelete.amount)} payment to ${paymentToDelete.paid_to}?` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setPaymentToDelete(null)}
        onConfirm={async () => {
          if (!paymentToDelete) return;
          try {
            await deletePayment(paymentToDelete.id);
            setPaymentToDelete(null);
            load(true);
          } catch (e) {
            notice.showError('Error', String(e));
          }
        }}
      />
    </SafeAreaView>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View>
      <Text style={{ color: '#6b5c67', fontSize: 11 }}>{label}</Text>
      <Text style={{ color: highlight ? '#be185d' : '#111111', fontWeight: 'bold', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 20, marginBottom: 10 }}>
      <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>{title}</Text>
      <TouchableOpacity onPress={onAdd}><Text style={{ color: '#db2777', fontWeight: '700' }}>+ Add</Text></TouchableOpacity>
    </View>
  );
}

function IncomeModal({ visible, income, transportOwnerId, month, onClose, onSaved }: any) {
  const [tp, setTp] = useState(income?.transport_payment?.toString() ?? '');
  const [dp, setDp] = useState(income?.diesel_payment?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  useEffect(() => {
    if (!visible) return;
    setTp(income?.transport_payment?.toString() ?? '');
    setDp(income?.diesel_payment?.toString() ?? '');
  }, [visible, income]);

  const save = async () => {
    const t = parseFloat(tp), d = parseFloat(dp);
    if (isNaN(t) || isNaN(d)) { notice.showInfo('Invalid', 'Enter valid amounts'); return; }
    setSaving(true);
    try { await upsertTransportIncome({ transport_owner_id: transportOwnerId, month, transport_payment: t, diesel_payment: d }); onSaved(); }
    catch (e) { notice.showError('Error', String(e)); } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff7fb', padding: 20 }}>
        <MHead title="Income Received" onClose={onClose} />
        <MF label="Transport Payment (₹) *" value={tp} onChange={setTp} kb="decimal-pad" />
        <MF label="Diesel Payment (₹) *" value={dp} onChange={setDp} kb="decimal-pad" />
        {tp && dp && !isNaN(parseFloat(tp)) && !isNaN(parseFloat(dp)) && (
          <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <Text style={{ color: '#6b5c67', fontSize: 12 }}>Total Income</Text>
            <Text style={{ color: '#be185d', fontWeight: 'bold', fontSize: 20 }}>
              {fmt(round2(parseFloat(tp) + parseFloat(dp)))}
            </Text>
          </View>
        )}
        <SaveBtn saving={saving} onPress={save} label="Save Income" />
      </View>
    </Modal>
  );
}

function PaymentModal({ visible, transportOwnerId, vehicles, month, onClose, onSaved }: any) {
  const [paidTo, setPaidTo]   = useState('');
  const [amount, setAmount]   = useState('');
  const [date, setDate]       = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode]       = useState<'cheque' | 'upi'>('cheque');
  const [ref, setRef]         = useState('');
  const [note, setNote]       = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const notice = useThemedNotice();

  const save = async () => {
    if (!paidTo.trim()) { notice.showInfo('Required', 'Enter payee name'); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { notice.showInfo('Invalid', 'Enter valid amount'); return; }
    if (mode === 'cheque' && !ref.trim()) { notice.showInfo('Required', 'Cheque reference is required'); return; }
    setSaving(true);
    try {
      await addPayment({ transport_owner_id: transportOwnerId, vehicle_id: vehicleId, paid_to: paidTo.trim(), amount: amt, date, mode, reference: ref.trim() || null, note: note.trim() || null, month });
      setPaidTo(''); setAmount(''); setRef(''); setNote(''); setVehicleId(null);
      onSaved();
      notice.showSuccess('Saved', 'Payment added successfully.');
    } catch (e) { notice.showError('Error', String(e)); } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: '#fff7fb' }} keyboardShouldPersistTaps="handled">
        <View style={{ padding: 20 }}>
          <MHead title="Add Payment" onClose={onClose} />
          <MF label="Paid To *" value={paidTo} onChange={setPaidTo} placeholder="e.g. Amar Prasad" />
          <MF label="Amount (₹) *" value={amount} onChange={setAmount} placeholder="e.g. 308500" kb="decimal-pad" />
          <ThemedDateField label="Date" value={date} onChange={setDate} required />

          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' }}>Payment Mode *</Text>
          <View style={{ flexDirection: 'row', backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 4, marginBottom: 16 }}>
            {(['cheque', 'upi'] as const).map(m => (
              <TouchableOpacity key={m} onPress={() => setMode(m)} style={{
                flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                backgroundColor: mode === m ? '#ec4899' : 'transparent',
              }}>
                <Text style={{ color: mode === m ? 'white' : '#6b5c67', fontWeight: '600', textTransform: 'capitalize' }}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <MF label={`Reference ${mode === 'cheque' ? '*' : '(optional)'}`} value={ref} onChange={setRef}
            placeholder={mode === 'cheque' ? 'Cheque number e.g. 13581' : 'UTR if available'} />
          <MF label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. GST, CARD" />

          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' }}>Link to Vehicle (optional)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <TouchableOpacity onPress={() => setVehicleId(null)} style={{ marginRight: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: !vehicleId ? '#ec4899' : '#ffffffcc', borderWidth: 1, borderColor: '#f2d7e6' }}>
              <Text style={{ color: !vehicleId ? 'white' : '#111111' }}>None</Text>
            </TouchableOpacity>
            {vehicles.map((v: Vehicle) => (
              <TouchableOpacity key={v.id} onPress={() => setVehicleId(v.id)} style={{ marginRight: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: vehicleId === v.id ? '#ec4899' : '#ffffffcc', borderWidth: 1, borderColor: '#f2d7e6' }}>
                <Text style={{ color: vehicleId === v.id ? 'white' : '#111111' }}>{v.reg_number}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <SaveBtn saving={saving} onPress={save} label="Save Payment" />
          <View style={{ height: 32 }} />
        </View>
      </ScrollView>
    </Modal>
  );
}

function VehicleModal({ visible, transportOwnerId, onClose, onSaved }: any) {
  const [reg, setReg]         = useState('');
  const [ownerName, setOwner] = useState('');
  const [contact, setContact] = useState('');
  const [gstRate, setGstRate] = useState('0.10');
  const [saving, setSaving]   = useState(false);
  const notice = useThemedNotice();

  const save = async () => {
    if (!reg.trim() || !ownerName.trim()) { notice.showInfo('Required', 'Reg number and owner name required'); return; }
    const gr = parseFloat(gstRate);
    if (isNaN(gr)) { notice.showInfo('Invalid', 'Enter valid GST rate e.g. 0.10'); return; }
    setSaving(true);
    try {
      await upsertVehicle({ transport_owner_id: transportOwnerId, reg_number: reg.trim().toUpperCase(), owner_name: ownerName.trim(), owner_contact: contact || null, gst_commission_rate: gr });
      setReg(''); setOwner(''); setContact(''); setGstRate('0.10');
      onSaved();
      notice.showSuccess('Saved', 'Vehicle added successfully.');
    } catch (e) { notice.showError('Error', String(e)); } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff7fb', padding: 20 }}>
        <MHead title="Add Vehicle" onClose={onClose} />
        <MF label="Registration Number *" value={reg} onChange={setReg} placeholder="e.g. JH04AB3444" />
        <MF label="Owner Name *" value={ownerName} onChange={setOwner} placeholder="e.g. Amar Prasad" />
        <MF label="Owner Contact" value={contact} onChange={setContact} placeholder="Phone number" kb="phone-pad" />
        <MF label="GST Commission Rate *" value={gstRate} onChange={setGstRate} placeholder="0.10 = 10%" kb="decimal-pad" />
        <SaveBtn saving={saving} onPress={save} label="Save Vehicle" />
      </View>
    </Modal>
  );
}

function MHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
      <Text style={{ color: '#111111', fontSize: 20, fontWeight: 'bold' }}>{title}</Text>
      <TouchableOpacity onPress={onClose}><Text style={{ color: '#db2777' }}>Cancel</Text></TouchableOpacity>
    </View>
  );
}

function MF({ label, value, onChange, placeholder, kb = 'default' }: any) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' }}>{label}</Text>
      <TextInput style={{ backgroundColor: '#ffffff', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 12, padding: 14 }}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#475569"
        keyboardType={kb} autoCapitalize="none" />
    </View>
  );
}

function SaveBtn({ saving, onPress, label }: { saving: boolean; onPress: () => void; label: string }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={saving}
      style={{ backgroundColor: saving ? '#d4d4d8' : '#ec4899', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 }}>
      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{saving ? 'Saving...' : label}</Text>
    </TouchableOpacity>
  );
}
