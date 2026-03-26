import { useMemo, useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Calendar, type DateData } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
};

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function isValidDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default function ThemedDateField({ label, value, onChange, required }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(isValidDateKey(value) ? value : todayKey());

  const selected = isValidDateKey(value) ? value : todayKey();

  const markedDates = useMemo(
    () => ({
      [draft]: {
        selected: true,
        selectedColor: Theme.colors.light.primary,
        selectedTextColor: '#ffffff',
      },
    }),
    [draft]
  );

  const openPicker = () => {
    setDraft(selected);
    setOpen(true);
  };

  const applyToday = () => setDraft(todayKey());

  const applyDone = () => {
    onChange(draft);
    setOpen(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}{required ? ' *' : ''}
      </Text>

      <TouchableOpacity onPress={openPicker} style={styles.inputContainer}>
        <Text style={styles.inputText}>{selected}</Text>
        <Ionicons name="calendar-outline" size={16} color={Theme.colors.light.secondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modalContainer}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Pick Date</Text>
              <TouchableOpacity onPress={applyToday}>
                <Text style={styles.todayText}>Today</Text>
              </TouchableOpacity>
            </View>

            <Calendar
              current={draft}
              onDayPress={(day: DateData) => setDraft(day.dateString)}
              markedDates={markedDates}
              theme={{
                backgroundColor: Theme.colors.light.background,
                calendarBackground: Theme.colors.light.background,
                textSectionTitleColor: Theme.colors.light.secondary,
                dayTextColor: Theme.colors.light.text,
                todayTextColor: Theme.colors.light.primary,
                monthTextColor: Theme.colors.light.text,
                arrowColor: Theme.colors.light.primary,
                textMonthFontWeight: Theme.typography.weights.bold,
                textDayFontWeight: Theme.typography.weights.medium,
                textDayHeaderFontWeight: Theme.typography.weights.bold,
              }}
              style={styles.calendar}
            />

            <View style={styles.footer}>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applyDone} style={styles.doneButton}>
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Theme.spacing.lg,
  },
  label: {
    color: Theme.colors.light.subtext,
    fontSize: Theme.typography.sizes.caption,
    fontWeight: Theme.typography.weights.bold,
    marginBottom: Theme.spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  inputContainer: {
    backgroundColor: Theme.colors.light.white,
    borderWidth: 1,
    borderColor: Theme.colors.light.border,
    borderRadius: Theme.borderRadius.md,
    paddingHorizontal: Theme.spacing.md,
    height: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputText: {
    color: Theme.colors.light.text,
    fontSize: Theme.typography.sizes.body,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  modalContainer: {
    backgroundColor: Theme.colors.light.background,
    borderRadius: Theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: Theme.colors.light.border,
    overflow: 'hidden',
    ...Theme.shadows.medium,
  },
  header: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: Theme.colors.light.text,
    fontSize: Theme.typography.sizes.subheading,
    fontWeight: Theme.typography.weights.bold,
  },
  todayText: {
    color: Theme.colors.light.primary,
    fontWeight: Theme.typography.weights.bold,
  },
  calendar: {
    borderTopWidth: 1,
    borderTopColor: Theme.colors.light.border,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.light.border,
  },
  footer: {
    padding: Theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Theme.spacing.sm,
  },
  cancelButton: {
    backgroundColor: Theme.colors.light.disabled,
    borderRadius: Theme.borderRadius.sm,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  cancelButtonText: {
    color: Theme.colors.light.text,
    fontWeight: Theme.typography.weights.bold,
  },
  doneButton: {
    backgroundColor: Theme.colors.light.primary,
    borderRadius: Theme.borderRadius.sm,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  doneButtonText: {
    color: Theme.colors.light.white,
    fontWeight: Theme.typography.weights.bold,
  },
});
