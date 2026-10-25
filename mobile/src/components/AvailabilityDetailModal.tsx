import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../theme/tokens';
import {
  TrainItem,
  TravelClassInfo,
  fetchLiveAvailability,
} from '../services/trainService';
import { watchService, WatchCondition } from '../services/watchService';
import { requestNotificationPermissionsAndRegisterDevice } from '../services/notificationService';
import {
  TrainFront,
  ArrowRight,
  Bell,
  RefreshCw,
  CalendarDays,
  CheckCircle2,
  X,
  AlertCircle,
  TrendingUp,
  Check,
} from 'lucide-react-native';
import { parseAvailabilityStatus } from '../utils/availabilityHelper';

export function extractAvailableSeats(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/(?:AVAILABLE|AVBL|AVL|CURR_AVBL)[^\d]*(\d+)/i) || raw.match(/(\d+)/);
  if (match) {
    const val = parseInt(match[1], 10);
    return isNaN(val) ? null : val;
  }
  return null;
}

interface AvailabilityDetailModalProps {
  visible: boolean;
  train: TrainItem | null;
  selectedClass: TravelClassInfo | null;
  journeyDate: string;
  displayDate: string;
  quota: string;
  isAlreadyTracked?: boolean;
  onClose: () => void;
  onSetAlert?: (train: TrainItem, travelClass: TravelClassInfo) => void;
  onViewAlerts?: () => void;
}

