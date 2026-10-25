import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';

export interface DateItem {
  dateObj: Date;
  apiFormat: string; // "DD-MM-YYYY"
  displayFormat: string; // "25 Oct 2026, Sun"
  dayName: string; // "Sun"
  dayNum: string; // "25"
  monthName: string; // "Oct"
  isToday: boolean;
  isTomorrow: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDateToApi(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDateForDisplay(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const day = FULL_DAYS[date.getDay()];
  return `${d}/${m}/${y} (${day})`;
}

interface DatePickerModalProps {
  visible: boolean;
  selectedApiDate: string; // "DD-MM-YYYY"
  onSelect: (dateItem: DateItem) => void;
  onClose: () => void;
}

export const DatePickerModal: React.FC<DatePickerModalProps> = ({
  visible,
  selectedApiDate,
  onSelect,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  // Generate 60 days of travel dates starting from today
  const availableDates: DateItem[] = useMemo(() => {
    const list: DateItem[] = [];
    const now = new Date();

    for (let i = 0; i < 60; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const apiFormat = formatDateToApi(d);
      const displayFormat = formatDateForDisplay(d);

      list.push({
        dateObj: d,
        apiFormat,
        displayFormat,
        dayName: DAYS[d.getDay()],
        dayNum: String(d.getDate()),
        monthName: MONTHS[d.getMonth()],
        isToday: i === 0,
        isTomorrow: i === 1,
      });
    }

    return list;
  }, []);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.dragHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Select Journey Date</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Select: Today / Tomorrow */}
          <View style={styles.quickRow}>
            {availableDates.slice(0, 2).map((item) => (
              <TouchableOpacity
                key={item.apiFormat}
                style={[
                  styles.quickChip,
                  selectedApiDate === item.apiFormat && styles.quickChipSelected,
                ]}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <Text
                  style={[
                    styles.quickChipText,
                    selectedApiDate === item.apiFormat && styles.quickChipTextSelected,
                  ]}
                >
                  {item.isToday ? 'Today' : 'Tomorrow'} ({item.dayNum} {item.monthName})
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Days Grid List */}
          <FlatList
            data={availableDates}
            keyExtractor={(item) => item.apiFormat}
            numColumns={4}
            contentContainerStyle={styles.gridContent}
            renderItem={({ item }) => {
              const isSelected = item.apiFormat === selectedApiDate;

              return (
                <TouchableOpacity
                  style={[styles.dateCell, isSelected && styles.dateCellSelected]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayName, isSelected && styles.textSelected]}>
                    {item.dayName}
                  </Text>
                  <Text style={[styles.dayNum, isSelected && styles.textSelected]}>
                    {item.dayNum}
                  </Text>
                  <Text style={[styles.monthName, isSelected && styles.textSelected]}>
                    {item.monthName}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxHeight: '80%',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  doneText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.md,
  },
  quickChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  quickChipSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  quickChipTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  gridContent: {
    paddingBottom: spacing.lg,
  },
  dateCell: {
    flex: 1 / 4,
    aspectRatio: 1,
    margin: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.pillBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCellSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayName: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  dayNum: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    marginVertical: 2,
  },
  monthName: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  textSelected: {
    color: '#FFFFFF',
  },
});
