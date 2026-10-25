import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
  Animated,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors, radius, spacing } from '../theme/tokens';
import {
  searchTrains,
  TrainItem,
  TravelClassInfo,
  TrainSearchResults,
} from '../services/trainService';
import {
  Station,
  addRecentStation,
  saveLastSearch,
} from '../services/stationService';
import { AvailabilityDetailModal } from '../components/AvailabilityDetailModal';
import { DatePickerModal, DateItem } from '../components/DatePickerModal';
import { StationSearchModal } from '../components/StationSearchModal';
import { TrainWatchLoader } from '../components/TrainWatchLoader';
import { ResponsiveButton } from '../components/ResponsiveButton';
import { parseAvailabilityStatus } from '../utils/availabilityHelper';
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
  CalendarDays,
  ChevronDown,
  ArrowUpDown,
  X,
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

  // Active query state allowing live in-screen updates
  const [currentSource, setCurrentSource] = useState(params.source || 'NDLS');
  const [currentSourceName, setCurrentSourceName] = useState(params.sourceName || 'New Delhi');
  const [currentDestination, setCurrentDestination] = useState(params.destination || 'CNB');
  const [currentDestinationName, setCurrentDestinationName] = useState(params.destinationName || 'Kanpur');
  const [currentDate, setCurrentDate] = useState(params.date || '');
  const [currentDisplayDate, setCurrentDisplayDate] = useState(params.displayDate || params.date || '');
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

  // Half-screen date picker modal
  const [datePickerVisible, setDatePickerVisible] = useState(false);

  // Dynamic Island route switcher states
  const [islandVisible, setIslandVisible] = useState(false);
  const [islandSource, setIslandSource] = useState<Station>({
    code: currentSource,
    name: currentSourceName,
    state: '',
  });
  const [islandDestination, setIslandDestination] = useState<Station>({
    code: currentDestination,
    name: currentDestinationName,
    state: '',
  });
  const [stationModalVisible, setStationModalVisible] = useState(false);
  const [stationTarget, setStationTarget] = useState<'source' | 'destination'>('source');

  // Animation values for Dynamic Island
  const [islandAnim] = useState(() => new Animated.Value(0));
  const [islandSwapRotate] = useState(() => new Animated.Value(0));

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

  // Dynamic Island Route Switcher Controls
  const handleOpenDynamicIsland = () => {
    setIslandSource({ code: currentSource, name: currentSourceName, state: '' });
    setIslandDestination({ code: currentDestination, name: currentDestinationName, state: '' });
    setIslandVisible(true);
    Animated.spring(islandAnim, {
      toValue: 1,
      friction: 8,
      tension: 45,
      useNativeDriver: true,
    }).start();
  };

  const handleCloseDynamicIsland = () => {
    Animated.timing(islandAnim, {
      toValue: 0,
      duration: 170,
      useNativeDriver: true,
    }).start(() => {
      setIslandVisible(false);
    });
  };

  const handleSwapIslandStations = () => {
    Animated.sequence([
      Animated.timing(islandSwapRotate, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(islandSwapRotate, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]).start();

    const temp = islandSource;
    setIslandSource(islandDestination);
    setIslandDestination(temp);
  };

  const handleCommitDynamicIsland = () => {
    if (islandSource.code === islandDestination.code) {
      Alert.alert('Invalid Route', 'Departure and destination stations must be different.');
      return;
    }
    setCurrentSource(islandSource.code);
    setCurrentSourceName(islandSource.name);
    setCurrentDestination(islandDestination.code);
    setCurrentDestinationName(islandDestination.name);

    void saveLastSearch({
      source: islandSource,
      destination: islandDestination,
      travelClass: selectedClass,
      quota,
    });
    void addRecentStation(islandSource);
    void addRecentStation(islandDestination);

    handleCloseDynamicIsland();
    setPage(1);
    setShowNearby(false);
    setRevealingNearby(false);
    setRefreshIndex((prev) => prev + 1);
  };

  const handleDateSelected = (dateItem: DateItem) => {
    setCurrentDate(dateItem.apiFormat);
    setCurrentDisplayDate(dateItem.displayFormat);
    setDatePickerVisible(false);
    setPage(1);
    setShowNearby(false);
    setRevealingNearby(false);
    setRefreshIndex((prev) => prev + 1);
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
      source: currentSource,
      destination: currentDestination,
      date: currentDate,
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
  }, [currentSource, currentDestination, currentDate, quota, selectedClass, refreshIndex]);

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
    const parsed = parseAvailabilityStatus(avail);
    return {
      bg: parsed.bgColor,
      text: parsed.textColor,
      dot: parsed.dotColor,
      label: parsed.badgeLabel,
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
            {/* Dynamic Island Trigger Pill */}
            <TouchableOpacity
              style={styles.routePill}
              onPress={handleOpenDynamicIsland}
              activeOpacity={0.82}
              delayPressIn={0}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.routeCode}>{currentSource}</Text>
              <ArrowRight size={13} color="rgba(255,255,255,0.85)" strokeWidth={2.5} style={{ marginHorizontal: 6 }} />
              <Text style={styles.routeCode}>{currentDestination}</Text>
              <ChevronDown size={13} color="rgba(255,255,255,0.75)" strokeWidth={2.5} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
            <Text style={styles.headerSubtitle}>
              {currentDisplayDate} • {quota} Quota
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

        {/* Quick Date Switcher Bar with Half-Screen Calendar Trigger */}
        <TouchableOpacity
          style={styles.dateBar}
          onPress={() => setDatePickerVisible(true)}
          activeOpacity={0.85}
          delayPressIn={0}
        >
          <View style={styles.dateBarLeft}>
            <CalendarDays size={14} color="#93C5FD" strokeWidth={2.4} style={{ marginRight: 6 }} />
            <Text style={styles.dateBarLabel}>Journey Date:</Text>
            <Text style={styles.dateBarValue}>{currentDisplayDate}</Text>
          </View>
          <View style={styles.dateBarChangeBadge}>
            <Text style={styles.dateBarChangeText}>Change</Text>
            <ChevronDown size={11} color="#FFFFFF" strokeWidth={2.6} style={{ marginLeft: 3 }} />
          </View>
        </TouchableOpacity>

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
            message={`Searching live trains between ${currentSource} & ${currentDestination}...`}
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
              <Compass size={28} color={colors.primary} strokeWidth={2.2} />
            </View>
            <Text style={styles.noDirectTitle}>No direct trains found for this route!</Text>
            <Text style={styles.noDirectSubtitle}>
              Direct trains between {currentSource} and {currentDestination} are not available on this date.
              Nearby connecting stations may have active trains.
            </Text>

            {hasNearbyTrains ? (
              <View style={styles.nearbyActionArea}>
                <Text style={styles.nearbyHintText}>
                  {results?.trains.length} alternate train routes available via neighboring hubs
                </Text>
                <ResponsiveButton
                  title={revealingNearby ? 'Finding Alternate Routes...' : 'Show trains from Nearby Stations'}
                  onPress={handleRevealNearby}
                  variant="primary"
                  loading={revealingNearby}
                  icon={<ArrowRight size={17} color="#FFFFFF" strokeWidth={2.4} />}
                  style={{ width: '100%' }}
                />
              </View>
            ) : (
              <Text style={styles.noNearbyNotice}>
                No alternate nearby stations available for this specific query.
              </Text>
            )}
          </View>
        </View>
      ) : revealingNearby ? (
        <View style={styles.centerContainer}>
          <TrainWatchLoader
            size="lg"
            message="Discovering Trains from Nearby Stations..."
            subMessage="Scanning neighboring junctions & connecting rail hubs"
          />
        </View>
      ) : sortedTrains.length === 0 ? (
        <View style={styles.centerContainer}>
          <TrainFront size={44} color={colors.textMuted} strokeWidth={1.8} style={{ marginBottom: 12 }} />
          <Text style={styles.errorTitle}>No Trains Scheduled</Text>
          <Text style={styles.errorMessage}>
            No trains found operating between {currentSource} and {currentDestination} on {currentDisplayDate}.
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleTrains}
          keyExtractor={(item) => item.train_number}
          contentContainerStyle={[
            styles.listContainer,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            showNearby ? (
              <View style={styles.nearbyNoticeBanner}>
                <Compass size={15} color={colors.primaryDark} strokeWidth={2.4} style={{ marginRight: 6 }} />
                <Text style={styles.nearbyNoticeBannerText}>
                  Showing trains from nearby connecting stations ({sortedTrains.length} found)
                </Text>
              </View>
            ) : undefined
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.listFooterLoader}>
                <TrainWatchLoader size="sm" message="Loading more trains..." />
              </View>
            ) : !hasMorePages && sortedTrains.length > 5 ? (
              <View style={styles.endOfListRow}>
                <CheckCircle2 size={14} color={colors.textSecondary} strokeWidth={2} style={{ marginRight: 6 }} />
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

      {/* Dynamic Island Route Switcher Overlay */}
      {islandVisible && (
        <View style={styles.islandOverlay}>
          <TouchableOpacity
            style={styles.islandBackdrop}
            activeOpacity={1}
            onPress={handleCloseDynamicIsland}
            accessibilityRole="button"
            accessibilityLabel="Close route switcher"
          />

          <Animated.View
            style={[
              styles.islandCardWrapper,
              {
                paddingTop: Math.max(insets.top, 14),
                opacity: islandAnim,
                transform: [
                  {
                    scale: islandAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1],
                    }),
                  },
                  {
                    translateY: islandAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-24, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <LinearGradient
              colors={['#DBEAFE', '#EFF6FF', '#FFFFFF']}
              locations={[0, 0.42, 1.0]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.islandCardGradient}
            >
              {/* Header with clean drag indicator and close button */}
              <View style={styles.islandHeader}>
                <View style={styles.islandDragHandle} />
                <TouchableOpacity
                  onPress={handleCloseDynamicIsland}
                  style={styles.islandCloseBtn}
                  delayPressIn={0}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close route switcher"
                >
                  <X size={16} color="#2563EB" strokeWidth={2.4} />
                </TouchableOpacity>
              </View>

              {/* Station Selector Cards Row */}
              <View style={styles.islandRouteRow}>
                {/* Departure Station Card */}
                <TouchableOpacity
                  style={styles.islandStationCard}
                  onPress={() => {
                    setStationTarget('source');
                    setStationModalVisible(true);
                  }}
                  activeOpacity={0.8}
                  delayPressIn={0}
                >
                  <Text style={styles.islandStationTag}>FROM</Text>
                  <Text style={styles.islandStationCode}>{islandSource.code}</Text>
                  <Text style={styles.islandStationName} numberOfLines={1}>
                    {islandSource.name}
                  </Text>
                </TouchableOpacity>

                {/* Middle Swap Button */}
                <TouchableOpacity
                  style={styles.islandSwapBtn}
                  onPress={handleSwapIslandStations}
                  activeOpacity={0.85}
                  delayPressIn={0}
                  accessibilityRole="button"
                  accessibilityLabel="Swap departure and destination stations"
                >
                  <Animated.View
                    style={{
                      transform: [
                        {
                          rotate: islandSwapRotate.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '180deg'],
                          }),
                        },
                      ],
                    }}
                  >
                    <ArrowUpDown size={18} color="#FFFFFF" strokeWidth={2.4} />
                  </Animated.View>
                </TouchableOpacity>

                {/* Destination Station Card */}
                <TouchableOpacity
                  style={styles.islandStationCard}
                  onPress={() => {
                    setStationTarget('destination');
                    setStationModalVisible(true);
                  }}
                  activeOpacity={0.8}
                  delayPressIn={0}
                >
                  <Text style={styles.islandStationTag}>TO</Text>
                  <Text style={styles.islandStationCode}>{islandDestination.code}</Text>
                  <Text style={styles.islandStationName} numberOfLines={1}>
                    {islandDestination.name}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Update Route CTA */}
              <TouchableOpacity
                style={styles.islandCommitBtn}
                onPress={handleCommitDynamicIsland}
                activeOpacity={0.88}
                delayPressIn={0}
              >
                <LinearGradient
                  colors={['#2563EB', '#1D4ED8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.islandCommitGradient}
                >
                  <Text style={styles.islandCommitText}>Update Route & Search</Text>
                  <ArrowRight size={16} color="#FFFFFF" strokeWidth={2.4} style={{ marginLeft: 6 }} />
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>
          </Animated.View>
        </View>
      )}

      {/* Half-Screen Journey Date Picker Modal */}
      <DatePickerModal
        visible={datePickerVisible}
        halfScreen={true}
        selectedApiDate={currentDate}
        onClose={() => setDatePickerVisible(false)}
        onSelect={handleDateSelected}
      />

      {/* Adaptive Half-Screen Station Search Modal for Route Switcher */}
      <StationSearchModal
        visible={stationModalVisible}
        halfScreen={true}
        title={stationTarget === 'source' ? 'Select Departure Station' : 'Select Destination'}
        onClose={() => setStationModalVisible(false)}
        onSelect={(station) => {
          if (stationTarget === 'source') {
            setIslandSource(station);
          } else {
            setIslandDestination(station);
          }
          setStationModalVisible(false);
        }}
      />

      {/* Availability Detail & Alert Modal */}
      <AvailabilityDetailModal
        visible={detailModalVisible}
        train={selectedTrainForModal}
        selectedClass={selectedClassForModal}
        journeyDate={currentDate}
        displayDate={currentDisplayDate}
        quota={quota}
        onClose={() => setDetailModalVisible(false)}
      />
    </View>
  );
};

