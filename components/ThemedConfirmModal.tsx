import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ThemedConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  const confirmBg = destructive ? '#ef4444' : '#d9468f';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 18 }} onPress={onCancel}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: '#ffffffef', borderColor: '#f2d7e6', borderWidth: 1, borderRadius: 18, padding: 16 }}>
          <Text style={{ color: '#111111', fontSize: 18, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: '#6b5c67', marginTop: 8, lineHeight: 20 }}>{message}</Text>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <TouchableOpacity
              onPress={onCancel}
              style={{ backgroundColor: '#fce7f3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}
            >
              <Text style={{ color: '#111111', fontWeight: '700' }}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              style={{ backgroundColor: confirmBg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}
            >
              <Text style={{ color: '#ffffff', fontWeight: '700' }}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
