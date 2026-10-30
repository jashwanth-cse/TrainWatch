import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../theme/tokens';
import {
  watchService,
  WatchRecord,
  WatchCondition,
} from '../services/watchService';
import { fetchLiveAvailability } from '../services/trainService';
import {
  ArrowLeft,
  Bell,
  BellOff,
  RefreshCw,
  Trash2,
  Pause,
  Play,
  CalendarDays,
  TrainFront,
  ArrowRight,
  Edit2,
  X,
  TrendingUp,
} from 'lucide-react-native';

export const AlertsScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [watches, setWatches] = useState<WatchRecord[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Live status checks per watch_id
  const [checkingLiveIds, setCheckingLiveIds] = useState<Record<string, boolean>>({});
  const [liveResults, setLiveResults] = useState<Record<string, string>>({});

  // Edit condition modal state
  const [editingWatch, setEditingWatch] = useState<WatchRecord | null>(null);
  const [editThreshold, setEditThreshold] = useState<string>('25');
  const [editConditionKind, setEditConditionKind] = useState<string>('seats_below');
  const [updatingCondition, setUpdatingCondition] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const loadAlerts = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setActionError(null);
    try {
      const data = await watchService.listWatches();
      setWatches(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to load alerts';
      setActionError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const handleToggleStatus = async (watch: WatchRecord) => {
    const newStatus = watch.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      const updated = await watchService.updateWatchStatus(watch.watch_id, newStatus);
      setWatches((prev) =>
        prev.map((w) => (w.watch_id === watch.watch_id ? updated : w))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to update alert status';
      Alert.alert('Update Failed', msg);
    }
  };

  const handleDelete = (watch: WatchRecord) => {
    Alert.alert(
      'Delete Alert',
      `Stop tracking seat on train ${watch.query.train_number} (${watch.query.travel_class})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await watchService.deleteWatch(watch.watch_id);
              setWatches((prev) => prev.filter((w) => w.watch_id !== watch.watch_id));
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Unable to delete alert';
              Alert.alert('Delete Failed', msg);
            }
          },
        },
      ]
    );
  };

  const handleCheckLive = async (watch: WatchRecord) => {
    setCheckingLiveIds((prev) => ({ ...prev, [watch.watch_id]: true }));
    try {
      const res = await fetchLiveAvailability({
        trainNo: watch.query.train_number,
        source: watch.query.source,
        destination: watch.query.destination,
        travelClass: watch.query.travel_class,
        date: watch.query.journey_date,
        quota: watch.query.quota || 'GN',
      });
      if (res.success && res.data.availability) {
        setLiveResults((prev) => ({
          ...prev,
          [watch.watch_id]: res.data.availability,
        }));
      } else {
        setLiveResults((prev) => ({
          ...prev,
          [watch.watch_id]: 'Unavailable',
        }));
      }
    } catch {
      setLiveResults((prev) => ({
        ...prev,
        [watch.watch_id]: 'Failed to fetch',
      }));
    } finally {
      setCheckingLiveIds((prev) => ({ ...prev, [watch.watch_id]: false }));
    }
  };

  const openEditModal = (watch: WatchRecord) => {
    setEditingWatch(watch);
    setEditConditionKind(watch.condition.kind);
    setEditThreshold(String(watch.condition.maximum_position || 25));
    setEditError(null);
  };

  const closeEditModal = () => {
    setEditingWatch(null);
    setEditError(null);
  };

  const handleSaveCondition = async () => {
    if (!editingWatch) return;
    setEditError(null);

    let condition: WatchCondition;
    if (editConditionKind === 'seats_below') {
      const num = parseInt(editThreshold, 10);
      if (isNaN(num) || num <= 0) {
        setEditError('Enter a threshold number greater than 0');
        return;
      }
      condition = {
        kind: 'seats_below',
        maximum_position: num,
      };
    } else if (editConditionKind === 'rapid_rac_increase') {
      condition = { kind: 'rapid_rac_increase' };
    } else if (editConditionKind === 'becomes_available') {
      condition = { kind: 'becomes_available' };
    } else if (editConditionKind === 'improves_rac') {
      condition = { kind: 'improves', target_status: 'RAC' };
    } else {
      condition = { kind: 'improves' };
    }

    setUpdatingCondition(true);
    try {
      const updated = await watchService.updateWatchCondition(
        editingWatch.watch_id,
        condition
      );
      setWatches((prev) =>
        prev.map((w) => (w.watch_id === editingWatch.watch_id ? updated : w))
      );
      closeEditModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to update alert condition';
      setEditError(msg);
    } finally {
      setUpdatingCondition(false);
    }
  };

  const formatConditionDescription = (condition: WatchRecord['condition']) => {
    switch (condition.kind) {
      case 'seats_below':
        return `Alert when available seats drop below ${condition.maximum_position || 25}`;
      case 'rapid_rac_increase':
        return 'Alert when RAC queue increases rapidly (>= 5) or moves to WL';
      case 'becomes_available':
        return 'Alert as soon as confirmed seats become available (AVL)';
      case 'improves':
        if (condition.target_status === 'RAC') {
          return 'Alert when waitlist clears into RAC status';
        }
        return 'Alert when waitlist position moves closer';
      case 'reaches_threshold':
        return `Alert when position reaches <= ${condition.maximum_position || 0}`;
      default:
        return 'Alert when availability status changes';
    }
  };

  const renderItem = ({ item }: { item: WatchRecord }) => {
    const isActive = item.status === 'ACTIVE';
    const isPaused = item.status === 'PAUSED';
    const isChecking = checkingLiveIds[item.watch_id] || false;
    const liveStatus = liveResults[item.watch_id];

    return (
      <View style={styles.alertCard}>
        {/* Card Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.trainPill}>
            <TrainFront size={14} color={colors.primary} strokeWidth={2.4} style={{ marginRight: 5 }} />
            <Text style={styles.trainPillText}>{item.query.train_number}</Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              isActive && styles.statusBadgeActive,
              isPaused && styles.statusBadgePaused,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                isActive && styles.statusDotActive,
                isPaused && styles.statusDotPaused,
              ]}
            />
            <Text
              style={[
                styles.statusText,
                isActive && styles.statusTextActive,
                isPaused && styles.statusTextPaused,
              ]}
            >
              {item.status}
            </Text>
          </View>
        </View>

        {/* Route & Details */}
        <View style={styles.cardRouteRow}>
          <View style={styles.routeCol}>
            <Text style={styles.stationText}>{item.query.source}</Text>
            <Text style={styles.stationLabel}>SOURCE</Text>
          </View>
          <View style={styles.routeArrowCol}>
            <ArrowRight size={16} color={colors.textMuted} strokeWidth={2.4} />
          </View>
          <View style={[styles.routeCol, { alignItems: 'flex-end' }]}>
            <Text style={styles.stationText}>{item.query.destination}</Text>
            <Text style={styles.stationLabel}>DESTINATION</Text>
          </View>
        </View>

        {/* Class, Quota, Date Row */}
        <View style={styles.detailsRow}>
          <View style={styles.detailItem}>
            <Text style={styles.classQuotaBadge}>
              {item.query.travel_class} • {item.query.quota || 'GN'} Quota
            </Text>
          </View>
          <View style={styles.detailItem}>
            <CalendarDays size={13} color={colors.textSecondary} strokeWidth={2.2} style={{ marginRight: 4 }} />
            <Text style={styles.dateText}>{item.query.journey_date}</Text>
          </View>
        </View>

        {/* Trigger Condition Box */}
        <View style={styles.conditionBox}>
          <Bell size={13} color={colors.primary} strokeWidth={2.4} style={{ marginRight: 6, marginTop: 1 }} />
          <Text style={styles.conditionText}>
            {formatConditionDescription(item.condition)}
          </Text>
        </View>

        {/* Live Status Result (if checked) */}
        {liveStatus ? (
          <View style={styles.liveResultBox}>
            <Text style={styles.liveResultLabel}>Live Status:</Text>
            <Text style={styles.liveResultValue}>{liveStatus}</Text>
          </View>
        ) : null}

        {/* Action Buttons Row */}
        <View style={styles.actionsRow}>
          {/* Check Live */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleCheckLive(item)}
            disabled={isChecking}
            activeOpacity={0.75}
          >
            {isChecking ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <RefreshCw size={13} color={colors.primary} strokeWidth={2.4} style={{ marginRight: 4 }} />
                <Text style={styles.actionBtnText}>Check Live</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Pause / Resume */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleToggleStatus(item)}
            activeOpacity={0.75}
          >
            {isActive ? (
              <>
                <Pause size={13} color={colors.statusRac} strokeWidth={2.4} style={{ marginRight: 4 }} />
                <Text style={[styles.actionBtnText, { color: colors.statusRac }]}>Pause</Text>
              </>
            ) : (
              <>
                <Play size={13} color={colors.statusAvailable} strokeWidth={2.4} style={{ marginRight: 4 }} />
                <Text style={[styles.actionBtnText, { color: colors.statusAvailable }]}>Resume</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Edit Condition */}
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => openEditModal(item)}
            activeOpacity={0.75}
          >
            <Edit2 size={13} color={colors.textSecondary} strokeWidth={2.2} style={{ marginRight: 4 }} />
            <Text style={styles.actionBtnText}>Edit</Text>
          </TouchableOpacity>

          {/* Delete */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => handleDelete(item)}
            activeOpacity={0.75}
          >
            <Trash2 size={13} color={colors.error} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Top Gradient Header */}
      <LinearGradient
        colors={colors.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.headerBanner, { paddingTop: Math.max(insets.top, 12) }]}
      >
        <View style={styles.topNavRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color="#FFFFFF" strokeWidth={2.4} />
          </TouchableOpacity>

          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle}>My Seat Alerts</Text>
            <Text style={styles.headerSubtitle}>
              {watches.filter((w) => w.status === 'ACTIVE').length} Active Monitoring
            </Text>
          </View>

          <TouchableOpacity
            style={styles.refreshHeaderBtn}
            onPress={() => loadAlerts(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Refresh Alerts"
          >
            <RefreshCw size={17} color="#FFFFFF" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Body Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your seat alerts...</Text>
        </View>
      ) : watches.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <BellOff size={36} color={colors.textMuted} strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>No alerts configured</Text>
          <Text style={styles.emptySubtitle}>
            Search for trains and tap "Track This Seat" to receive automatic push notifications when berths confirm or drop below your threshold.
          </Text>
          <TouchableOpacity
            style={styles.searchTrainsBtn}
            onPress={() => router.push('/home')}
            activeOpacity={0.88}
          >
            <Text style={styles.searchTrainsBtnText}>Search Trains</Text>
            <ArrowRight size={16} color="#FFFFFF" strokeWidth={2.4} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={watches}
          keyExtractor={(item) => item.watch_id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 24) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadAlerts(true)}
              tintColor={colors.primary}
            />
          }
        />
      )}

      {/* Edit Condition Modal */}
      {editingWatch && (
        <Modal
          visible={Boolean(editingWatch)}
          animationType="fade"
          transparent
          onRequestClose={closeEditModal}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeEditModal} />
            <View style={styles.editDialog}>
              <View style={styles.editDialogHeader}>
                <View>
                  <Text style={styles.editDialogTitle}>Edit Alert Condition</Text>
                  <Text style={styles.editDialogSubtitle}>
                    {editingWatch.query.train_number} • {editingWatch.query.travel_class}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={closeEditModal}
                  style={styles.closeBtn}
                  activeOpacity={0.7}
                >
                  <X size={18} color={colors.textSecondary} strokeWidth={2.4} />
                </TouchableOpacity>
              </View>

              {editError ? <Text style={styles.modalErrorText}>{editError}</Text> : null}

              {/* Condition Options */}
              <View style={styles.modalOptionsContainer}>
                {/* 1. Seats Below */}
                <TouchableOpacity
                  style={[
                    styles.modalOptionCard,
                    editConditionKind === 'seats_below' && styles.modalOptionCardSelected,
                  ]}
                  onPress={() => setEditConditionKind('seats_below')}
                  activeOpacity={0.8}
                >
                  <View style={styles.radioCircle}>
                    {editConditionKind === 'seats_below' && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalOptionTitle}>Available Seats Below Threshold</Text>
                    {editConditionKind === 'seats_below' && (
                      <View style={styles.modalInputRow}>
                        <View style={styles.modalLockBadge}>
                          <Text style={styles.modalLockText}>AVL &lt;</Text>
                        </View>
                        <TextInput
                          style={styles.modalNumericInput}
                          value={editThreshold}
                          onChangeText={(v) => setEditThreshold(v.replace(/[^0-9]/g, ''))}
                          keyboardType="number-pad"
                          maxLength={4}
                        />
                        <Text style={styles.modalSeatsText}>seats</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>

                {/* 2. Rapid RAC Increase */}
                <TouchableOpacity
                  style={[
                    styles.modalOptionCard,
                    editConditionKind === 'rapid_rac_increase' && styles.modalOptionCardSelected,
                  ]}
                  onPress={() => setEditConditionKind('rapid_rac_increase')}
                  activeOpacity={0.8}
                >
                  <View style={styles.radioCircle}>
                    {editConditionKind === 'rapid_rac_increase' && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.modalOptionTitle}>RAC Increases Rapidly</Text>
                      <TrendingUp size={13} color={colors.statusRac} strokeWidth={2.4} style={{ marginLeft: 4 }} />
                    </View>
                    <Text style={styles.modalOptionSub}>
                      Alerts when RAC queue grows by 5+ or slips to WL.
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* 3. Becomes Available */}
                <TouchableOpacity
                  style={[
                    styles.modalOptionCard,
                    editConditionKind === 'becomes_available' && styles.modalOptionCardSelected,
                  ]}
                  onPress={() => setEditConditionKind('becomes_available')}
                  activeOpacity={0.8}
                >
                  <View style={styles.radioCircle}>
                    {editConditionKind === 'becomes_available' && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalOptionTitle}>Notify when Becomes Available (AVL)</Text>
                    <Text style={styles.modalOptionSub}>
                      Alert immediately as confirmed berths open up.
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* 4. Drops to RAC */}
                <TouchableOpacity
                  style={[
                    styles.modalOptionCard,
                    editConditionKind === 'improves_rac' && styles.modalOptionCardSelected,
                  ]}
                  onPress={() => setEditConditionKind('improves_rac')}
                  activeOpacity={0.8}
                >
                  <View style={styles.radioCircle}>
                    {editConditionKind === 'improves_rac' && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalOptionTitle}>Notify when WL Drops to RAC</Text>
                    <Text style={styles.modalOptionSub}>
                      Alert as waitlist advances into RAC status.
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActionButtons}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={closeEditModal}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveCondition}
                  disabled={updatingCondition}
                  activeOpacity={0.85}
                >
                  {updatingCondition ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save Condition</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBanner: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  topNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleCol: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 1,
  },
  refreshHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  searchTrainsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  searchTrainsBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listContent: {
    padding: spacing.md,
  },
  alertCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  trainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  trainPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSubtle,
  },
  statusBadgeActive: {
    backgroundColor: colors.statusAvailableBg,
  },
  statusBadgePaused: {
    backgroundColor: colors.statusRacBg,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
    marginRight: 5,
  },
  statusDotActive: {
    backgroundColor: colors.statusAvailable,
  },
  statusDotPaused: {
    backgroundColor: colors.statusRac,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  statusTextActive: {
    color: colors.statusAvailable,
  },
  statusTextPaused: {
    color: colors.statusRac,
  },
  cardRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  routeCol: {
    flex: 1,
  },
  stationText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  stationLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: 1,
  },
  routeArrowCol: {
    paddingHorizontal: 12,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  classQuotaBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  conditionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  conditionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 16,
  },
  liveResultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginTop: spacing.xs,
  },
  liveResultLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    marginRight: 5,
  },
  liveResultValue: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  deleteBtn: {
    flex: 0.4,
    borderColor: colors.error + '40',
    backgroundColor: colors.errorBg,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  editDialog: {
    width: '100%',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  editDialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  editDialogTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  editDialogSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalErrorText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.error,
    marginBottom: spacing.sm,
  },
  modalOptionsContainer: {
    gap: 8,
    marginBottom: spacing.md,
  },
  modalOptionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
  },
  modalOptionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  radioCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.8,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  modalOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalOptionSub: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginTop: 6,
    overflow: 'hidden',
  },
  modalLockBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: 1,
    borderRightColor: colors.borderSubtle,
  },
  modalLockText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  modalNumericInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  modalSeatsText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    paddingRight: 8,
  },
  modalActionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.xs,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
