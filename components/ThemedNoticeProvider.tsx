import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';

type NoticeTone = 'info' | 'error' | 'success';

type NoticeState = {
  visible: boolean;
  title: string;
  message: string;
  tone: NoticeTone;
};

type NoticeContextType = {
  showInfo: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
  hide: () => void;
};

const NoticeContext = createContext<NoticeContextType | null>(null);

export function ThemedNoticeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NoticeState>({
    visible: false,
    title: '',
    message: '',
    tone: 'info',
  });
  const autoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = useMemo<NoticeContextType>(() => ({
    showInfo: (title, message = '') => setState({ visible: true, title, message, tone: 'info' }),
    showError: (title, message = '') => setState({ visible: true, title, message, tone: 'error' }),
    showSuccess: (title, message = '') => setState({ visible: true, title, message, tone: 'success' }),
    hide: () => setState((s) => ({ ...s, visible: false })),
  }), []);

  const toneColor = useMemo(() => {
    if (state.tone === 'error') return Theme.colors.light.error;
    if (state.tone === 'success') return Theme.colors.light.success;
    return Theme.colors.light.primary;
  }, [state.tone]);

  const toneIcon = state.tone === 'error' ? 'close-circle' : state.tone === 'success' ? 'checkmark-circle' : 'information-circle';
  
  const toneBg = useMemo(() => {
    if (state.tone === 'error') return '#fee2e2'; // Light red (could move to Theme.colors.light.errorContainer)
    if (state.tone === 'success') return '#dcfce7'; // Light green
    return '#fce7f3'; // Light pink/info
  }, [state.tone]);

  useEffect(() => {
    if (autoHideRef.current) {
      clearTimeout(autoHideRef.current);
      autoHideRef.current = null;
    }

    if (state.visible && state.tone === 'success') {
      autoHideRef.current = setTimeout(() => {
        setState((s) => ({ ...s, visible: false }));
      }, 1200);
    }

    return () => {
      if (autoHideRef.current) {
        clearTimeout(autoHideRef.current);
        autoHideRef.current = null;
      }
    };
  }, [state.visible, state.tone]);

  return (
    <NoticeContext.Provider value={api}>
      {children}
      <Modal visible={state.visible} transparent animationType="fade" onRequestClose={api.hide}>
        <Pressable style={styles.overlay} onPress={api.hide}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modalContainer}>
            <View style={[styles.iconContainer, { backgroundColor: toneBg }]}>
              <Ionicons name={toneIcon} size={20} color={toneColor} />
            </View>
            <Text style={styles.title}>{state.title}</Text>
            {!!state.message && (
              <Text style={styles.message}>{state.message}</Text>
            )}
            {state.tone !== 'success' && (
              <View style={styles.buttonRow}>
                <TouchableOpacity onPress={api.hide} style={[styles.button, { backgroundColor: toneColor }]}>
                  <Text style={styles.buttonText}>OK</Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </NoticeContext.Provider>
  );
}

export function useThemedNotice() {
  const ctx = useContext(NoticeContext);
  if (!ctx) throw new Error('useThemedNotice must be used inside ThemedNoticeProvider');
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  modalContainer: {
    backgroundColor: Theme.colors.light.background,
    borderRadius: Theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: Theme.colors.light.border,
    padding: Theme.spacing.lg,
    ...Theme.shadows.medium,
  },
  iconContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.sm,
  },
  title: {
    color: Theme.colors.light.text,
    fontSize: Theme.typography.sizes.heading3,
    fontWeight: Theme.typography.weights.bold,
  },
  message: {
    color: Theme.colors.light.secondary,
    marginTop: Theme.spacing.sm,
    lineHeight: Theme.typography.lineHeights.body,
    fontSize: Theme.typography.sizes.body,
  },
  buttonRow: {
    marginTop: Theme.spacing.lg,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  button: {
    borderRadius: Theme.borderRadius.sm,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.lg,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: Theme.typography.weights.bold,
  },
});
