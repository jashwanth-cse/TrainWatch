import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors, radius, spacing, shadows } from '../theme/tokens';
import {
  searchTrains,
  TrainItem,
  TravelClassInfo,
  TrainSearchResults,
} from '../services/trainService';
import { AvailabilityDetailModal } from '../components/AvailabilityDetailModal';
import { TrainWatchLoader } from '../components/TrainWatchLoader';
import { ResponsiveButton } from '../components/ResponsiveButton';
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Clock,
  Zap,
  IndianRupee,
  AlertCircle,
  TrainFront,
  Utensils,
  Compass,
  CheckCircle2,
} from 'lucide-react-native';

const { height: windowHeight } = Dimensions.get('window');

export const TrainResultsScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    source: string;
    sourceName?: string;
    destination: string;
    destinationName?: string;
    date: string;
    displayDate?: string;
    quota?: string;
    travelClass?: string;
  }>();

  const sourceCode = params.source || 'NDLS';
  const destinationCode = params.destination || 'CNB';
  const journeyDate = params.date || '';
  const displayDate = params.displayDate || journeyDate;
  const quota = params.quota || 'GN';
  const selectedClass = params.travelClass || 'All Classes';

  // Responsive page size based on device height (typically 6-8 on standard mobile screens)
  const pageSize = useMemo(() => {
    return Math.max(5, Math.min(10, Math.floor((windowHeight - 200) / 95)));
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TrainSearchResults | null>(null);
  const [selectedSort, setSelectedSort] = useState<'departure' | 'duration' | 'fare'>('departure');
  const [refreshIndex, setRefreshIndex] = useState(0);

  // Nearby trains reveal states
  const [showNearby, setShowNearby] = useState(false);
  const [revealingNearby, setRevealingNearby] = useState(false);

  // Pagination states
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Availability & Alert Modal State
  const [selectedTrainForModal, setSelectedTrainForModal] = useState<TrainItem | null>(null);
  const [selectedClassForModal, setSelectedClassForModal] = useState<TravelClassInfo | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);

  const handleRefresh = () => {
    setPage(1);
    setShowNearby(false);
    setRevealingNearby(false);
    setRefreshIndex((prev) => prev + 1);
  };

  const handleOpenDetailModal = (train: TrainItem, cls: TravelClassInfo) => {
    setSelectedTrainForModal(train);
    setSelectedClassForModal(cls);
    setDetailModalVisible(true);
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setLoading(true);
        setError(null);
        setPage(1);
        setShowNearby(false);
        setRevealingNearby(false);
      }
    });

    void searchTrains({
      source: sourceCode,
      destination: destinationCode,
      date: journeyDate,
      quota,
      travelClass: selectedClass,
    })
      .then((data) => {
        if (active) {
          setResults(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          const message = err instanceof Error ? err.message : 'Failed to search trains';
          setError(message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      if (loadMoreTimeout.current) clearTimeout(loadMoreTimeout.current);
    };
  }, [sourceCode, destinationCode, journeyDate, quota, selectedClass, refreshIndex]);

  // Determine whether direct trains exist
  const isDirectRoute = useMemo(() => {
    if (!results) return false;
    const rType = (results.result_type || results.route_type || '').toLowerCase();
    return rType === 'direct' && results.trains.length > 0;
  }, [results]);

  const hasNearbyTrains = useMemo(() => {
    if (!results) return false;
    const rType = (results.result_type || results.route_type || '').toLowerCase();
    return (rType === 'nearby' || rType === 'alternate') && results.trains.length > 0;
  }, [results]);

  // Handle user tapping "Show trains from Nearby Stations"
  const handleRevealNearby = () => {
    setRevealingNearby(true);
    // Smooth transition with innovative loader
    setTimeout(() => {
      setRevealingNearby(false);
      setShowNearby(true);
      setPage(1);
    }, 750);
  };

  // Sort trains
  const sortedTrains = useMemo(() => {
    if (!results?.trains) return [];
    const list = [...results.trains];

    if (selectedSort === 'departure') {
      list.sort((a, b) => a.departure_time.localeCompare(b.departure_time));
    } else if (selectedSort === 'duration') {
      const toMinutes = (dur: string) => {
        const parts = dur.split(':');
        return parseInt(parts[0] || '0', 10) * 60 + parseInt(parts[1] || '0', 10);
      };
      list.sort((a, b) => toMinutes(a.duration) - toMinutes(b.duration));
    } else if (selectedSort === 'fare') {
      list.sort((a, b) => (a.lowest_fare || 0) - (b.lowest_fare || 0));
    }

    return list;
  }, [results, selectedSort]);

  // Paginated visible trains subset
  const visibleTrains = useMemo(() => {
    return sortedTrains.slice(0, page * pageSize);
  }, [sortedTrains, page, pageSize]);

  const hasMorePages = visibleTrains.length < sortedTrains.length;

  const handleLoadMore = () => {
    if (!hasMorePages || loadingMore || loading || revealingNearby) return;

    setLoadingMore(true);
    loadMoreTimeout.current = setTimeout(() => {
      setPage((prev) => prev + 1);
      setLoadingMore(false);
    }, 450);
  };

  const getStatusBadgeStyle = (avail: string) => {
    const upper = avail.toUpperCase();
    if (upper.includes('AVL') || upper.includes('AVAILABLE') || upper.includes('CURR_AVBL')) {
      return {
        bg: colors.statusAvailableBg,
        text: colors.statusAvailable,
        dot: colors.statusAvailable,
      };
    }
    if (upper.includes('RAC')) {
      return {
        bg: colors.statusRacBg,
        text: colors.statusRac,
        dot: colors.statusRac,
      };
    }
    if (upper.includes('WL') || upper.includes('RLWL') || upper.includes('GNWL') || upper.includes('PQWL')) {
      return {
        bg: colors.statusWlBg,
        text: colors.statusWl,
        dot: colors.statusWl,
      };
    }
    return {
      bg: colors.surfaceSubtle,
      text: colors.textSecondary,
      dot: colors.textMuted,
    };
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Top Route Header matching HomeScreen gradient palette */}
      <LinearGradient
        colors={colors.headerGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[styles.headerBanner, { paddingTop: Math.max(insets.top, 14) + spacing.xs }]}
      >
        <View style={styles.topNavRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            delayPressIn={0}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color="#FFFFFF" strokeWidth={2.4} />
          </TouchableOpacity>

          <View style={styles.headerTitleGroup}>
            <View style={styles.routePill}>
              <Text style={styles.routeCode}>{sourceCode}</Text>
              <ArrowRight size={13} color="rgba(255,255,255,0.85)" strokeWidth={2.5} style={{ marginHorizontal: 6 }} />
              <Text style={styles.routeCode}>{destinationCode}</Text>
            </View>
            <Text style={styles.headerSubtitle}>
              {displayDate} • {quota} Quota
            </Text>
          </View>

          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={handleRefresh}
            delayPressIn={0}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Refresh train results"
          >
            <RotateCcw size={18} color="#FFFFFF" strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        {/* Sort Pills Row */}
        <View style={styles.sortBar}>
          <TouchableOpacity
            style={[styles.sortPill, selectedSort === 'departure' && styles.sortPillActive]}
            onPress={() => setSelectedSort('departure')}
            delayPressIn={0}
            activeOpacity={0.8}
          >
            <Clock
              size={12}
              color={selectedSort === 'departure' ? colors.brandNavy : 'rgba(255,255,255,0.85)'}
              strokeWidth={2.4}
              style={{ marginRight: 5 }}
            />
            <Text
              style={[styles.sortPillText, selectedSort === 'departure' && styles.sortPillTextActive]}
            >
              Departure
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sortPill, selectedSort === 'duration' && styles.sortPillActive]}
            onPress={() => setSelectedSort('duration')}
            delayPressIn={0}
            activeOpacity={0.8}
          >
            <Zap
              size={12}
              color={selectedSort === 'duration' ? colors.brandNavy : 'rgba(255,255,255,0.85)'}
              strokeWidth={2.4}
              style={{ marginRight: 5 }}
            />
            <Text
              style={[styles.sortPillText, selectedSort === 'duration' && styles.sortPillTextActive]}
            >
              Duration
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sortPill, selectedSort === 'fare' && styles.sortPillActive]}
            onPress={() => setSelectedSort('fare')}
            delayPressIn={0}
            activeOpacity={0.8}
          >
            <IndianRupee
              size={12}
              color={selectedSort === 'fare' ? colors.brandNavy : 'rgba(255,255,255,0.85)'}
              strokeWidth={2.4}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.sortPillText, selectedSort === 'fare' && styles.sortPillTextActive]}>
              Lowest Fare
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Body Content */}
      {loading ? (
        <View style={styles.centerContainer}>
          <TrainWatchLoader
            size="lg"
            message={`Searching live trains between ${sourceCode} & ${destinationCode}...`}
            subMessage="Checking direct rail availability"
          />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <AlertCircle size={44} color={colors.statusWl} strokeWidth={2} style={{ marginBottom: 12 }} />
          <Text style={styles.errorTitle}>Search Failed</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <ResponsiveButton
            title="Retry Search"
            onPress={handleRefresh}
            variant="primary"
            style={{ minWidth: 160 }}
          />
        </View>
      ) : !isDirectRoute && !showNearby ? (
        // NO DIRECT TRAINS FOUND STATE
        <View style={styles.fallbackCenterContainer}>
          <View style={styles.noDirectCard}>
            <View style={styles.noDirectIconCircle}>
              <TrainFront size={32} color={colors.primary} strokeWidth={2.2} />
            </View>
            <Text style={styles.noDirectTitle}>
              No direct trains found for this route!
            </Text>
            <Text style={styles.noDirectSubtitle}>
              There are no direct train routes between {sourceCode} and {destinationCode} on {displayDate}.
            </Text>

            {hasNearbyTrains ? (
              <View style={styles.nearbyActionArea}>
                <Text style={styles.nearbyHintText}>
                  Alternate trains are available connecting via nearby major stations.
                </Text>

                {revealingNearby ? (
                  <View style={{ paddingVertical: 14 }}>
                    <TrainWatchLoader
                      size="md"
                      message="Discovering trains from nearby stations..."
                      subMessage="Scanning connecting junctions and hubs"
                    />
                  </View>
                ) : (
                  <ResponsiveButton
                    title="Show trains from Nearby Stations"
                    onPress={handleRevealNearby}
                    variant="primary"
                    icon={<Compass size={18} color="#FFFFFF" strokeWidth={2.4} />}
                    style={{ width: '100%', marginTop: 8 }}
                  />
                )}
              </View>
            ) : (
              <Text style={styles.noNearbyNotice}>
                No alternative or nearby trains found for this date.
              </Text>
            )}
          </View>
        </View>
      ) : (
        // TRAIN LIST (DIRECT OR NEARBY REVEALED)
        <FlatList
          data={visibleTrains}
          keyExtractor={(item) => item.train_number}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            showNearby ? (
              <View style={styles.nearbyNoticeBanner}>
                <Compass size={15} color={colors.primary} strokeWidth={2.4} style={{ marginRight: 6 }} />
                <Text style={styles.nearbyNoticeBannerText}>
                  Showing trains from nearby stations
                </Text>
              </View>
            ) : undefined
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.listFooterLoader}>
                <TrainWatchLoader size="sm" message="Loading more trains..." />
              </View>
            ) : visibleTrains.length > 0 && !hasMorePages ? (
              <View style={styles.endOfListRow}>
                <CheckCircle2 size={13} color={colors.textSecondary} strokeWidth={2.4} style={{ marginRight: 5 }} />
                <Text style={styles.endOfListText}>
                  All {sortedTrains.length} {showNearby ? 'nearby' : 'direct'} trains displayed
                </Text>
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <TrainCard
              train={item}
              getStatusBadgeStyle={getStatusBadgeStyle}
              onSelectClass={(cls) => handleOpenDetailModal(item, cls)}
            />
          )}
        />
      )}

      {/* Availability Detail & Alert Modal */}
      <AvailabilityDetailModal
        visible={detailModalVisible}
        train={selectedTrainForModal}
        selectedClass={selectedClassForModal}
        journeyDate={journeyDate}
        displayDate={displayDate}
        quota={quota}
        onClose={() => setDetailModalVisible(false)}
      />
    </View>
  );
};

