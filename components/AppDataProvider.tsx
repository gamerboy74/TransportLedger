import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/queryClient';
import { useAppStore } from '../store/useAppStore';

export function AppDataProvider({ children }: { children: ReactNode }) {
  const loadSettings = useAppStore(s => s.loadSettings);

  useEffect(() => {
    loadSettings();

    const appSub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });

    const netUnsub = NetInfo.addEventListener((state) => {
      onlineManager.setOnline(!!state.isConnected && !!state.isInternetReachable);
    });

    return () => {
      appSub.remove();
      netUnsub();
    };
  }, [loadSettings]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
