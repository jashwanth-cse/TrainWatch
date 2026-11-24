import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

export interface DateItem {
  dateObj: Date;
  apiFormat: string; // "DD-MM-YYYY"
  displayFormat: string; // "25/10/2026 (Sunday)"
  dayName: string; // "Sun"
  dayNum: string; // "25"
  monthName: string; // "Oct"
  isToday: boolean;
  isTomorrow: boolean;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDateToApi(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

export function formatDateForDisplay(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const day = FULL_DAYS[date.getDay()];
  return `${d}/${m}/${y} (${day})`;
}

export function parseApiDate(str: string | null | undefined): Date {
  if (!str) return new Date();
  const parts = str.trim().split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    // DD-MM-YYYY
    return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  }
  return new Date();
}

interface DatePickerModalProps {
  visible: boolean;
  selectedApiDate: string; // "DD-MM-YYYY"
  onSelect: (dateItem: DateItem) => void;
  onClose: () => void;
  halfScreen?: boolean;
}

export const DatePickerModal: React.FC<DatePickerModalProps> = ({
  visible,
  selectedApiDate,
  onSelect,
  onClose,
  halfScreen = false,
}) => {
  const insets = useSafeAreaInsets();

  const [prevSelectedApiDate, setPrevSelectedApiDate] = useState(selectedApiDate);
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => parseApiDate(selectedApiDate));

  if (selectedApiDate !== prevSelectedApiDate) {
    setPrevSelectedApiDate(selectedApiDate);
    setCurrentMonthDate(parseApiDate(selectedApiDate));
  }

