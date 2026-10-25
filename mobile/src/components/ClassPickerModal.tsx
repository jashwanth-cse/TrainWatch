import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';
import { Check } from 'lucide-react-native';

export interface ClassOption {
  code: string;
  label: string;
  description: string;
}

export const CLASS_OPTIONS: ClassOption[] = [
  { code: 'All Classes', label: 'All Classes', description: 'Show berths across all train coaches' },
  { code: '1A', label: '1A - AC First Class', description: 'Air-conditioned luxury private cabin' },
  { code: '2A', label: '2A - AC 2 Tier', description: 'Air-conditioned 2-tier berth with curtains' },
  { code: '3A', label: '3A - AC 3 Tier', description: 'Air-conditioned 3-tier sleeper' },
  { code: '3E', label: '3E - AC 3 Economy', description: 'Economy 3-tier air-conditioned berth' },
  { code: 'CC', label: 'CC - AC Chair Car', description: 'Air-conditioned seating for day journeys' },
  { code: 'SL', label: 'SL - Sleeper Class', description: 'Non-AC standard 3-tier sleeper' },
  { code: '2S', label: '2S - Second Seating', description: 'Non-AC reserved seating' },
];

interface ClassPickerModalProps {
  visible: boolean;
  selectedClass: string;
  onSelect: (option: ClassOption) => void;
  onClose: () => void;
}

export const ClassPickerModal: React.FC<ClassPickerModalProps> = ({
  visible,
  selectedClass,
  onSelect,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.dragHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Select Travel Class</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {CLASS_OPTIONS.map((item) => {
              const isSelected =
                item.code === selectedClass ||
                (item.code === 'All Classes' && (selectedClass === 'All Classes' || !selectedClass));

              return (
                <TouchableOpacity
                  key={item.code}
                  style={[styles.itemRow, isSelected && styles.itemRowSelected]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemLabel, isSelected && styles.itemLabelSelected]}>
                      {item.label}
                    </Text>
                    <Text style={styles.itemDesc}>{item.description}</Text>
                  </View>
                  {isSelected && <Check size={18} color={colors.primary} strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
  list: {
    marginVertical: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 6,
  },
  itemRowSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: 'rgba(43, 102, 246, 0.25)',
  },
  itemInfo: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  itemLabelSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  itemDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  checkmark: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
    marginLeft: spacing.sm,
  },
});