interface TrainCardProps {
  train: TrainItem;
  getStatusBadgeStyle: (avail: string) => { bg: string; text: string; dot: string };
  onSelectClass: (cls: TravelClassInfo) => void;
}

const TrainCard: React.FC<TrainCardProps> = ({ train, getStatusBadgeStyle, onSelectClass }) => {
  return (
    <View style={styles.card}>
      {/* Train Identification */}
      <View style={styles.trainHeader}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <View style={styles.trainNumberRow}>
            <Text style={styles.trainNumber}>{train.train_number}</Text>
            {train.has_pantry ? (
              <View style={styles.pantryBadge}>
                <Utensils size={10} color={colors.textSecondary} strokeWidth={2.4} style={{ marginRight: 3 }} />
                <Text style={styles.pantryText}>Pantry</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.trainName} numberOfLines={1}>
            {train.train_name}
          </Text>
        </View>
        {train.lowest_fare > 0 && (
          <View style={styles.fareContainer}>
            <Text style={styles.fromFareLabel}>starts from</Text>
            <Text style={styles.fareAmount}>₹{train.lowest_fare}</Text>
          </View>
        )}
      </View>

      {/* Schedule Row */}
      <View style={styles.scheduleRow}>
        <View style={styles.timeBlock}>
          <Text style={styles.timeText}>{train.departure_time}</Text>
          <Text style={styles.stationCodeText}>{train.from.code}</Text>
        </View>

        <View style={styles.durationBlock}>
          <Text style={styles.durationText}>{train.duration} hrs</Text>
          <View style={styles.timelineLine}>
            <View style={styles.timelineDot} />
            <View style={styles.timelineDash} />
            <View style={styles.timelineDot} />
          </View>
        </View>

        <View style={[styles.timeBlock, { alignItems: 'flex-end' }]}>
          <Text style={styles.timeText}>{train.arrival_time}</Text>
          <Text style={styles.stationCodeText}>{train.to.code}</Text>
        </View>
      </View>

      {/* Classes Availability Row */}
      <View style={styles.classesRow}>
        {train.classes.map((cls: TravelClassInfo) => {
          const badge = getStatusBadgeStyle(cls.availability);

          return (
            <TouchableOpacity
              key={cls.travel_class}
              style={styles.classBox}
              onPress={() => onSelectClass(cls)}
              delayPressIn={0}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              activeOpacity={0.72}
            >
              <View style={styles.classTopRow}>
                <Text style={styles.classTitle}>{cls.travel_class}</Text>
                {cls.fare > 0 && <Text style={styles.classFare}>₹{cls.fare}</Text>}
              </View>

              <View style={[styles.statusPill, { backgroundColor: badge.bg }]}>
                <View style={[styles.statusDot, { backgroundColor: badge.dot }]} />
                <Text style={[styles.statusText, { color: badge.text }]} numberOfLines={1}>
                  {cls.availability}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
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
    paddingBottom: spacing.sm + 2,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  topNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs + 2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.glassSubtleBg,
    borderWidth: 1,
    borderColor: colors.glassSubtleBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: {
    alignItems: 'center',
  },
  routePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassSubtleBg,
    borderWidth: 1,
    borderColor: colors.glassSubtleBorder,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  routeCode: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '600',
    marginTop: 3,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.glassSubtleBg,
    borderWidth: 1,
    borderColor: colors.glassSubtleBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: spacing.xs,
  },
  sortPill: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  sortPillActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
    ...shadows.badge,
  },
  sortPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.92)',
  },
  sortPillTextActive: {
    color: colors.brandNavy,
    fontWeight: '800',
  },
  listContent: {
    padding: spacing.md,
    gap: 12,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1.2,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  trainHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  trainNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trainNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  pantryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  pantryText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  trainName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 2,
  },
  fareContainer: {
    alignItems: 'flex-end',
  },
  fromFareLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  fareAmount: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
    marginVertical: spacing.xs,
  },
  timeBlock: {
    minWidth: 60,
  },
  timeText: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  stationCodeText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: 2,
  },
  durationBlock: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  durationText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 4,
  },
  timelineLine: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  timelineDash: {
    flex: 1,
    height: 1.5,
    backgroundColor: colors.borderStrong,
  },
  classesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  classBox: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.sm + 2,
    padding: 8,
    borderWidth: 1.2,
    borderColor: colors.borderSubtle,
  },
  classTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  classTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  classFare: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  errorMessage: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.statusWl,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  fallbackCenterContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  noDirectCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  noDirectIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primaryLight,
    borderWidth: 1.5,
    borderColor: 'rgba(96, 165, 250, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  noDirectTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: spacing.xs,
  },
  noDirectSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  nearbyActionArea: {
    width: '100%',
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    alignItems: 'center',
  },
  nearbyHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  noNearbyNotice: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  nearbyNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.35)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
    marginBottom: 6,
  },
  nearbyNoticeBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  listFooterLoader: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  endOfListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  endOfListText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
