import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  Zap,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Info,
  Clock,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react-native';
import { radius } from '../theme/tokens';
import {
  SmartRouteSolution,
  BookingOrderStep,
  ensureBookingStrategy,
} from '../services/smartRouteService';
import { getStationName } from '../services/stationService';

interface BookingTrickModalProps {
  visible: boolean;
  onClose: () => void;
  solution: SmartRouteSolution | null;
  optionNumber: number;
  trainNo: string;
  trainName?: string;
}

export const BookingTrickModal: React.FC<BookingTrickModalProps> = ({
  visible,
  onClose,
  solution,
  optionNumber,
  trainNo,
  trainName,
}) => {
  const insets = useSafeAreaInsets();

  if (!solution) {
    return null;
  }

  const strat = solution.booking_strategy || ensureBookingStrategy(solution);

  const getProbabilityBadge = (prob: string) => {
    switch (prob) {
      case 'HIGH':
        return {
          bg: '#ECFDF5',
          border: '#A7F3D0',
          text: '#047857',
          label: 'High Coach Match Probability',
        };
      case 'BEST_EFFORT':
        return {
          bg: '#FEF3C7',
          border: '#FDE68A',
          text: '#B45309',
          label: 'Best Effort • Adjacent Coach Expected',
        };
      default:
        return {
          bg: '#EFF6FF',
          border: '#BFDBFE',
          text: '#1D4ED8',
          label: 'Optimized Coach Match Probability',
        };
    }
  };

  const probBadge = getProbabilityBadge(strat.same_coach_probability);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close booking trick modal"
        />

        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Drag Handle */}
          <View style={styles.dragHandle} />

          {/* Modal Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.taglineBadge}>
                <Zap size={11} color="#2563EB" strokeWidth={2.5} style={{ marginRight: 4 }} />
                <Text style={styles.taglineBadgeText}>
                  INTELLIGENT BOOKING ORDER • OPTION {optionNumber}
                </Text>
              </View>
              <Text style={styles.headerTitle}>Same-Coach Booking Trick</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                Train {trainNo} {trainName ? `• ${trainName}` : ''}
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color="#64748B" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Probability Pill */}
          <View style={[styles.probPill, { backgroundColor: probBadge.bg, borderColor: probBadge.border }]}>
            {strat.same_coach_probability === 'HIGH' ? (
              <CheckCircle2 size={13} color={probBadge.text} strokeWidth={2.4} style={{ marginRight: 6 }} />
            ) : strat.same_coach_probability === 'BEST_EFFORT' ? (
              <AlertCircle size={13} color={probBadge.text} strokeWidth={2.4} style={{ marginRight: 6 }} />
            ) : (
              <Sparkles size={13} color={probBadge.text} strokeWidth={2.4} style={{ marginRight: 6 }} />
            )}
            <Text style={[styles.probPillText, { color: probBadge.text }]}>{probBadge.label}</Text>
          </View>

          {/* Scrollable Strategy Guidance */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Why This Order Box */}
            <View style={styles.reasonCard}>
              <View style={styles.reasonHeader}>
                <Info size={14} color="#1E40AF" strokeWidth={2.4} style={{ marginRight: 6 }} />
                <Text style={styles.reasonTitle}>Why Book in this Order?</Text>
              </View>
              <Text style={styles.reasonBody}>{strat.strategy_reason}</Text>
            </View>

            {/* Step-by-Step Instructions */}
            <Text style={styles.stepsSectionTitle}>Recommended Booking Sequence</Text>

            {strat.steps.map((step: BookingOrderStep) => {
              const isFirstStep = step.step_number === 1;
              return (
                <View key={step.step_number} style={styles.stepCard}>
                  {/* Step Header Row */}
                  <View style={styles.stepHeaderRow}>
                    <View style={styles.stepBadgeCircle}>
                      <Text style={styles.stepBadgeText}>Step {step.step_number}</Text>
                    </View>
                    <View style={styles.stationPairRow}>
                      <Text style={styles.stationPairText}>
                        {step.from_station} ({getStationName(step.from_station)})
                      </Text>
                      <ArrowRight size={12} color="#64748B" style={{ marginHorizontal: 4 }} />
                      <Text style={styles.stationPairText}>
                        {step.to_station} ({getStationName(step.to_station)})
                      </Text>
                    </View>
                  </View>

                  {/* Metadata Bar */}
                  <View style={styles.metaRow}>
                    <View style={styles.metaPill}>
                      <Clock size={11} color="#475569" style={{ marginRight: 4 }} />
                      <Text style={styles.metaPillText}>
                        Date: {step.journey_date} {step.departure_time ? `• Dep: ${step.departure_time}` : ''}
                      </Text>
                    </View>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusPillText}>{step.raw_status}</Text>
                    </View>
                  </View>

                  {/* Action Instruction */}
                  <Text style={styles.stepInstructions}>{step.action_instructions}</Text>

                  {/* Coach Preference Callout */}
                  {step.preferred_coach_tip && (
                    <View
                      style={[
                        styles.coachTipBox,
                        isFirstStep ? styles.coachTipBoxFirst : styles.coachTipBoxNext,
                      ]}
                    >
                      <Sparkles
                        size={13}
                        color={isFirstStep ? '#0369A1' : '#B45309'}
                        strokeWidth={2.4}
                        style={{ marginRight: 6, marginTop: 1 }}
                      />
                      <Text
                        style={[
                          styles.coachTipText,
                          { color: isFirstStep ? '#075985' : '#92400E' },
                        ]}
                      >
                        {step.preferred_coach_tip}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

            {/* Edge Case Fallback Advisory */}
            {strat.same_coach_probability === 'BEST_EFFORT' && (
              <View style={styles.advisoryCard}>
                <AlertCircle size={15} color="#D97706" strokeWidth={2.4} style={{ marginRight: 8, marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.advisoryTitle}>Limited Seat Inventory Advisory</Text>
                  <Text style={styles.advisoryText}>
                    Because berth inventory is tight (1-2 seats), if the exact coach is filled before your second ticket completes, IRCTC PRS algorithmically allocates the nearest adjacent coach. You remain on the same train with zero platform change.
                  </Text>
                </View>
              </View>
            )}

            {/* Pro Tips Box */}
            <View style={styles.tipsCard}>
              <View style={styles.tipsHeaderRow}>
                <ShieldCheck size={14} color="#15803D" strokeWidth={2.4} style={{ marginRight: 6 }} />
                <Text style={styles.tipsHeaderTitle}>IRCTC Pro Booking Guidelines</Text>
              </View>
              {strat.insider_tips.map((tip: string, idx: number) => (
                <View key={idx} style={styles.tipItemRow}>
                  <View style={styles.tipDot} />
                  <Text style={styles.tipItemText}>{tip}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Action Button */}
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.8}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Got it, continue booking"
          >
            <Text style={styles.actionBtnText}>Got It, Close Guide</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '90%',
    width: '100%',
    paddingTop: 10,
    paddingHorizontal: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 24,
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  taglineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  taglineBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
    letterSpacing: 0.3,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
    borderRadius: radius.full,
    backgroundColor: '#F1F5F9',
  },
  probPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 12,
  },
  probPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scrollArea: {
    maxHeight: 460,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  reasonCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  reasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  reasonTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E40AF',
  },
  reasonBody: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  stepsSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  stepCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  stepBadgeCircle: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginRight: 8,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  stationPairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  stationPairText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  metaPillText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  statusPill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  stepInstructions: {
    fontSize: 12,
    color: '#1E293B',
    lineHeight: 18,
    marginBottom: 8,
  },
  coachTipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 9,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  coachTipBoxFirst: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  coachTipBoxNext: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  coachTipText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  advisoryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 12,
  },
  advisoryTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B45309',
    marginBottom: 2,
  },
  advisoryText: {
    fontSize: 11,
    color: '#78350F',
    lineHeight: 16,
  },
  tipsCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginBottom: 8,
  },
  tipsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  tipsHeaderTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  tipItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  tipDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#16A34A',
    marginTop: 6,
    marginRight: 6,
  },
  tipItemText: {
    flex: 1,
    fontSize: 11,
    color: '#14532D',
    lineHeight: 16,
  },
  actionBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
