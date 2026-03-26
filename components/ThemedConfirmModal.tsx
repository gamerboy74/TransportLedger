import { Modal, Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Theme } from '../constants/theme';

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
  const confirmBg = destructive ? Theme.colors.light.error : Theme.colors.light.primary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.modalContainer}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} style={[styles.confirmButton, { backgroundColor: confirmBg }]}>
              <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  modalContainer: {
    backgroundColor: Theme.colors.light.background,
    borderColor: Theme.colors.light.border,
    borderWidth: 1,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.lg,
    ...Theme.shadows.medium,
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
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.lg,
  },
  cancelButton: {
    backgroundColor: Theme.colors.light.disabled,
    borderRadius: Theme.borderRadius.sm,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
  },
  cancelButtonText: {
    color: Theme.colors.light.text,
    fontWeight: Theme.typography.weights.bold,
  },
  confirmButton: {
    borderRadius: Theme.borderRadius.sm,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
  },
  confirmButtonText: {
    color: '#ffffff',
    fontWeight: Theme.typography.weights.bold,
  },
});
