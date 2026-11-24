import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { resolveQuota } from '../utils/quota';
import { AppHeader } from '../components/AppHeader';
import {
  Station,
  getLastSearch,
  saveLastSearch,
  addRecentStation,
} from '../services/stationService';
import { StationSearchModal } from '../components/StationSearchModal';
import { ClassPickerModal, ClassOption } from '../components/ClassPickerModal';
import { QuotaPickerModal, QuotaOption } from '../components/QuotaPickerModal';
import {
  DatePickerModal,
  DateItem,
  formatDateToApi,
  formatDateForDisplay,
} from '../components/DatePickerModal';
import {
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  TrainFront,
  Armchair,
  ArrowRight,
  Bell,
  Route,
} from 'lucide-react-native';
import {
  addNetworkListener,
  openNetworkSettings,
} from '../services/networkService';
import { colors } from '../theme/tokens';
import { watchService } from '../services/watchService';

const MULTILEG_CLASSES = ['All Classes', 'SL', '3A', '2A', '1A', '3E', 'CC', '2S'];

export const HomeScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Tomorrow as dynamic default date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [source, setSource] = useState<Station>({
    code: 'NDLS',
    name: 'New Delhi',
    state: 'DELHI',
  });
  const [destination, setDestination] = useState<Station>({
    code: 'CNB',
    name: 'Kanpur',
    state: 'UTTAR PRADESH',
  });
  const [apiDate, setApiDate] = useState<string>(formatDateToApi(tomorrow));
  const [displayDate, setDisplayDate] = useState<string>(formatDateForDisplay(tomorrow));
  const [travelClass, setTravelClass] = useState<string>('All Classes');
  const [quota, setQuota] = useState<string>('General');
  const [quotaCode, setQuotaCode] = useState<string>('GN');
  const [isOnline, setIsOnline] = useState(true);
  const [activeTab, setActiveTab] = useState<'track' | 'multileg'>('track');

  // Precise side-to-side swipe responder for switching between Track Seat and Multi leg
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            Math.abs(gestureState.dx) > 30 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5
          );
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -40) {
            // Swipe Left -> switch to Multi leg
            setActiveTab('multileg');
            if (travelClass !== 'All Classes' && !MULTILEG_CLASSES.includes(travelClass)) {
              setTravelClass('All Classes');
            }
          } else if (gestureState.dx > 40) {
            // Swipe Right -> switch to Track Seat
            setActiveTab('track');
          }
        },
      }),
    [travelClass]
  );

  // Network reachability listener
  useEffect(() => {
    const unsubscribe = addNetworkListener((status) => {
      setIsOnline(status.isInternetReachable);
    });
    return unsubscribe;
  }, []);
  const [hasActiveAlerts, setHasActiveAlerts] = useState(false);

  useEffect(() => {
    let isMounted = true;
    watchService.listWatches().then((list) => {
      if (isMounted) {
        setHasActiveAlerts(list.some((w) => w.status === 'ACTIVE'));
      }
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Restore persisted last search on launch
  useEffect(() => {
    let isMounted = true;
    getLastSearch().then((last) => {
      if (isMounted && last) {
        if (last.source) setSource(last.source);
        if (last.destination) setDestination(last.destination);
        if (last.travelClass) setTravelClass(last.travelClass);
        const restoredQuota = resolveQuota(last.quotaCode, last.quota);
        setQuota(restoredQuota.label);
        setQuotaCode(restoredQuota.code);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Modals
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchTarget, setSearchTarget] = useState<'source' | 'destination'>('source');
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [classModalVisible, setClassModalVisible] = useState(false);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);

  // Swap Animation
  const [swapRotate] = useState(() => new Animated.Value(0));

  const handleSwap = () => {
    Animated.sequence([
      Animated.timing(swapRotate, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(swapRotate, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]).start();

    const temp = source;
    setSource(destination);
    setDestination(temp);
  };

  const handleStationSelected = (station: Station) => {
    // Format station name to Title Case for elegant presentation matching the ref image
    const toTitleCase = (str: string) =>
      str
        .toLowerCase()
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    const formatted: Station = {
      ...station,
      name: toTitleCase(station.name),
    };

    if (searchTarget === 'source') {
      setSource(formatted);
      void addRecentStation(formatted);
    } else {
      setDestination(formatted);
      void addRecentStation(formatted);
    }
  };

  const handleDateSelected = (dateItem: DateItem) => {
    setApiDate(dateItem.apiFormat);
    setDisplayDate(dateItem.displayFormat);
  };

  const handleClassSelected = (option: ClassOption) => {
    setTravelClass(option.code);
  };

  const handleQuotaSelected = (option: QuotaOption) => {
    setQuota(option.label.split(' ')[0] || option.code);
    setQuotaCode(option.code);
  };

  const proceedToResults = () => {
    const searchQuota = activeTab === 'multileg' ? 'General' : quota;
    const searchQuotaCode = activeTab === 'multileg' ? 'GN' : quotaCode;

    void saveLastSearch({
      source,
      destination,
      travelClass,
      quota: searchQuota,
      quotaCode: searchQuotaCode,
    });

    router.push({
      pathname: '/results',
      params: {
        source: source.code,
        sourceName: source.name,
        destination: destination.code,
        destinationName: destination.name,
        date: apiDate,
        displayDate,
        quota: searchQuotaCode,
        travelClass,
        mode: activeTab,
      },
    });
  };

  const handleSearchTrains = () => {
    if (source.code === destination.code) {
      Alert.alert('Invalid route', 'Departure and destination stations must be different.');
      return;
    }

    if (!isOnline) {
      Alert.alert(
        'No Internet Connection',
        'You appear to be offline. Would you like to enable mobile data or Wi-Fi?',
        [
          { text: 'Settings', onPress: () => void openNetworkSettings() },
          { text: 'Search Anyway', onPress: proceedToResults },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    proceedToResults();
  };

  const rotateInterpolation = swapRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <LinearGradient
      colors={[
        '#2563EB',
        '#3B82F6',
        '#60A5FA',
        '#93C5FD',
        '#BFDBFE',
        '#DBEAFE',
        '#EFF6FF',
        '#FFFFFF',
        '#FFFFFF',
      ]}
      locations={[0, 0.08, 0.17, 0.27, 0.38, 0.49, 0.60, 0.74, 1.0]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.fullScreenGradient}
    >
      <StatusBar style="light" />

      <View
        style={[
          styles.mainLayout,
          {
            paddingTop: Math.max(insets.top, 10),
            paddingBottom: Math.max(insets.bottom, 0),
          },
        ]}
      >
        <View style={styles.contentBody} {...panResponder.panHandlers}>
          {/* Top-Left Notification Bell Icon */}
          <TouchableOpacity
            style={[styles.bellBtn, { top: Math.max(insets.top, 14) }]}
            onPress={() => router.push('/alerts')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="My Seat Alerts"
          >
            <Bell size={20} color="#FFFFFF" strokeWidth={2.4} />
            {hasActiveAlerts && <View style={styles.bellBadgeDot} />}
          </TouchableOpacity>

          {/* Top Header & Tagline */}
          <View style={styles.topSection}>
            <AppHeader variant="light" compact={true} />

            <View style={styles.captionContainer}>
              <Text style={styles.captionMain}>
                {activeTab === 'multileg' ? 'Get a confirm ticket' : 'Track your seats'}
              </Text>
              <View style={styles.onTheGoRow}>
                <View style={styles.onTheGoBadge}>
                  <Text style={styles.onTheGoText}>
                    {activeTab === 'multileg' ? 'on shift' : 'on-the-go'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Fixed Non-Scrolling Body smoothly smurged into the white lower half */}
          <View style={styles.formSection}>
            {/* FROM Section */}
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              style={styles.stationBlock}
              onPress={() => {
                setSearchTarget('source');
                setSearchModalVisible(true);
              }}
            >
              <Text style={styles.stationLabel}>FROM</Text>
              <View style={styles.stationRow}>
                <Text style={styles.stationName} numberOfLines={1}>
                  {source.name}
                </Text>
                <Text style={styles.stationCode}>{source.code}</Text>
              </View>
            </TouchableOpacity>

            {/* Divider with Swap Floating Action Circle */}
            <View style={styles.dividerWrapper}>
              <View style={styles.dividerLine} />
              <Animated.View style={[styles.swapContainer, { transform: [{ rotate: rotateInterpolation }] }]}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Swap departure and destination stations"
                  activeOpacity={0.85}
                  style={styles.swapCircle}
                  onPress={handleSwap}
                >
                  <ArrowUpDown size={20} color="#FFFFFF" strokeWidth={2.2} />
                </TouchableOpacity>
              </Animated.View>
            </View>

            {/* TO Section */}
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              style={styles.stationBlock}
              onPress={() => {
                setSearchTarget('destination');
                setSearchModalVisible(true);
              }}
            >
              <Text style={styles.stationLabel}>TO</Text>
              <View style={styles.stationRow}>
                <Text style={styles.stationName} numberOfLines={1}>
                  {destination.name}
                </Text>
                <Text style={styles.stationCode}>{destination.code}</Text>
              </View>
            </TouchableOpacity>

            {/* Journey Date Box */}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Select journey date"
              activeOpacity={0.8}
              style={styles.datePill}
              onPress={() => setDateModalVisible(true)}
            >
              <View style={styles.dateTextGroup}>
                <Text style={styles.dateLabel}>Journey Date</Text>
                <Text style={styles.dateValue}>{displayDate}</Text>
              </View>
              <CalendarDays size={22} color="#0F172A" strokeWidth={2} />
            </TouchableOpacity>

            {/* Two Boxes Side-by-Side: [All Classes ▾] [General] */}
            <View style={styles.twoBoxesRow}>
              {/* Box 1: Classes */}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Select travel class"
                activeOpacity={0.8}
                style={styles.filterBox}
                onPress={() => setClassModalVisible(true)}
              >
                <View style={styles.filterContent}>
                  <Armchair size={18} color="#0F172A" strokeWidth={2.2} style={styles.filterIconStyle} />
                  <Text style={styles.filterText} numberOfLines={1}>
                    {travelClass}
                  </Text>
                </View>
                <ChevronDown size={17} color="#475569" strokeWidth={2.2} />
              </TouchableOpacity>

              {/* Box 2: Quota */}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={activeTab === 'multileg' ? 'General quota locked' : 'Select quota'}
                activeOpacity={activeTab === 'multileg' ? 1 : 0.8}
                style={[styles.filterBox, activeTab === 'multileg' && styles.filterBoxLocked]}
                onPress={() => {
                  if (activeTab === 'track') {
                    setQuotaModalVisible(true);
                  }
                }}
              >
                <View style={styles.filterContent}>
                  <TrainFront size={18} color="#0F172A" strokeWidth={2.2} style={styles.filterIconStyle} />
                  <Text style={styles.filterText} numberOfLines={1}>
                    {activeTab === 'multileg' ? 'General' : quota}
                  </Text>
                </View>
                {activeTab === 'track' && (
                  <ChevronDown size={17} color="#475569" strokeWidth={2.2} />
                )}
              </TouchableOpacity>
            </View>

            {/* Search Trains CTA Button */}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Search trains"
              activeOpacity={0.88}
              style={styles.searchButton}
              onPress={handleSearchTrains}
            >
              <LinearGradient
                colors={['#3B82F6', '#2563EB']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.searchGradient}
              >
                <Text style={styles.searchButtonText}>Search Trains</Text>
                <ArrowRight size={22} color="#FFFFFF" strokeWidth={2.4} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        {/* WhatsApp-Style Docked Bottom Navigation: [Track Seat] [Multi leg] */}
        <View
          style={[
            styles.whatsappBottomNav,
            { paddingBottom: Math.max(insets.bottom, 10) },
          ]}
        >
          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityLabel="Track Seat tab"
            activeOpacity={0.85}
            style={[
              styles.whatsappNavTab,
              activeTab === 'track' && styles.whatsappNavTabActive,
            ]}
            onPress={() => setActiveTab('track')}
          >
            <TrainFront
              size={20}
              color={activeTab === 'track' ? '#2563EB' : '#64748B'}
              strokeWidth={activeTab === 'track' ? 2.5 : 2}
            />
            <Text
              style={[
                styles.whatsappNavText,
                activeTab === 'track' && styles.whatsappNavTextActive,
              ]}
            >
              Track Seat
            </Text>
            {activeTab === 'track' && <View style={styles.whatsappActiveIndicator} />}
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="tab"
            accessibilityLabel="Multi leg tab"
            activeOpacity={0.85}
            style={[
              styles.whatsappNavTab,
              activeTab === 'multileg' && styles.whatsappNavTabActive,
            ]}
            onPress={() => {
              setActiveTab('multileg');
              if (travelClass !== 'All Classes' && !MULTILEG_CLASSES.includes(travelClass)) {
                setTravelClass('All Classes');
              }
            }}
          >
            <Route
              size={20}
              color={activeTab === 'multileg' ? '#2563EB' : '#64748B'}
              strokeWidth={activeTab === 'multileg' ? 2.5 : 2}
            />
            <Text
              style={[
                styles.whatsappNavText,
                activeTab === 'multileg' && styles.whatsappNavTextActive,
              ]}
            >
              Multi leg
            </Text>
            {activeTab === 'multileg' && <View style={styles.whatsappActiveIndicator} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Station Autocomplete Modal */}
      <StationSearchModal
        visible={searchModalVisible}
        title={searchTarget === 'source' ? 'Select Departure Station' : 'Select Destination Station'}
        onClose={() => setSearchModalVisible(false)}
        onSelect={handleStationSelected}
      />

      {/* Date Picker Modal */}
      <DatePickerModal
        visible={dateModalVisible}
        selectedApiDate={apiDate}
        onSelect={handleDateSelected}
        onClose={() => setDateModalVisible(false)}
      />

      {/* Travel Class Picker Modal */}
      <ClassPickerModal
        visible={classModalVisible}
        selectedClass={travelClass}
        allowedClasses={activeTab === 'multileg' ? MULTILEG_CLASSES : undefined}
        onSelect={handleClassSelected}
        onClose={() => setClassModalVisible(false)}
      />

      {/* Quota Picker Modal */}
      <QuotaPickerModal
        visible={quotaModalVisible}
        selectedQuota={quotaCode}
        onSelect={handleQuotaSelected}
        onClose={() => setQuotaModalVisible(false)}
      />
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  fullScreenGradient: {
    flex: 1,
  },
  mainLayout: {
    flex: 1,
  },
  contentBody: {
    flex: 1,
    paddingHorizontal: 20,
  },
  bellBtn: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusAvailable,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  topSection: {
    alignItems: 'center',
    paddingTop: 0,
    marginBottom: 4,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginTop: 6,
    marginBottom: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  offlineBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  captionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -32,
  },
  captionMain: {
    fontSize: 23,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.15)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  onTheGoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  onTheGoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    paddingHorizontal: 14,
    paddingVertical: 3,
    borderRadius: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  onTheGoText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0A1E4A', // Dark navy blue as requested
    letterSpacing: 0.4,
  },
  formSection: {
    backgroundColor: 'transparent',
    marginTop: 6,
  },
  stationBlock: {
    paddingVertical: 5,
  },
  stationLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  stationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  stationName: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#0F172A',
    flex: 1,
    marginRight: 10,
  },
  stationCode: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  dividerWrapper: {
    position: 'relative',
    justifyContent: 'center',
    height: 34,
    marginVertical: 2,
  },
  dividerLine: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  swapContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    zIndex: 10,
  },
  swapCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  datePill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  dateTextGroup: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '500',
    marginBottom: 2,
  },
  dateValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  twoBoxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  filterBox: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  filterBoxLocked: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  fixedBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  fixedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  filterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  filterIconStyle: {
    marginRight: 6,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    flex: 1,
  },
  searchButton: {
    marginTop: 14,
    borderRadius: 26,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  searchGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  searchButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  whatsappBottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  whatsappNavTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    position: 'relative',
  },
  whatsappNavTabActive: {},
  whatsappNavText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 3,
  },
  whatsappNavTextActive: {
    color: '#2563EB',
    fontWeight: '800',
  },
  whatsappActiveIndicator: {
    position: 'absolute',
    top: -8,
    width: 48,
    height: 3,
    backgroundColor: '#2563EB',
    borderRadius: 2,
  },
  bottomNavContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 14,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  navTabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 18,
    marginHorizontal: 3,
    backgroundColor: 'transparent',
  },
  navTabButtonActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  navTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginLeft: 6,
  },
  navTabTextActive: {
    color: '#2563EB',
    fontWeight: '800',
  },
});
