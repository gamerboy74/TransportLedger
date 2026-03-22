import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Modal, Pressable, TextInput } from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import ThemedDateField from '../../components/ThemedDateField';
import {
  getVehicle, getTransportOwner, getTripEntries, getDieselLogs,
  getGSTEntries, getOtherDeductions, getVehiclePayments,
  addGSTEntry, addOtherDeduction, softDeleteDieselLog,
  deleteTripEntry, deleteOtherDeduction, deleteGSTEntry,
} from '../../lib/queries';
import { calculateSettlement, calculateAdminEarnings } from '../../lib/calculations';
import { fmt, fmtDate, monthKey, monthLabel, round2 } from '../../constants/defaults';
import type { Vehicle, TransportOwner, TripEntry, DieselLog, GSTEntry, OtherDeduction, SettlementResult, AdminEarnings } from '../../types';

export default function VehicleDetailScreen() {
  const { id, month: mParam } = useLocalSearchParams<{ id: string; month?: string }>();
  const initialMonth = mParam ?? monthKey();
  const [month, setMonth] = useState(initialMonth);
  const [monthDate, setMonthDate] = useState(`${initialMonth}-01`);

  const [vehicle, setVehicle]     = useState<Vehicle | null>(null);
  const [owner, setOwner]         = useState<TransportOwner | null>(null);
  const [trips, setTrips]         = useState<TripEntry[]>([]);
  const [diesel, setDiesel]       = useState<DieselLog[]>([]);
  const [gst, setGST]             = useState<GSTEntry[]>([]);
  const [others, setOthers]       = useState<OtherDeduction[]>([]);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [adminE, setAdminE]       = useState<AdminEarnings | null>(null);
  const [totalPaid, setTotalPaid] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showGST, setShowGST]     = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [delModal, setDelModal]   = useState<{ type: string; id: string; label: string } | null>(null);
  const [delReason, setDelReason] = useState('');
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
      const v = await getVehicle(id);
      if (!v) throw new Error('Vehicle not found');
      const o = await getTransportOwner(v.transport_owner_id);
      if (!o) throw new Error('Owner not found');
      const [t, d, g, oth, paid] = await Promise.all([
        getTripEntries(id, month), getDieselLogs(id, month),
        getGSTEntries(id, month), getOtherDeductions(id, month), getVehiclePayments(id, month),
      ]);
      if (seq !== requestSeqRef.current) return;
      const s = calculateSettlement({ trips: t, diesel: d, commissionRate: o.commission_rate, accidentalRate: o.accidental_rate, gstEntries: g, otherDeductions: oth });
      const ae = calculateAdminEarnings({ totalTonnes: s.totalTonnes, commissionRate: o.commission_rate, diesel: d as any, gstEntries: g as any });
      setVehicle(v); setOwner(o); setTrips(t); setDiesel(d); setGST(g); setOthers(oth);
      setSettlement(s); setAdminE(ae); setTotalPaid(paid);
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

  const handleDelete = async () => {
    if (!delModal) return;
    if (delModal.type === 'diesel' && !delReason.trim()) { notice.showInfo('Required', 'Enter a reason'); return; }
    try {
      if (delModal.type === 'diesel') await softDeleteDieselLog(delModal.id, delReason.trim());
      else if (delModal.type === 'trip') await deleteTripEntry(delModal.id);
      else if (delModal.type === 'other') await deleteOtherDeduction(delModal.id);
      else if (delModal.type === 'gst') await deleteGSTEntry(delModal.id);
      setDelModal(null); setDelReason(''); load(true);
    } catch (e) { notice.showError('Error', String(e)); }
  };

  if (loading) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb', padding: 16 }}>
      <View style={{ marginTop: 12 }}>
        <SkeletonBlock style={{ height: 24, width: 240, marginBottom: 8 }} />
        <SkeletonBlock style={{ height: 12, width: 180 }} />
      </View>
      <View style={{ marginTop: 14 }}>
        <SkeletonCard>
          <SkeletonBlock style={{ height: 12, width: 110, marginBottom: 12 }} />
          <SkeletonBlock style={{ height: 42, borderRadius: 10, marginBottom: 10 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
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

  if (!vehicle || !owner || !settlement) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ef4444' }}>Could not load vehicle data</Text>
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
        <Text style={{ color: '#db2777' }}>← Go back</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const outstanding = round2(settlement.netPayable - totalPaid);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb' }}>
      <View style={{ position: 'absolute', top: 18, left: -46, width: 180, height: 180, borderRadius: 90, backgroundColor: '#f9a8d455' }} />
      <View style={{ position: 'absolute', top: 180, right: -66, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 20 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Text style={{ color: '#db2777', fontSize: 18 }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: '#111111', fontSize: 20, fontWeight: 'bold' }}>{vehicle.reg_number}</Text>
          <Text style={{ color: '#6b5c67', fontSize: 12 }} numberOfLines={1} ellipsizeMode="tail">{owner.name} · {monthLabel(month)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: outstanding <= 0 ? '#22c55e' : '#f59e0b', fontWeight: 'bold', fontSize: 16 }}>
            {fmt(Math.abs(outstanding))}
          </Text>
          <Text style={{ color: '#6b5c67', fontSize: 11 }}>{outstanding <= 0 ? '✓ PAID' : 'outstanding'}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 14, padding: 12 }}>
          <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
            Settlement Month
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

      <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor="#ec4899" />}>

        {/* Settlement breakdown */}
        <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 12 }}>
          <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16, marginBottom: 16 }}>📋 Settlement Breakdown</Text>

          {/* Weight earnings */}
          <SL>① WEIGHT EARNINGS</SL>
          {trips.map(t => (
            <Row key={t.id} label={`${t.route_name ?? 'Route'} — ${t.tonnes}T × ₹${t.rate_snapshot}`}
              value={fmt(t.amount)} onDel={() => setDelModal({ type: 'trip', id: t.id, label: `${t.tonnes}T trip` })} />
          ))}
          {trips.length === 0 && <Text style={{ color: '#6b5c67', fontSize: 12, marginBottom: 8 }}>No trips this month</Text>}
          <TRow label="GROSS EARNING" value={fmt(settlement.gross)} />

          {/* Deductions */}
          <SL>② DEDUCTIONS</SL>
          <Row label="TDS @ 1%" value={`− ${fmt(settlement.tds)}`} red />
          <Row label={`Commission (${settlement.totalTonnes}T × ₹${owner.commission_rate})`} value={`− ${fmt(settlement.commission)}`} red />
          <Row label={`Accidental (${settlement.totalTonnes}T × ₹${owner.accidental_rate})`} value={`− ${fmt(settlement.accidental)}`} red />

          {/* Diesel */}
          <SL>⛽ DIESEL</SL>
          {diesel.map(d => (
            <Row key={d.id} label={`${fmtDate(d.date)} — ${d.litres}L × ₹${d.sell_rate}`}
              value={`− ${fmt(d.amount)}`} red onDel={() => setDelModal({ type: 'diesel', id: d.id, label: `${d.litres}L diesel` })} />
          ))}
          {diesel.length === 0 && <Text style={{ color: '#6b5c67', fontSize: 12, marginBottom: 8 }}>No diesel this month</Text>}
          <TRow label="DIESEL TOTAL" value={`− ${fmt(settlement.dieselTotal)}`} red />

          {/* GST */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SL>③ GST RECEIVED</SL>
            <TouchableOpacity onPress={() => setShowGST(true)}>
              <Text style={{ color: '#db2777', fontSize: 12, fontWeight: '700' }}>+ Add GST</Text>
            </TouchableOpacity>
          </View>
          {gst.map(g => (
            <Row key={g.id} label={`GST for ${monthLabel(g.belongs_to_month)}`}
              value={`+ ${fmt(g.net_gst)}`} green onDel={() => setDelModal({ type: 'gst', id: g.id, label: 'GST entry' })} />
          ))}
          {gst.length === 0 && <Text style={{ color: '#6b5c67', fontSize: 12, marginBottom: 8 }}>No GST this month</Text>}

          {/* Other deductions */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SL>④ OTHER DEDUCTIONS</SL>
            <TouchableOpacity onPress={() => setShowOther(true)}>
              <Text style={{ color: '#db2777', fontSize: 12, fontWeight: '700' }}>+ Add</Text>
            </TouchableOpacity>
          </View>
          {others.map(o => (
            <Row key={o.id} label={o.label} value={`− ${fmt(o.amount)}`} red
              onDel={() => setDelModal({ type: 'other', id: o.id, label: o.label })} />
          ))}

          {/* Net payable */}
          <View style={{ height: 1, backgroundColor: '#f2d7e6', marginVertical: 14 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 16 }}>NET PAYABLE</Text>
            <Text style={{ color: '#be185d', fontWeight: 'bold', fontSize: 22 }}>{fmt(settlement.netPayable)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ color: '#6b5c67', fontSize: 12 }}>Paid so far</Text>
            <Text style={{ color: '#6b5c67', fontSize: 12 }}>{fmt(totalPaid)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ color: '#111111', fontWeight: '700' }}>OUTSTANDING</Text>
            <Text style={{ color: outstanding <= 0 ? '#22c55e' : '#f59e0b', fontWeight: 'bold', fontSize: 18 }}>
              {fmt(Math.abs(outstanding))}
            </Text>
          </View>
        </View>

        {/* Admin private earnings */}
        {adminE && (
          <View style={{ backgroundColor: '#ffffffcc', borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f2d7e6' }}>
            <Text style={{ color: '#be185d', fontWeight: 'bold', marginBottom: 12 }}>🔒 YOUR EARNINGS (Private)</Text>
            {[
              { label: 'Commission Income', value: adminE.commissionIncome },
              { label: 'Diesel Profit (₹1.08/L)', value: adminE.dieselProfit },
              { label: 'GST Commission', value: adminE.gstCommission },
            ].map(e => (
              <View key={e.label} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ color: '#6b5c67', fontSize: 13 }}>{e.label}</Text>
                <Text style={{ color: '#111111', fontSize: 13, fontWeight: '500' }}>{fmt(e.value)}</Text>
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: '#f2d7e6', marginVertical: 8 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: '#be185d', fontWeight: '700' }}>TOTAL EARNED</Text>
              <Text style={{ color: '#be185d', fontWeight: 'bold', fontSize: 16 }}>{fmt(adminE.totalEarnings)}</Text>
            </View>
          </View>
        )}

        <View style={{ height: 64 }} />
      </ScrollView>

      {/* Modals */}
      <GSTModal visible={showGST} vehicleId={vehicle.id} gstRate={vehicle.gst_commission_rate} month={month}
        onClose={() => setShowGST(false)} onSaved={() => { setShowGST(false); load(true); }} />
      <OtherModal visible={showOther} vehicleId={vehicle.id} month={month}
        onClose={() => setShowOther(false)} onSaved={() => { setShowOther(false); load(true); }} />

      {/* Delete modal */}
      <Modal visible={!!delModal} animationType="fade" transparent onRequestClose={() => { setDelModal(null); setDelReason(''); }}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000bb', justifyContent: 'flex-end' }} onPress={() => { setDelModal(null); setDelReason(''); }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
            <Text style={{ color: '#111111', fontWeight: 'bold', fontSize: 18, marginBottom: 4 }}>Delete Entry</Text>
            <Text style={{ color: '#6b5c67', marginBottom: 16 }}>{delModal?.label}</Text>
            {delModal?.type === 'diesel' && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' }}>Reason *</Text>
                <TextInput style={{ backgroundColor: '#fff7fb', borderColor: '#f2d7e6', borderWidth: 1, color: '#111111', borderRadius: 12, padding: 14 }}
                  value={delReason} onChangeText={setDelReason} placeholder="e.g. Wrong entry, duplicate" placeholderTextColor="#9f8b97" />
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => { setDelModal(null); setDelReason(''); }}
                style={{ flex: 1, backgroundColor: '#fce7f3', borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ color: '#111111', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDelete}
                style={{ flex: 1, backgroundColor: '#ef4444', borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ color: 'white', fontWeight: 'bold' }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function SL({ children }: { children: string }) {
  return <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 14, marginBottom: 4 }}>{children}</Text>;
}

function Row({ label, value, red, green, onDel }: { label: string; value: string; red?: boolean; green?: boolean; onDel?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
      <Text style={{ color: '#6b5c67', fontSize: 12, flex: 1, marginRight: 8 }} numberOfLines={2}>{label}</Text>
      <Text style={{ color: red ? '#ef4444' : green ? '#22c55e' : '#111111', fontSize: 12, fontWeight: '600' }}>{value}</Text>
      {onDel && (
        <TouchableOpacity onPress={onDel} style={{ marginLeft: 8 }}>
          <Text style={{ color: '#6b5c67', fontSize: 13 }}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function TRow({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f2d7e6', marginTop: 4 }}>
      <Text style={{ color: '#6b5c67', fontSize: 12, fontWeight: 'bold' }}>{label}</Text>
      <Text style={{ color: red ? '#ef4444' : '#111111', fontSize: 13, fontWeight: 'bold' }}>{value}</Text>
    </View>
  );
}

function GSTModal({ visible, vehicleId, gstRate, month, onClose, onSaved }: any) {
  const [grossGST, setGrossGST] = useState('');
  const [forMonth, setForMonth] = useState(month);
  const [saving, setSaving]     = useState(false);
  const notice = useThemedNotice();

  const preview = () => {
    const g = parseFloat(grossGST);
    if (isNaN(g)) return null;
    return { comm: round2(g * gstRate), net: round2(g - round2(g * gstRate)) };
  };

  const save = async () => {
    const g = parseFloat(grossGST);
    if (isNaN(g) || g <= 0) { notice.showInfo('Invalid', 'Enter valid GST amount'); return; }
    setSaving(true);
    try { await addGSTEntry({ vehicle_id: vehicleId, belongs_to_month: forMonth, gross_gst: g, gst_commission_rate: gstRate }); setGrossGST(''); onSaved(); }
    catch (e) { notice.showError('Error', String(e)); } finally { setSaving(false); }
  };

  const p = preview();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff7fb', padding: 20 }}>
        <MHead title="Add GST Entry" onClose={onClose} />
        <MF label="Gross GST Received (₹) *" value={grossGST} onChange={setGrossGST} placeholder="e.g. 89155" kb="decimal-pad" />
        <MF label="For Month (YYYY-MM) *" value={forMonth} onChange={setForMonth} />
        {p && (
          <View style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <Text style={{ color: '#6b5c67', fontSize: 12, marginBottom: 8 }}>GST BREAKDOWN</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: '#6b5c67', fontSize: 13 }}>Gross GST</Text>
              <Text style={{ color: '#111111', fontSize: 13 }}>{fmt(parseFloat(grossGST))}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: '#6b5c67', fontSize: 13 }}>Your commission ({(gstRate * 100).toFixed(0)}%)</Text>
              <Text style={{ color: '#be185d', fontSize: 13 }}>− {fmt(p.comm)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: '#111111', fontSize: 13, fontWeight: 'bold' }}>Net GST to owner</Text>
              <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: 'bold' }}>+ {fmt(p.net)}</Text>
            </View>
          </View>
        )}
        <SaveBtn saving={saving} onPress={save} label="Save GST Entry" />
      </View>
    </Modal>
  );
}

function OtherModal({ visible, vehicleId, month, onClose, onSaved }: any) {
  const [label, setLabel]   = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  const save = async () => {
    if (!label.trim()) { notice.showInfo('Required', 'Enter label'); return; }
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) { notice.showInfo('Invalid', 'Enter valid amount'); return; }
    setSaving(true);
    try { await addOtherDeduction({ vehicle_id: vehicleId, month, label: label.trim(), amount: a }); setLabel(''); setAmount(''); onSaved(); }
    catch (e) { notice.showError('Error', String(e)); } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff7fb', padding: 20 }}>
        <MHead title="Add Deduction" onClose={onClose} />
        <MF label="Label *" value={label} onChange={setLabel} placeholder="e.g. GPS, Larcha" />
        <MF label="Amount (₹) *" value={amount} onChange={setAmount} placeholder="e.g. 6500" kb="decimal-pad" />
        <SaveBtn saving={saving} onPress={save} label="Save Deduction" />
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
