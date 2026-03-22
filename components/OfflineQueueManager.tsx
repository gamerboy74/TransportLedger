import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { flushOfflineQueue } from '../lib/offlineQueue';
import { queryClient } from '../lib/queryClient';

export function OfflineQueueManager() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const run = async () => {
      const { processed } = await flushOfflineQueue();
      if (processed > 0) {
        await queryClient.invalidateQueries();
      }
    };

    void run();

    intervalRef.current = setInterval(() => {
      const state = AppState.currentState;
      if (state === 'active') {
        void run();
      }
    }, 20_000);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void run();
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      sub.remove();
    };
  }, []);

  return null;
}
