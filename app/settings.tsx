import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Pressable, StyleSheet
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAppStore } from '../store/useAppStore';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useThemedNotice } from '../components/ThemedNoticeProvider';

export default function SettingsScreen() {
  const { globalSettings, updateSettings, loadSettings, settingsLoaded } = useAppStore();
  const notice = useThemedNotice();

  const [tds, setTds] = useState('');
  const [dieselBuy, setDieselBuy] = useState('');
  const [dieselSell, setDieselSell] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsLoaded) {
      setTds((globalSettings.tds_rate * 100).toString());
      setDieselBuy(globalSettings.diesel_buy_rate.toString());
      setDieselSell(globalSettings.diesel_sell_rate.toString());
    }
  }, [settingsLoaded, globalSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const patch = {
        tds_rate: parseFloat(tds) / 100,
        diesel_buy_rate: parseFloat(dieselBuy),
        diesel_sell_rate: parseFloat(dieselSell),
      };

      if (isNaN(patch.tds_rate) || isNaN(patch.diesel_buy_rate) || isNaN(patch.diesel_sell_rate)) {
        throw new Error('Please enter valid numeric values');
      }

      await updateSettings(patch);
      notice.showSuccess('Settings Updated', 'Global rates have been synchronized with the database.');
    } catch (e: any) {
      notice.showError('Save Failed', e.message || 'Could not update settings.');
    } finally {
      setSaving(false);
    }
  };

  const C = {
    bg: '#fff7fb',
    card: '#ffffff',
    border: '#f2d7e6',
    text: '#111111',
    muted: '#6b5c67',
    primary: '#db2777',
    accent: '#d9468f',
  };

  if (!settingsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff77', borderBottomWidth: 1, borderBottomColor: C.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.text }}>App Settings</Text>
          <Text style={{ fontSize: 11, color: C.muted }}>Manage global rates & configurations</Text>
        </View>
        <Ionicons name="settings-outline" size={24} color={C.primary} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={{ marginBottom: 24 }}>
          <View style={styles.sectionHeader}>
            <Ionicons name="calculator-outline" size={16} color={C.primary} />
            <Text style={styles.sectionTitle}>Business Rates</Text>
          </View>
          
          <View style={styles.card}>
            <Text style={styles.label}>TDS Deduction (%)</Text>
            <ThemedTextInput
              value={tds}
              onChangeText={setTds}
              keyboardType="numeric"
              placeholder="e.g. 1.0"
              containerStyle={{ marginBottom: 16 }}
            />
            <Text style={{ fontSize: 11, color: C.muted, marginTop: -8 }}>Applied to gross transport income.</Text>
          </View>
        </View>

        <View style={{ marginBottom: 24 }}>
          <View style={styles.sectionHeader}>
            <Ionicons name="flash-outline" size={16} color={C.primary} />
            <Text style={styles.sectionTitle}>Diesel Marketplace</Text>
          </View>
          
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Buy Rate (₹)</Text>
                <ThemedTextInput
                  value={dieselBuy}
                  onChangeText={setDieselBuy}
                  keyboardType="numeric"
                  placeholder="92.92"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Sell Rate (₹)</Text>
                <ThemedTextInput
                  value={dieselSell}
                  onChangeText={setDieselSell}
                  keyboardType="numeric"
                  placeholder="94.00"
                />
              </View>
            </View>
            
            <View style={{ marginTop: 16, padding: 12, backgroundColor: '#fdf2f8', borderRadius: 10, borderWidth: 1, borderColor: '#fce7f3' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: '#9d174d', fontWeight: '600' }}>Current Profit Potential</Text>
                <Text style={{ fontSize: 12, color: '#db2777', fontWeight: '800' }}>
                   ₹{(parseFloat(dieselSell || '0') - parseFloat(dieselBuy || '0')).toFixed(2)} / Litre
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={{ marginTop: 8 }}>
          <TouchableOpacity 
            onPress={handleSave} 
            disabled={saving}
            style={{ 
              backgroundColor: C.primary, 
              padding: 16, 
              borderRadius: 14, 
              flexDirection: 'row', 
              alignItems: 'center', 
              justifyContent: 'center',
              shadowColor: C.primary,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 4,
              opacity: saving ? 0.7 : 1
            }}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Sync Settings</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 32, alignItems: 'center' }}>
          <Text style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>TransportLedger v2.5.0</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 9, marginTop: 4 }}>Last Synced: {new Date(globalSettings.updated_at).toLocaleString()}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#f2d7e6',
    shadowColor: '#f2d7e6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 8,
    marginLeft: 2,
  }
});
