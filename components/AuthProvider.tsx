// components/AuthProvider.tsx
import { useEffect, type ReactNode } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../lib/supabase';

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { session, loading, pinConfigured, pinVerifiedThisSession, loadSession, setPinVerified } =
    useAuthStore();

  // Load session from AsyncStorage on mount
  useEffect(() => {
    loadSession();
  }, []);

  // Keep session in sync with Supabase auth events
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      useAuthStore.setState({ session: newSession });
      // If signed out, reset pin verification for this session
      if (!newSession) {
        setPinVerified(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Navigation guard — runs whenever auth state or route changes
  useEffect(() => {
    if (loading) return;

    const seg0 = segments[0] as string;
    const inAuthGroup = seg0 === 'login' || seg0 === 'setup-pin';

    if (!session || !pinConfigured) {
      // No Supabase session or PIN never set → must set up
      if (seg0 !== 'setup-pin') {
        router.replace('/setup-pin' as any);
      }
    } else if (!pinVerifiedThisSession) {
      // Has session + PIN configured, but PIN not entered yet (cold start)
      if (seg0 !== 'login') {
        router.replace('/login' as any);
      }
    } else {
      // Fully authenticated — send away from auth screens
      if (inAuthGroup) {
        router.replace('/(tabs)/' as any);
      }
    }
  }, [session, loading, pinConfigured, pinVerifiedThisSession, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff7fb' }}>
        <ActivityIndicator size="large" color="#db2777" />
      </View>
    );
  }

  return <>{children}</>;
}
