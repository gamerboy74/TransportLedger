import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  StatusBar,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuthStore } from '../store/useAuthStore';

const PIN_LENGTH = 4;

export default function LoginScreen() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const { verifyPin, biometricsEnabled, setPinVerified } = useAuthStore();

  useEffect(() => {
    if (biometricsEnabled) {
      // Small delay to ensure UI is ready/transitioned
      const timer = setTimeout(() => {
        handleBiometricAuth();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [biometricsEnabled]);

  const handleBiometricAuth = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      
      if (!hasHardware || !isEnrolled) return;

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock TransportLedger',
        fallbackLabel: 'Use PIN',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setPinVerified(true);
        router.replace('/(tabs)/' as any);
      }
    } catch (e) {
      console.error('Biometric error:', e);
    }
  };

  const shake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleDigit = async (digit: string) => {
    if (pin.length >= PIN_LENGTH) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length === PIN_LENGTH) {
      const valid = await verifyPin(newPin);
      if (valid) {
        router.replace('/(tabs)/' as any);
      } else {
        shake();
        setError('Incorrect PIN. Try again.');
        setTimeout(() => setPin(''), 400);
      }
    }
  };

  const handleBackspace = () => {
    setPin((p) => p.slice(0, -1));
    setError('');
  };

  const KEYS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['BIOM', '0', '⌫'],
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff7fb" />

      {/* Logo area */}
      <View style={styles.logoArea}>
        <View style={styles.iconWrapper}>
          <Ionicons name="lock-closed" size={32} color="#db2777" />
        </View>
        <Text style={styles.appName}>TransportLedger</Text>
        <Text style={styles.subtitle}>Enter your PIN to continue</Text>
      </View>

      {/* PIN dots */}
      <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              pin.length > i && styles.dotFilled,
              error ? styles.dotError : null,
            ]}
          />
        ))}
      </Animated.View>

      {error ? <Text style={styles.errorText}>{error}</Text> : <View style={{ height: 20 }} />}

      {/* Numpad */}
      <View style={styles.numpad}>
        {KEYS.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((key, ki) => {
              if (key === 'BIOM') {
                if (!biometricsEnabled) return <View key={ki} style={styles.keyPlaceholder} />;
                return (
                  <TouchableOpacity key={ki} style={styles.key} onPress={handleBiometricAuth}>
                    <Ionicons name="finger-print" size={26} color="#db2777" />
                  </TouchableOpacity>
                );
              }
              if (key === '⌫') {
                return (
                  <TouchableOpacity key={ki} style={styles.key} onPress={handleBackspace}>
                    <Ionicons name="backspace-outline" size={24} color="#374151" />
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity key={ki} style={styles.key} onPress={() => handleDigit(key)}>
                  <Text style={styles.keyText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Forgot PIN */}
      <Pressable style={styles.forgotBtn} onPress={() => router.replace('/setup-pin' as any)}>
        <Text style={styles.forgotText}>Forgot PIN? Reset with Supabase credentials</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff7fb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 48,
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
  appName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
    fontWeight: '500',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 12,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#db2777',
    borderColor: '#db2777',
  },
  dotError: {
    borderColor: '#ef4444',
    backgroundColor: '#fecaca',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
    height: 20,
  },
  numpad: {
    marginTop: 32,
    gap: 12,
    width: '75%',
    maxWidth: 260,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  key: {
    flex: 1,
    aspectRatio: 1.4,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#f2d7e6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#db2777',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  keyPlaceholder: {
    flex: 1,
    aspectRatio: 1.4,
  },
  keyText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  forgotBtn: {
    marginTop: 40,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  forgotText: {
    color: '#db2777',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
