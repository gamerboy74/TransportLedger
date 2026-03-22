import { useEffect, useRef } from 'react';
import { subscribeOfflineQueueEvents } from '../lib/offlineQueue';
import { useThemedNotice } from './ThemedNoticeProvider';

export function OfflineQueueNoticeBridge() {
  const notice = useThemedNotice();
  const lastFlushedAtRef = useRef(0);

  useEffect(() => {
    const unsub = subscribeOfflineQueueEvents((event) => {
      if (event.type === 'queued') {
        if (event.deduped) {
          notice.showInfo('Already Queued', 'Same offline change is already pending sync.');
          return;
        }
        notice.showInfo('Saved Offline', 'No network. Change queued and will sync automatically.');
        return;
      }

      if (event.type === 'flushed' && event.processed > 0) {
        const now = Date.now();
        if (now - lastFlushedAtRef.current < 12_000) return;
        lastFlushedAtRef.current = now;
        notice.showSuccess('Synced', `${event.processed} queued change(s) synced.`);
      }
    });

    return unsub;
  }, [notice]);

  return null;
}
