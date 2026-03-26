import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { ThemedNoticeProvider } from '../components/ThemedNoticeProvider';
import { AppDataProvider } from '../components/AppDataProvider';
import { OfflineQueueManager } from '../components/OfflineQueueManager';
import { OfflineQueueNoticeBridge } from '../components/OfflineQueueNoticeBridge';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AuthProvider } from '../components/AuthProvider';
import '../global.css';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemedNoticeProvider>
          <AppDataProvider>
            <AuthProvider>
              <OfflineQueueManager />
              <OfflineQueueNoticeBridge />
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false }} />
            </AuthProvider>
          </AppDataProvider>
        </ThemedNoticeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