interface TrainCardProps {
  train: TrainItem;
  getStatusBadgeStyle: (avail: string) => { bg: string; text: string; dot: string; label: string };
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
                  {badge.label}
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
    marginBottom: spacing.xs,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  routePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  routeCode: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.88)',
    marginTop: 2,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Date Switcher Bar
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: spacing.xs + 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  dateBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dateBarLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.75)',
    marginRight: 4,
  },
  dateBarValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dateBarChangeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  dateBarChangeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  sortBar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  sortPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  sortPillActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  sortPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sortPillTextActive: {
    color: colors.brandNavy,
  },

  listContainer: {
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1.2,
    borderColor: colors.borderSubtle,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  trainHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  trainNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  trainNumber: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    marginRight: 6,
  },
  pantryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  pantryText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  trainName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  fareContainer: {
    alignItems: 'flex-end',
  },
  fromFareLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  fareAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.brandNavy,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  timeBlock: {
    minWidth: 60,
  },
  timeText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  stationCodeText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 2,
  },
  durationBlock: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
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
  },
  classBox: {
    flex: 1,
    minWidth: 72,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  classTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  classTitle: {
    fontSize: 12,
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
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
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
    letterSpacing: 0.2,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  fallbackCenterContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.lg,
  },
  noDirectCard: {
    width: '100%',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  noDirectIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  noDirectTitle: {
    fontSize: 17,
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

  // Dynamic Island Overlay & Card
  islandOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 9999,
  },
  islandBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  islandCardWrapper: {
    backgroundColor: 'transparent',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 12,
  },
  islandCardGradient: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
  },
  islandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm + 4,
    marginTop: 4,
    position: 'relative',
  },
  islandDragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#93C5FD',
  },
  islandCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: -2,
  },
  islandRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  islandStationCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1.2,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  islandStationTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  islandStationCode: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  islandStationName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginTop: 2,
  },
  islandSwapBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  islandCommitBtn: {
    borderRadius: radius.md,
    marginTop: spacing.md,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  islandCommitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  islandCommitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
