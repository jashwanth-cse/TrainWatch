import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';
import {
  TrainItem,
  TravelClassInfo,
  fetchLiveAvailability,
} from '../services/trainService';
import { watchService } from '../services/watchService';
import {
  TrainFront,
  ArrowRight,
  Bell,
  RefreshCw,
  CalendarDays,
  CheckCircle2,
  X,
  AlertCircle,
} from 'lucide-react-native';
import { parseAvailabilityStatus } from '../utils/availabilityHelper';

interface AvailabilityDetailModalProps {
  visible: boolean;
  train: TrainItem | null;
  selectedClass: TravelClassInfo | null;
  journeyDate: string;
  displayDate: string;
  quota: string;
  onClose: () => void;
  onSetAlert?: (train: TrainItem, travelClass: TravelClassInfo) => void;
}

export const AvailabilityDetailModal: React.FC<AvailabilityDetailModalProps> = ({
  visible,
  train,
  selectedClass,
  journeyDate,
  displayDate,
  quota,
  onClose,
  onSetAlert,
}) => {
  const insets = useSafeAreaInsets();
  const [checkingLive, setCheckingLive] = useState(false);
  const [liveAvailability, setLiveAvailability] = useState<string | null>(null);
  const [liveSuccess, setLiveSuccess] = useState<string | null>(null);
  const [alertConfigured, setAlertConfigured] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);

  if (!train || !selectedClass) return null;

  const currentStatus = liveAvailability || selectedClass.availability;
  const parsedStatus = parseAvailabilityStatus(currentStatus);

  const badge = {
    bg: parsedStatus.bgColor,
    text: parsedStatus.textColor,
    dot: parsedStatus.dotColor,
    label: parsedStatus.modalLabel,
  };

  const handleCheckLive = async () => {
    setCheckingLive(true);
    setLiveSuccess(null);
    try {
      const res = await fetchLiveAvailability({
        trainNo: train.train_number,
        source: train.from.code,
        destination: train.to.code,
        travelClass: selectedClass.travel_class,
        date: journeyDate,
        quota,
      });

      if (res.success && res.data.availability) {
        setLiveAvailability(res.data.availability);
        setLiveSuccess('Live availability refreshed just now');
      }
    } catch {
      // Fallback: keep existing availability
    } finally {
      setCheckingLive(false);
    }
  };

  const handleCreateAlert = async () => {
    setCreatingAlert(true);
    setAlertError(null);
    try {
      await watchService.createWatch({
        trainNumber: train.train_number,
        source: train.from.code,
        destination: train.to.code,
        journeyDate,
        travelClass: selectedClass.travel_class,
        quota,
        condition: { kind: 'becomes_available' },
      });
      setAlertConfigured(true);
      if (onSetAlert) {
        onSetAlert(train, selectedClass);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to track seat';
      setAlertError(msg);
    } finally {
      setCreatingAlert(false);
    }
  };

  const handleModalClose = () => {
    setLiveAvailability(null);
    setLiveSuccess(null);
    setAlertConfigured(false);
    setAlertError(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleModalClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleModalClose} />

        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          {/* Top Drag Indicator */}
          <View style={styles.dragHandle} />

          {/* Modal Header */}
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Seat Availability</Text>
              <Text style={styles.sheetSubtitle}>
                {selectedClass.travel_class} • {quota} Quota
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleModalClose}
              style={styles.closeBtn}
              delayPressIn={0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <X size={20} color={colors.textSecondary} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Train Card Summary */}
          <View style={styles.summaryCard}>
            <View style={styles.trainInfoRow}>
              <View style={styles.trainNumberBadge}>
                <TrainFront size={14} color={colors.primary} strokeWidth={2.4} style={{ marginRight: 5 }} />
                <Text style={styles.trainNumberText}>{train.train_number}</Text>
              </View>
              <Text style={styles.trainNameText} numberOfLines={1}>
                {train.train_name}
              </Text>
            </View>

            {/* Route & Times */}
            <View style={styles.routeRow}>
              <View style={styles.timeBlock}>
                <Text style={styles.stationCode}>{train.from.code}</Text>
                <Text style={styles.timeValue}>{train.departure_time}</Text>
              </View>

              <View style={styles.durationBlock}>
                <Text style={styles.durationText}>{train.duration} hrs</Text>
                <View style={styles.durationLine}>
                  <View style={styles.lineDot} />
                  <View style={styles.lineDash} />
                  <View style={styles.lineDot} />
                </View>
              </View>

              <View style={[styles.timeBlock, { alignItems: 'flex-end' }]}>
                <Text style={styles.stationCode}>{train.to.code}</Text>
                <Text style={styles.timeValue}>{train.arrival_time}</Text>
              </View>
            </View>

            {/* Journey Date & Fare Details */}
            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <CalendarDays size={13} color={colors.textSecondary} strokeWidth={2.2} style={{ marginRight: 5 }} />
                <Text style={styles.metaText}>{displayDate}</Text>
              </View>
              {selectedClass.fare > 0 && (
                <View style={styles.metaItem}>
                  <Text style={styles.fareLabel}>Fare: </Text>
                  <Text style={styles.fareValue}>₹{selectedClass.fare}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Status Display Card */}
          <View style={[styles.statusCard, { backgroundColor: badge.bg, borderColor: badge.dot + '40' }]}>
            <View style={styles.statusHeaderRow}>
              <View style={[styles.statusIndicatorDot, { backgroundColor: badge.dot }]} />
              <Text style={[styles.statusBadgeText, { color: badge.text }]}>
                {badge.label}
              </Text>
            </View>
            <Text style={[styles.availabilityBigText, { color: badge.text }]}>
              {currentStatus}
            </Text>
            {liveSuccess ? (
              <Text style={styles.liveSuccessText}>{liveSuccess}</Text>
            ) : null}

            {/* Check Live Button */}
            <TouchableOpacity
              style={styles.refreshLiveBtn}
              onPress={handleCheckLive}
              disabled={checkingLive}
              delayPressIn={0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.8}
            >
              {checkingLive ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <RefreshCw size={13} color={colors.primary} strokeWidth={2.4} style={{ marginRight: 6 }} />
                  <Text style={styles.refreshLiveText}>Refresh Live Status</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Alert Configuration Option */}
          <View style={styles.alertOptionBox}>
            <View style={styles.alertHeader}>
              <View style={styles.alertIconCircle}>
                <Bell size={17} color={colors.primary} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.alertTitle}>TrainWatch Seat Alert</Text>
                <Text style={styles.alertSubtitle}>
                  Get immediate push alerts on your phone whenever seats confirm or waitlist clears.
                </Text>
              </View>
            </View>

            {alertError ? (
              <Text style={{ fontSize: 13, color: colors.error, marginBottom: 8, fontWeight: '500' }}>
                {alertError}
              </Text>
            ) : null}

            {!parsedStatus.canTrack ? (
              <View style={styles.alertDisabledBox}>
                <AlertCircle size={16} color={colors.textSecondary} strokeWidth={2.2} style={{ marginRight: 8 }} />
                <Text style={styles.alertDisabledText}>
                  {parsedStatus.untrackableReason || 'Tracking unavailable for this seat status.'}
                </Text>
              </View>
            ) : alertConfigured ? (
              <View style={styles.alertActiveRow}>
                <CheckCircle2 size={18} color={colors.statusAvailable} strokeWidth={2.4} style={{ marginRight: 8 }} />
                <Text style={styles.alertActiveText}>
                  Alert active! We are monitoring this berth for you.
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.setAlertBtn}
                onPress={handleCreateAlert}
                disabled={creatingAlert}
                delayPressIn={0}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.88}
              >
                {creatingAlert ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.setAlertBtnText}>Track This Seat</Text>
                    <ArrowRight size={17} color="#FFFFFF" strokeWidth={2.4} style={{ marginLeft: 6 }} />
                  </>
                )}
              </TouchableOpacity>
            )}
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
    maxHeight: '88%',
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  sheetSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1.2,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  trainInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  trainNumberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginRight: 8,
  },
  trainNumberText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  trainNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  timeBlock: {
    minWidth: 64,
  },
  stationCode: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  timeValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 1,
  },
  durationBlock: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 3,
  },
  durationLine: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  lineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  lineDash: {
    flex: 1,
    height: 1.5,
    backgroundColor: colors.borderStrong,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
    paddingTop: spacing.xs,
    marginTop: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  fareLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  fareValue: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  statusCard: {
    borderRadius: radius.lg,
    borderWidth: 1.2,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  availabilityBigText: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginVertical: 4,
  },
  liveSuccessText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.statusAvailable,
    marginBottom: 8,
  },
  refreshLiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,
    marginTop: 4,
  },
  refreshLiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  alertOptionBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1.2,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  alertIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  alertSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: 2,
  },
  setAlertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: 6,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  setAlertBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  alertActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.statusAvailableBg,
    borderWidth: 1,
    borderColor: colors.statusAvailable + '40',
    padding: 10,
    borderRadius: radius.md,
    marginTop: 4,
  },
  alertActiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.statusAvailable,
    flex: 1,
  },
  alertDisabledBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 12,
    borderRadius: radius.md,
    marginTop: 4,
  },
  alertDisabledText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 17,
  },
});
