// store/useAuthStore.ts
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

const PIN_HASH_KEY = 'tl_pin_hash';
const BIOMETRIC_ENABLED_KEY = 'tl_biometric_enabled';
const PIN_SALT = 'TransportLedger_v2_salt_2025';

async function hashPin(pin: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    PIN_SALT + pin
  );
  return digest;
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  pinConfigured: boolean;
  /** true only for the current app session after PIN entry */
  pinVerifiedThisSession: boolean;
  biometricsEnabled: boolean;

  loadSession: () => Promise<void>;
  signInWithCredentials: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setupPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  setPinVerified: (verified: boolean) => void;
  setBiometricsEnabled: (enabled: boolean) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  pinConfigured: false,
  pinVerifiedThisSession: false,
  biometricsEnabled: false,

  loadSession: async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const storedHash = await AsyncStorage.getItem(PIN_HASH_KEY);
      const bioEnabled = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
      
      set({
        session: data.session,
        pinConfigured: !!storedHash,
        biometricsEnabled: bioEnabled === 'true',
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  signInWithCredentials: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    set({ session: data.session });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, pinVerifiedThisSession: false });
  },

  setupPin: async (pin: string) => {
    const hash = await hashPin(pin);
    await AsyncStorage.setItem(PIN_HASH_KEY, hash);
    set({ pinConfigured: true, pinVerifiedThisSession: true });
  },

  verifyPin: async (pin: string) => {
    const storedHash = await AsyncStorage.getItem(PIN_HASH_KEY);
    if (!storedHash) return false;
    const inputHash = await hashPin(pin);
    const isValid = inputHash === storedHash;
    if (isValid) {
      set({ pinVerifiedThisSession: true });
    }
    return isValid;
  },

  setPinVerified: (verified: boolean) => set({ pinVerifiedThisSession: verified }),

  setBiometricsEnabled: async (enabled: boolean) => {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled.toString());
    set({ biometricsEnabled: enabled });
  },
}));
