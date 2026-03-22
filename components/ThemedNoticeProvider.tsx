import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

  const toneColor = state.tone === 'error' ? '#ef4444' : state.tone === 'success' ? '#16a34a' : '#d9468f';
  const toneIcon = state.tone === 'error' ? 'close-circle' : state.tone === 'success' ? 'checkmark-circle' : 'information-circle';
  const toneBg = state.tone === 'error' ? '#fee2e2' : state.tone === 'success' ? '#dcfce7' : '#fce7f3';

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
        <Pressable style={{ flex: 1, backgroundColor: '#00000055', justifyContent: 'center', padding: 18 }} onPress={api.hide}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: '#ffffffef', borderRadius: 18, borderWidth: 1, borderColor: '#f2d7e6', padding: 16 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: toneBg, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Ionicons name={toneIcon} size={20} color={toneColor} />
            </View>
            <Text style={{ color: '#111111', fontSize: 18, fontWeight: '800' }}>{state.title}</Text>
            {!!state.message && (
              <Text style={{ color: '#6b5c67', marginTop: 8, lineHeight: 20 }}>{state.message}</Text>
            )}
            {state.tone !== 'success' && (
              <View style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end' }}>
                <TouchableOpacity onPress={api.hide} style={{ backgroundColor: toneColor, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 }}>
                  <Text style={{ color: '#ffffff', fontWeight: '700' }}>OK</Text>
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