export const AvailabilityDetailModal: React.FC<AvailabilityDetailModalProps> = ({
  visible,
  train,
  selectedClass,
  journeyDate,
  displayDate,
  quota,
  isAlreadyTracked = false,
  onClose,
  onSetAlert,
  onViewAlerts,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [checkingLive, setCheckingLive] = useState(false);
  const [liveAvailability, setLiveAvailability] = useState<string | null>(null);
  const [liveSuccess, setLiveSuccess] = useState<string | null>(null);
  const [alertConfigured, setAlertConfigured] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);

  // Alert condition form states
  const [avlThreshold, setAvlThreshold] = useState<string>('25');
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [racOption, setRacOption] = useState<'drop_to_avl' | 'rapid_increase'>('drop_to_avl');
  const [wlOption, setWlOption] = useState<'drop_to_rac' | 'drop_to_avl' | 'improves'>('drop_to_rac');

  // Sync initial threshold with available count when class changes
  useEffect(() => {
    if (selectedClass) {
      const seats = extractAvailableSeats(selectedClass.availability);
      if (seats && seats > 0) {
        const defaultVal = Math.min(25, Math.max(1, Math.floor(seats / 2)));
        setAvlThreshold(String(defaultVal));
      } else {
        setAvlThreshold('25');
      }
      setThresholdError(null);
      setAlertError(null);
    }
  }, [selectedClass]);

  if (!train || !selectedClass) return null;

  const currentStatus = liveAvailability || selectedClass.availability;
  const parsedStatus = parseAvailabilityStatus(currentStatus);
  const availableSeatsCap = extractAvailableSeats(currentStatus);

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
        const refreshedSeats = extractAvailableSeats(res.data.availability);
        if (refreshedSeats && refreshedSeats > 0) {
          const currentNum = parseInt(avlThreshold, 10);
          if (isNaN(currentNum) || currentNum > refreshedSeats) {
            setAvlThreshold(String(Math.min(25, refreshedSeats)));
          }
        }
      }
    } catch {
      // Fallback: keep existing availability
    } finally {
      setCheckingLive(false);
    }
  };

  const handleThresholdChange = (val: string) => {
    // Only accept numbers
    const clean = val.replace(/[^0-9]/g, '');
    setAvlThreshold(clean);
    if (!clean) {
      setThresholdError('Enter a threshold number greater than 0');
      return;
    }
    const num = parseInt(clean, 10);
    if (num <= 0) {
      setThresholdError('Threshold must be greater than 0');
      return;
    }
    if (availableSeatsCap !== null && num > availableSeatsCap) {
      setThresholdError(`Cannot exceed current available seats (${availableSeatsCap})`);
      return;
    }
    setThresholdError(null);
  };

  const handleSelectPresetChip = (preset: number) => {
    if (availableSeatsCap !== null && preset > availableSeatsCap) return;
    setAvlThreshold(String(preset));
    setThresholdError(null);
  };

  const handleCreateAlert = async () => {
    setAlertError(null);

    let condition: WatchCondition;
    if (parsedStatus.badgeLabel === 'AVAILABLE') {
      const num = parseInt(avlThreshold, 10);
      if (isNaN(num) || num <= 0) {
        setThresholdError('Enter a threshold number greater than 0');
        return;
      }
      if (availableSeatsCap !== null && num > availableSeatsCap) {
        setThresholdError(`Cannot exceed current available seats (${availableSeatsCap})`);
        return;
      }
      condition = {
        kind: 'seats_below',
        maximum_position: num,
      };
    } else if (parsedStatus.badgeLabel === 'RAC') {
      if (racOption === 'drop_to_avl') {
        condition = { kind: 'becomes_available' };
      } else {
        condition = { kind: 'rapid_rac_increase' };
      }
    } else if (parsedStatus.badgeLabel === 'WAITLIST') {
      if (wlOption === 'drop_to_rac') {
        condition = { kind: 'improves', target_status: 'RAC' };
      } else if (wlOption === 'drop_to_avl') {
        condition = { kind: 'becomes_available' };
      } else {
        condition = { kind: 'improves' };
      }
    } else {
      condition = { kind: 'becomes_available' };
    }

    setCreatingAlert(true);
    try {
      // Ensure notification permissions are requested and device token is registered with backend
      await requestNotificationPermissionsAndRegisterDevice();

      await watchService.createWatch({
        trainNumber: train.train_number,
        source: train.from.code,
        destination: train.to.code,
        journeyDate,
        travelClass: selectedClass.travel_class,
        quota,
        condition,
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

  const handleNavigateToAlerts = () => {
    handleModalClose();
    if (onViewAlerts) {
      onViewAlerts();
    } else {
      router.push('/alerts');
    }
  };

  const handleModalClose = () => {
    setLiveAvailability(null);
    setLiveSuccess(null);
    setAlertConfigured(false);
    setAlertError(null);
    setThresholdError(null);
    onClose();
  };

  const isAlreadyActive = isAlreadyTracked || alertConfigured;

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

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
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
                    Get real-time push alerts directly to your phone when availability matches your condition.
                  </Text>
                </View>
              </View>

              {alertError ? (
                <Text style={styles.errorText}>{alertError}</Text>
              ) : null}

              {!parsedStatus.canTrack ? (
                <View style={styles.alertDisabledBox}>
                  <AlertCircle size={16} color={colors.textSecondary} strokeWidth={2.2} style={{ marginRight: 8 }} />
                  <Text style={styles.alertDisabledText}>
                    {parsedStatus.untrackableReason || 'Tracking unavailable for this seat status.'}
                  </Text>
                </View>
              ) : isAlreadyActive ? (
                /* Once alert is set, do not show track button again */
                <View style={styles.alertAlreadyActiveCard}>
                  <View style={styles.alertActiveRow}>
                    <CheckCircle2 size={18} color={colors.statusAvailable} strokeWidth={2.4} style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertActiveTitle}>Alert Active</Text>
                      <Text style={styles.alertActiveSubtext}>
                        We are currently monitoring this train and class in the background.
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.manageAlertsBtn}
                    onPress={handleNavigateToAlerts}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.manageAlertsText}>View in My Alerts</Text>
                    <ArrowRight size={15} color={colors.primary} strokeWidth={2.4} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.conditionContainer}>
                  {/* CASE 1: AVAILABLE STATUS (Lock AVL < and user specifies threshold with max_cap) */}
                  {parsedStatus.badgeLabel === 'AVAILABLE' && (
                    <View style={styles.conditionSection}>
                      <Text style={styles.conditionSectionTitle}>Alert Condition</Text>
                      <Text style={styles.conditionSectionDesc}>
                        Alert me when available seats drop below your threshold:
                      </Text>

                      {/* Locked Prefix + Numeric Input */}
                      <View style={[styles.inputRow, thresholdError ? styles.inputRowError : null]}>
                        <View style={styles.lockPrefixBadge}>
                          <Text style={styles.lockPrefixText}>AVL &lt;</Text>
                        </View>
                        <TextInput
                          style={styles.numericInput}
                          value={avlThreshold}
                          onChangeText={handleThresholdChange}
                          keyboardType="number-pad"
                          placeholder="25"
                          placeholderTextColor={colors.textMuted}
                          maxLength={4}
                        />
                        <Text style={styles.seatsSuffixText}>seats</Text>
                      </View>

                      {thresholdError ? (
                        <Text style={styles.fieldErrorText}>{thresholdError}</Text>
                      ) : availableSeatsCap !== null ? (
                        <Text style={styles.helperText}>
                          Current available: {availableSeatsCap} seats (maximum limit: {availableSeatsCap})
                        </Text>
                      ) : null}

                      {/* Preset Chips */}
                      <View style={styles.presetChipsRow}>
                        {[10, 25, 50, 100].map((preset) => {
                          const disabled = availableSeatsCap !== null && preset > availableSeatsCap;
                          const isSelected = avlThreshold === String(preset);
                          return (
                            <TouchableOpacity
                              key={preset}
                              style={[
                                styles.presetChip,
                                isSelected && styles.presetChipSelected,
                                disabled && styles.presetChipDisabled,
                              ]}
                              onPress={() => !disabled && handleSelectPresetChip(preset)}
                              disabled={disabled}
                              activeOpacity={0.7}
                            >
                              <Text
                                style={[
                                  styles.presetChipText,
                                  isSelected && styles.presetChipTextSelected,
                                  disabled && styles.presetChipTextDisabled,
                                ]}
                              >
                                &lt; {preset}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* CASE 2: RAC STATUS (RAC drops to AVL or RAC increases rapidly) */}
                  {parsedStatus.badgeLabel === 'RAC' && (
                    <View style={styles.conditionSection}>
                      <Text style={styles.conditionSectionTitle}>Select Alert Condition</Text>
                      <Text style={styles.conditionSectionDesc}>
                        Choose how TrainWatch should monitor this RAC berth:
                      </Text>

                      {/* Option A: RAC drops to AVL */}
                      <TouchableOpacity
                        style={[
                          styles.optionCard,
                          racOption === 'drop_to_avl' && styles.optionCardSelected,
                        ]}
                        onPress={() => setRacOption('drop_to_avl')}
                        activeOpacity={0.8}
                      >
                        <View style={styles.optionRadio}>
                          {racOption === 'drop_to_avl' && <View style={styles.optionRadioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>Notify when RAC drops to AVL</Text>
                          <Text style={styles.optionSub}>
                            Alert immediately as soon as confirmed berths open up.
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {/* Option B: RAC increases rapidly */}
                      <TouchableOpacity
                        style={[
                          styles.optionCard,
                          racOption === 'rapid_increase' && styles.optionCardSelected,
                        ]}
                        onPress={() => setRacOption('rapid_increase')}
                        activeOpacity={0.8}
                      >
                        <View style={styles.optionRadio}>
                          {racOption === 'rapid_increase' && <View style={styles.optionRadioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.optionHeaderRow}>
                            <Text style={styles.optionTitle}>Notify when RAC increases rapidly</Text>
                            <TrendingUp size={14} color={colors.statusRac} strokeWidth={2.4} style={{ marginLeft: 4 }} />
                          </View>
                          <Text style={styles.optionSub}>
                            Alert if the RAC queue grows by 5+ or slips to WL so you can book fast to avoid waitlisting.
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* CASE 3: WAITLIST STATUS (WL drops to RAC / WL drops to AVL / Improves) */}
                  {parsedStatus.badgeLabel === 'WAITLIST' && (
                    <View style={styles.conditionSection}>
                      <Text style={styles.conditionSectionTitle}>Select Alert Condition</Text>
                      <Text style={styles.conditionSectionDesc}>
                        Choose when you want to be alerted as waitlist clears:
                      </Text>

                      {/* Option A: WL drops to RAC */}
                      <TouchableOpacity
                        style={[
                          styles.optionCard,
                          wlOption === 'drop_to_rac' && styles.optionCardSelected,
                        ]}
                        onPress={() => setWlOption('drop_to_rac')}
                        activeOpacity={0.8}
                      >
                        <View style={styles.optionRadio}>
                          {wlOption === 'drop_to_rac' && <View style={styles.optionRadioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>Notify when WL drops to RAC</Text>
                          <Text style={styles.optionSub}>
                            Alert as soon as your waitlist clears into RAC status.
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {/* Option B: WL drops to AVL */}
                      <TouchableOpacity
                        style={[
                          styles.optionCard,
                          wlOption === 'drop_to_avl' && styles.optionCardSelected,
                        ]}
                        onPress={() => setWlOption('drop_to_avl')}
                        activeOpacity={0.8}
                      >
                        <View style={styles.optionRadio}>
                          {wlOption === 'drop_to_avl' && <View style={styles.optionRadioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>Notify when WL drops to AVL</Text>
                          <Text style={styles.optionSub}>
                            Alert only when confirmed berths become available.
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {/* Option C: Any improvement */}
                      <TouchableOpacity
                        style={[
                          styles.optionCard,
                          wlOption === 'improves' && styles.optionCardSelected,
                        ]}
                        onPress={() => setWlOption('improves')}
                        activeOpacity={0.8}
                      >
                        <View style={styles.optionRadio}>
                          {wlOption === 'improves' && <View style={styles.optionRadioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>Notify on any position improvement</Text>
                          <Text style={styles.optionSub}>
                            Alert whenever the queue position moves up.
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Submit Button */}
                  <TouchableOpacity
                    style={[
                      styles.setAlertBtn,
                      thresholdError ? styles.setAlertBtnDisabled : null,
                    ]}
                    onPress={handleCreateAlert}
                    disabled={creatingAlert || Boolean(thresholdError)}
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
                </View>
              )}
            </View>
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
    maxHeight: '92%',
  },
  scrollContent: {
    paddingBottom: spacing.lg,
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
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
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
    fontWeight: '700',
    color: colors.primary,
  },
  trainNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  timeBlock: {
    flex: 1,
  },
  stationCode: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  timeValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 1,
  },
  durationBlock: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 3,
  },
  durationLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lineDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  lineDash: {
    width: 36,
    height: 1.5,
    backgroundColor: colors.borderStrong,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
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
    fontWeight: '600',
    color: colors.textSecondary,
  },
  fareValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  statusCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  availabilityBigText: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginVertical: 4,
  },
  liveSuccessText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.statusAvailable,
    marginTop: 2,
    marginBottom: 4,
  },
  refreshLiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  refreshLiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  alertOptionBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  alertIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  alertSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    marginBottom: 8,
    fontWeight: '600',
  },
  alertDisabledBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: 4,
  },
  alertDisabledText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    flex: 1,
  },
  alertAlreadyActiveCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: spacing.xs,
  },
  alertActiveRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  alertActiveTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.statusAvailable,
  },
  alertActiveSubtext: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  manageAlertsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    paddingVertical: 8,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  manageAlertsText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  conditionContainer: {
    marginTop: spacing.xs,
  },
  conditionSection: {
    marginBottom: spacing.md,
  },
  conditionSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  conditionSectionDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  inputRowError: {
    borderColor: colors.error,
  },
  lockPrefixBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: colors.borderSubtle,
  },
  lockPrefixText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  numericInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  seatsSuffixText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    paddingRight: 12,
  },
  fieldErrorText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.error,
    marginTop: 4,
  },
  helperText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 4,
  },
  presetChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: spacing.sm,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  presetChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presetChipDisabled: {
    opacity: 0.4,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  presetChipTextSelected: {
    color: '#FFFFFF',
  },
  presetChipTextDisabled: {
    color: colors.textMuted,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    marginBottom: 8,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  optionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.8,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  optionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  optionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  optionSub: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 15,
  },
  setAlertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  setAlertBtnDisabled: {
    opacity: 0.5,
  },
  setAlertBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
