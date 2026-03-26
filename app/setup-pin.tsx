// app/setup-pin.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore';

type Step = 'credentials' | 'choose-pin' | 'confirm-pin';

export default function SetupPinScreen() {
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [chosenPin, setChosenPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { signInWithCredentials, setupPin } = useAuthStore();

  const C = {
    bg: '#fff7fb',
    card: '#ffffff',
    border: '#f2d7e6',
    text: '#111111',
    muted: '#6b7280',
    primary: '#db2777',
    accent: '#fdf2f8',
  };

  // ── Step 1: Verify Supabase credentials ────────────────────
  const handleVerifyCredentials = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signInWithCredentials(email.trim(), password.trim());
      setStep('choose-pin');
    } catch (e: any) {
      setError(e.message || 'Invalid credentials. Check your Supabase Auth user.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Choose PIN ────────────────────────────────────
  const handleChoosePin = () => {
    if (chosenPin.length !== 4 || !/^\d{4}$/.test(chosenPin)) {
      setError('Please enter exactly 4 digits.');
      return;
    }
    setError('');
    setStep('confirm-pin');
  };

  // ── Step 3: Confirm PIN + save ─────────────────────────────
  const handleConfirmPin = async () => {
    if (confirmPin !== chosenPin) {
      setError('PINs do not match. Try again.');
      setConfirmPin('');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await setupPin(chosenPin);
      router.replace('/(tabs)/' as any);
    } catch (e: any) {
      setError(e.message || 'Failed to save PIN.');
    } finally {
      setLoading(false);
    }
  };

  const StepIndicator = () => (
    <View style={styles.stepIndicator}>
      {(['credentials', 'choose-pin', 'confirm-pin'] as Step[]).map((s, i) => (
        <React.Fragment key={s}>
          <View style={[styles.stepDot, step === s && styles.stepDotActive,
            (['credentials', 'choose-pin', 'confirm-pin'] as Step[]).indexOf(step) > i && styles.stepDotDone
          ]} />
          {i < 2 && <View style={[styles.stepLine,
            (['credentials', 'choose-pin', 'confirm-pin'] as Step[]).indexOf(step) > i && styles.stepLineDone
          ]} />}
        </React.Fragment>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.logoArea}>
            <View style={styles.iconWrapper}>
              <Ionicons name="shield-checkmark" size={32} color={C.primary} />
            </View>
            <Text style={styles.title}>Secure Your App</Text>
            <Text style={styles.subtitle}>
              {step === 'credentials' && 'Verify your Supabase account credentials'}
              {step === 'choose-pin' && 'Choose a 4-digit PIN for quick access'}
              {step === 'confirm-pin' && 'Confirm your PIN'}
            </Text>
          </View>

          <StepIndicator />

          {/* ── Step 1: Credentials ── */}
          {step === 'credentials' && (
            <View style={styles.card}>
              <Text style={styles.label}>Supabase Email</Text>
              <View style={styles.inputRow}>
                <Ionicons name="mail-outline" size={18} color={C.muted} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                />
              </View>

              <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={18} color={C.muted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your Supabase password"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.muted} />
                </TouchableOpacity>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.btn, loading && { opacity: 0.7 }]}
                onPress={handleVerifyCredentials}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <><Ionicons name="chevron-forward" size={18} color="#fff" style={{ marginRight: 6 }} /><Text style={styles.btnText}>Verify & Continue</Text></>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* ── Step 2: Choose PIN ── */}
          {step === 'choose-pin' && (
            <View style={styles.card}>
              <Text style={styles.label}>Enter a 4-digit PIN</Text>
              <TextInput
                style={styles.pinInput}
                value={chosenPin}
                onChangeText={(t) => setChosenPin(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
                placeholder="• • • •"
                placeholderTextColor="#d1d5db"
                textAlign="center"
              />
              <Text style={{ fontSize: 11, color: C.muted, marginTop: 8, textAlign: 'center' }}>
                This PIN will be required every time you open the app.
              </Text>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity style={styles.btn} onPress={handleChoosePin}>
                <Ionicons name="chevron-forward" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.btnText}>Continue</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Step 3: Confirm PIN ── */}
          {step === 'confirm-pin' && (
            <View style={styles.card}>
              <Text style={styles.label}>Re-enter your PIN to confirm</Text>
              <TextInput
                style={styles.pinInput}
                value={confirmPin}
                onChangeText={(t) => setConfirmPin(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
                placeholder="• • • •"
                placeholderTextColor="#d1d5db"
                textAlign="center"
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.btn, loading && { opacity: 0.7 }]}
                onPress={handleConfirmPin}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <><Ionicons name="checkmark" size={18} color="#fff" style={{ marginRight: 6 }} /><Text style={styles.btnText}>Save PIN & Enter App</Text></>
                }
              </TouchableOpacity>

              <TouchableOpacity style={{ marginTop: 12, alignItems: 'center' }} onPress={() => { setStep('choose-pin'); setConfirmPin(''); setError(''); }}>
                <Text style={{ color: C.muted, fontSize: 12 }}>← Back</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fdf2f8',
    borderWidth: 1.5,
    borderColor: '#f9a8d4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#db2777',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 6,
    textAlign: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e5e7eb',
  },
  stepDotActive: {
    backgroundColor: '#db2777',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stepDotDone: {
    backgroundColor: '#db2777',
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 4,
  },
  stepLineDone: {
    backgroundColor: '#db2777',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: '#f2d7e6',
    shadowColor: '#db2777',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#f2d7e6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fdf2f8',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  pinInput: {
    borderWidth: 1.5,
    borderColor: '#f2d7e6',
    borderRadius: 12,
    paddingVertical: 16,
    fontSize: 28,
    letterSpacing: 16,
    color: '#111827',
    backgroundColor: '#fdf2f8',
    fontWeight: '800',
  },
  btn: {
    marginTop: 20,
    backgroundColor: '#db2777',
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#db2777',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  error: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
  },
});
