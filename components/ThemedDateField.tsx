import { useMemo, useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Calendar, type DateData } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';

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
        selectedColor: '#d9468f',
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
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: '#6b5c67', fontSize: 11, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}{required ? ' *' : ''}
      </Text>

      <TouchableOpacity
        onPress={openPicker}
        style={{
          backgroundColor: '#ffffff',
          borderWidth: 1,
          borderColor: '#f2d7e6',
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 12,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#111111' }}>{selected}</Text>
        <Ionicons name="calendar-outline" size={16} color="#6b5c67" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#00000055', justifyContent: 'center', padding: 16 }} onPress={() => setOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: '#ffffffee', borderRadius: 18, borderWidth: 1, borderColor: '#f2d7e6', overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: '#111111', fontSize: 16, fontWeight: '800' }}>Pick Date</Text>
              <TouchableOpacity onPress={applyToday}>
                <Text style={{ color: '#db2777', fontWeight: '700' }}>Today</Text>
              </TouchableOpacity>
            </View>

            <Calendar
              current={draft}
              onDayPress={(day: DateData) => setDraft(day.dateString)}
              markedDates={markedDates}
              theme={{
                backgroundColor: '#ffffff',
                calendarBackground: '#ffffff',
                textSectionTitleColor: '#6b5c67',
                dayTextColor: '#111111',
                todayTextColor: '#db2777',
                monthTextColor: '#111111',
                arrowColor: '#db2777',
                textMonthFontWeight: '700',
                textDayFontWeight: '500',
                textDayHeaderFontWeight: '700',
              }}
              style={{ borderTopWidth: 1, borderTopColor: '#f2d7e6', borderBottomWidth: 1, borderBottomColor: '#f2d7e6' }}
            />

            <View style={{ padding: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ backgroundColor: '#fce7f3', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Text style={{ color: '#111111', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applyDone} style={{ backgroundColor: '#d9468f', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Text style={{ color: '#ffffff', fontWeight: '700' }}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