  // Base dates without time component
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const maxDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 120);

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  const canGoPrev =
    year > today.getFullYear() ||
    (year === today.getFullYear() && month > today.getMonth());

  const canGoNext =
    year < maxDate.getFullYear() ||
    (year === maxDate.getFullYear() && month < maxDate.getMonth());

  const handlePrevMonth = () => {
    if (!canGoPrev) return;
    setCurrentMonthDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    if (!canGoNext) return;
    setCurrentMonthDate(new Date(year, month + 1, 1));
  };

  const handleSelectDate = (cellDate: Date) => {
    const isPast = cellDate < today;
    const isBeyondMax = cellDate > maxDate;
    if (isPast || isBeyondMax) return;

    const isToday = cellDate.getTime() === today.getTime();
    const isTomorrow = cellDate.getTime() === tomorrow.getTime();

    const dateItem: DateItem = {
      dateObj: cellDate,
      apiFormat: formatDateToApi(cellDate),
      displayFormat: formatDateForDisplay(cellDate),
      dayName: DAYS_SHORT[cellDate.getDay()],
      dayNum: String(cellDate.getDate()),
      monthName: MONTHS_SHORT[cellDate.getMonth()],
      isToday,
      isTomorrow,
    };
    onSelect(dateItem);
    onClose();
  };

  // Monthly calendar grid construction
  const calendarDays = useMemo(() => {
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { day: number | null; date: Date | null }[] = [];

    // Leading blanks for proper weekday alignment
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push({ day: null, date: null });
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, date: new Date(year, month, d) });
    }

    return cells;
  }, [year, month]);

  const todayItem: DateItem = {
    dateObj: today,
    apiFormat: formatDateToApi(today),
    displayFormat: formatDateForDisplay(today),
    dayName: DAYS_SHORT[today.getDay()],
    dayNum: String(today.getDate()),
    monthName: MONTHS_SHORT[today.getMonth()],
    isToday: true,
    isTomorrow: false,
  };

  const tomorrowItem: DateItem = {
    dateObj: tomorrow,
    apiFormat: formatDateToApi(tomorrow),
    displayFormat: formatDateForDisplay(tomorrow),
    dayName: DAYS_SHORT[tomorrow.getDay()],
    dayNum: String(tomorrow.getDate()),
    monthName: MONTHS_SHORT[tomorrow.getMonth()],
    isToday: false,
    isTomorrow: true,
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            halfScreen && styles.halfSheet,
            { paddingBottom: Math.max(insets.bottom, 20) },
          ]}
        >
          <View style={styles.dragHandle} />

          {/* Modal Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Select Journey Date</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <X size={20} color={colors.textSecondary} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Quick Select: Today / Tomorrow */}
          <View style={styles.quickRow}>
            <TouchableOpacity
              style={[
                styles.quickChip,
                selectedApiDate === todayItem.apiFormat && styles.quickChipSelected,
              ]}
              onPress={() => {
                onSelect(todayItem);
                onClose();
              }}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.quickChipText,
                  selectedApiDate === todayItem.apiFormat && styles.quickChipTextSelected,
                ]}
              >
                Today ({todayItem.dayNum} {todayItem.monthName})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.quickChip,
                selectedApiDate === tomorrowItem.apiFormat && styles.quickChipSelected,
              ]}
              onPress={() => {
                onSelect(tomorrowItem);
                onClose();
              }}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.quickChipText,
                  selectedApiDate === tomorrowItem.apiFormat && styles.quickChipTextSelected,
                ]}
              >
                Tomorrow ({tomorrowItem.dayNum} {tomorrowItem.monthName})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Standard Monthly Calendar Container */}
          <View style={styles.calendarContainer}>
            {/* Month Navigation Bar */}
            <View style={styles.monthNavRow}>
              <TouchableOpacity
                onPress={handlePrevMonth}
                disabled={!canGoPrev}
                style={[styles.navArrowBtn, !canGoPrev && styles.navArrowBtnDisabled]}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ChevronLeft
                  size={20}
                  color={canGoPrev ? colors.textPrimary : '#CBD5E1'}
                  strokeWidth={2.4}
                />
              </TouchableOpacity>

              <Text style={styles.monthTitleText}>
                {MONTHS_FULL[month]} {year}
              </Text>

              <TouchableOpacity
                onPress={handleNextMonth}
                disabled={!canGoNext}
                style={[styles.navArrowBtn, !canGoNext && styles.navArrowBtnDisabled]}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ChevronRight
                  size={20}
                  color={canGoNext ? colors.textPrimary : '#CBD5E1'}
                  strokeWidth={2.4}
                />
              </TouchableOpacity>
            </View>

            {/* Weekdays Header */}
            <View style={styles.weekdaysRow}>
              {DAYS_SHORT.map((dayName, idx) => (
                <View key={dayName} style={styles.weekdayCell}>
                  <Text
                    style={[
                      styles.weekdayText,
                      idx === 0 && styles.sundayText,
                    ]}
                  >
                    {dayName}
                  </Text>
                </View>
              ))}
            </View>

            {/* Monthly Calendar 7-Column Grid */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.calendarGridScroll}
            >
              <View style={styles.gridDaysWrapper}>
                {calendarDays.map((cell, idx) => {
                  if (cell.day === null || cell.date === null) {
                    return <View key={`blank-${idx}`} style={styles.calendarDayCell} />;
                  }

                  const cellApiFormat = formatDateToApi(cell.date);
                  const isSelected = cellApiFormat === selectedApiDate;
                  const isPast = cell.date < today;
                  const isBeyondMax = cell.date > maxDate;
                  const isDisabled = isPast || isBeyondMax;
                  const isCurrentDay = cell.date.getTime() === today.getTime();

                  return (
                    <TouchableOpacity
                      key={cellApiFormat}
                      disabled={isDisabled}
                      onPress={() => handleSelectDate(cell.date!)}
                      style={[
                        styles.calendarDayCell,
                        isSelected && styles.calendarDayCellSelected,
                        isCurrentDay && !isSelected && styles.calendarDayCellToday,
                      ]}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.dayNumText,
                          isDisabled && styles.dayNumTextDisabled,
                          isCurrentDay && !isSelected && styles.dayNumTextToday,
                          isSelected && styles.dayNumTextSelected,
                        ]}
                      >
                        {cell.day}
                      </Text>
                      {isCurrentDay && !isSelected && <View style={styles.todayIndicatorDot} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
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
    maxHeight: '85%',
  },
  halfSheet: {
    maxHeight: '62%',
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
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.sm,
  },
  quickChip: {
    flex: 1,
    paddingVertical: 8,
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
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  quickChipTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  calendarContainer: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  monthNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  monthTitleText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.brandNavy,
    letterSpacing: -0.2,
  },
  navArrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  navArrowBtnDisabled: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  weekdaysRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    marginBottom: 4,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  sundayText: {
    color: '#EF4444',
  },
  calendarGridScroll: {
    paddingBottom: 4,
  },
  gridDaysWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
    position: 'relative',
  },
  calendarDayCellSelected: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  calendarDayCellToday: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  dayNumText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dayNumTextDisabled: {
    color: '#CBD5E1',
    fontWeight: '400',
  },
  dayNumTextToday: {
    color: colors.primary,
    fontWeight: '800',
  },
  dayNumTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  todayIndicatorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
    position: 'absolute',
    bottom: 2,
  },
});
