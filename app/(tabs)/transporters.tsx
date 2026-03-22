import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Modal, TextInput, Pressable } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';
import { useThemedNotice } from '../../components/ThemedNoticeProvider';
import { upsertTransportOwner } from '../../lib/queries';
import { fetchTransportersSummary } from '../../lib/summaries';
import { fmtShort, monthKey, monthLabel } from '../../constants/defaults';
import type { TransportOwner } from '../../types';

export default function TransportersScreen() {
  const [showAdd, setShowAdd]   = useState(false);
  const [editingOwner, setEditingOwner] = useState<TransportOwner | null>(null);
  const listRef = useRef<ScrollView | null>(null);
  const month = monthKey();
  const queryClient = useQueryClient();
  const notice = useThemedNotice();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['transportersSummary', month],
    queryFn: () => fetchTransportersSummary(month),
    refetchInterval: 45_000,
  });

  const rows = data ?? [];
  const loading = isLoading;

  useEffect(() => {
    if (error) notice.showError('Error', 'Could not load owners');
  }, [error, notice]);

  useFocusEffect(
    useCallback(() => {
      listRef.current?.scrollTo({ y: 0, animated: false });
    }, [])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff7fb' }}>
      <View style={{ position: 'absolute', top: 28, left: -50, width: 190, height: 190, borderRadius: 95, backgroundColor: '#f9a8d455' }} />
      <View style={{ position: 'absolute', top: 210, right: -65, width: 220, height: 220, borderRadius: 110, backgroundColor: '#fbcfe855' }} />

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
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: '#111111', fontSize: 26, fontWeight: '800' }}>Transport Owners</Text>
          <Text style={{ color: '#6b5c67', fontSize: 13 }}>{monthLabel(month)}</Text>
          <Text style={{ color: '#8d7a86', fontSize: 11, marginTop: 4 }}>Hold an owner card to edit commission and accidental rates</Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowAdd(true)}
          accessibilityRole="button"
          accessibilityLabel="Add transport owner"
          style={{ alignSelf: 'flex-start', backgroundColor: '#d9468f', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, minWidth: 148, alignItems: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '800', fontSize: 15 }}>+ Add Owner</Text>
        </TouchableOpacity>
      </View>

      <ScrollView ref={listRef} style={{ flex: 1, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => { void refetch(); }} tintColor="#ec4899" />}>
        {loading && (
          <>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 16, width: 160, marginBottom: 8 }} />
              <SkeletonBlock style={{ height: 12, width: 120, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 10, width: 90 }} />
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 16, width: 170, marginBottom: 8 }} />
              <SkeletonBlock style={{ height: 12, width: 130, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 10, width: 100 }} />
            </SkeletonCard>
            <SkeletonCard>
              <SkeletonBlock style={{ height: 16, width: 150, marginBottom: 8 }} />
              <SkeletonBlock style={{ height: 12, width: 125, marginBottom: 10 }} />
              <SkeletonBlock style={{ height: 10, width: 86 }} />
            </SkeletonCard>
          </>
        )}
        {!loading && rows.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 64 }}>
            <Text style={{ fontSize: 48 }}>🚛</Text>
            <Text style={{ color: '#111111', fontSize: 18, fontWeight: 'bold', marginTop: 16 }}>No transport owners yet</Text>
            <Text style={{ color: '#6b5c67', marginTop: 4 }}>Tap + Add to get started</Text>
          </View>
        )}
        {rows.map(({ owner, vehicleCount, balance }) => (
          <TouchableOpacity key={owner.id} onPress={() => router.push(`/transporter/${owner.id}`)} onLongPress={() => setEditingOwner(owner)} delayLongPress={260}
            style={{ backgroundColor: '#ffffffcc', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#111111', fontSize: 16, fontWeight: 'bold' }}>{owner.name}</Text>
                <Text style={{ color: '#6b5c67', fontSize: 12, marginTop: 2 }}>
                  {vehicleCount} vehicles · ₹{owner.commission_rate}/T com · ₹{owner.accidental_rate}/T acc
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: balance >= 0 ? '#22c55e' : '#ef4444', fontSize: 16, fontWeight: 'bold' }}>
                  {fmtShort(Math.abs(balance))}
                </Text>
                <Text style={{ color: '#6b5c67', fontSize: 11 }}>{balance >= 0 ? 'balance' : 'overpaid'}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
        <View style={{ height: 32 }} />
      </ScrollView>

      <AddOwnerModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={() => {
          setShowAdd(false);
          void queryClient.invalidateQueries({ queryKey: ['transportersSummary', month] });
          void queryClient.invalidateQueries({ queryKey: ['homeSummary', month] });
          void refetch();
        }}
      />

      <EditOwnerRatesModal
        owner={editingOwner}
        visible={!!editingOwner}
        onClose={() => setEditingOwner(null)}
        onSaved={() => {
          setEditingOwner(null);
          void queryClient.invalidateQueries({ queryKey: ['transportersSummary', month] });
          void queryClient.invalidateQueries({ queryKey: ['homeSummary', month] });
          void refetch();
        }}
      />
    </SafeAreaView>
  );
}

function AddOwnerModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName]       = useState('');
  const [contact, setContact] = useState('');
  const [commRate, setComm]   = useState('');
  const [accRate, setAcc]     = useState('');
  const [saving, setSaving]   = useState(false);
  const notice = useThemedNotice();

  const save = async () => {
    if (!name.trim()) { notice.showInfo('Required', 'Name is required'); return; }
    const cr = parseFloat(commRate), ar = parseFloat(accRate);
    if (isNaN(cr) || isNaN(ar)) { notice.showInfo('Required', 'Enter valid rates'); return; }
    setSaving(true);
    try {
      await upsertTransportOwner({ name: name.trim(), contact: contact || null, commission_rate: cr, accidental_rate: ar });
      setName(''); setContact(''); setComm(''); setAcc('');
      notice.showSuccess('Saved', 'Transport owner added.');
      onSaved();
    } catch (e) { notice.showError('Error', String(e)); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff7fb', padding: 20 }}>
        <View style={{ position: 'absolute', top: 30, right: -70, width: 210, height: 210, borderRadius: 105, backgroundColor: '#fbcfe855' }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ color: '#111111', fontSize: 20, fontWeight: 'bold' }}>Add Transport Owner</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: '#db2777' }}>Cancel</Text></TouchableOpacity>
        </View>
        <F label="Name *" value={name} onChange={setName} placeholder="e.g. Sushil Kumar Bhagat" />
        <F label="Contact" value={contact} onChange={setContact} placeholder="Phone number" kb="phone-pad" />
        <F label="Commission Rate (₹/tonne) *" value={commRate} onChange={setComm} placeholder="e.g. 15" kb="decimal-pad" />
        <F label="Accidental Rate (₹/tonne) *" value={accRate} onChange={setAcc} placeholder="e.g. 5" kb="decimal-pad" />
        <TouchableOpacity onPress={save} disabled={saving}
          style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 }}>
          <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{saving ? 'Saving...' : 'Save Owner'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function EditOwnerRatesModal({
  owner,
  visible,
  onClose,
  onSaved,
}: {
  owner: TransportOwner | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [commRate, setCommRate] = useState('');
  const [accRate, setAccRate] = useState('');
  const [saving, setSaving] = useState(false);
  const notice = useThemedNotice();

  useEffect(() => {
    if (!owner || !visible) return;
    setCommRate(String(owner.commission_rate ?? ''));
    setAccRate(String(owner.accidental_rate ?? ''));
  }, [owner, visible]);

  const save = async () => {
    if (!owner) return;
    const cr = parseFloat(commRate);
    const ar = parseFloat(accRate);
    if (isNaN(cr) || isNaN(ar)) {
      notice.showInfo('Required', 'Enter valid commission and accidental rates');
      return;
    }

    setSaving(true);
    try {
      await upsertTransportOwner({
        id: owner.id,
        name: owner.name,
        contact: owner.contact,
        commission_rate: cr,
        accidental_rate: ar,
      });
      notice.showSuccess('Saved', 'Owner rates updated.');
      onSaved();
    } catch (e) {
      notice.showError('Error', String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#00000055', justifyContent: 'center', padding: 16 }} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: '#fff7fb', borderRadius: 18, borderWidth: 1, borderColor: '#f2d7e6', padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: '#111111', fontSize: 18, fontWeight: '800' }}>Edit Rates</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: '#db2777', fontWeight: '700' }}>Close</Text></TouchableOpacity>
          </View>
          <Text style={{ color: '#6b5c67', marginBottom: 14 }} numberOfLines={1} ellipsizeMode="tail">{owner?.name}</Text>

          <F label="Commission Rate (₹/tonne) *" value={commRate} onChange={setCommRate} placeholder="e.g. 15" kb="decimal-pad" />
          <F label="Accidental Rate (₹/tonne) *" value={accRate} onChange={setAccRate} placeholder="e.g. 5" kb="decimal-pad" />

          <TouchableOpacity onPress={save} disabled={saving}
            style={{ backgroundColor: saving ? '#d4d4d8' : '#d9468f', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 2 }}>
            <Text style={{ color: '#ffffff', fontWeight: '800' }}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function F({ label, value, onChange, placeholder, kb = 'default' }: any) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <TextInput style={{ backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f2d7e6', color: '#111111', borderRadius: 12, padding: 14 }}
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#9f8b97" keyboardType={kb} />
    </View>
  );
}
