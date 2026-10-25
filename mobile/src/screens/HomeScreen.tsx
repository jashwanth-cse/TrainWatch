import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
} from 'lucide-react-native';

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

  // Restore persisted last search on launch
  useEffect(() => {
    let isMounted = true;
    getLastSearch().then((last) => {
      if (isMounted && last) {
        if (last.source) setSource(last.source);
        if (last.destination) setDestination(last.destination);
        if (last.travelClass) setTravelClass(last.travelClass);
        if (last.quota) setQuota(last.quota);
        if (last.quotaCode) setQuotaCode(last.quotaCode);
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

  const handleSearchTrains = () => {
    if (source.code === destination.code) {
      Alert.alert('Invalid route', 'Departure and destination stations must be different.');
      return;
    }

    void saveLastSearch({
      source,
      destination,
      travelClass,
      quota,
      quotaCode,
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
        quota: quotaCode,
        travelClass,
      },
    });
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
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* Top Header & Tagline */}
        <View style={styles.topSection}>
          <AppHeader variant="light" />

          <View style={styles.captionContainer}>
            <Text style={styles.captionMain}>Track your seats</Text>
            <View style={styles.onTheGoRow}>
              <View style={styles.onTheGoBadge}>
                <Text style={styles.onTheGoText}>on-the-go</Text>
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

          {/* Two Boxes Side-by-Side: [All Classes ▾] [General ▾] */}
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
                <Armchair size={19} color="#0F172A" strokeWidth={2.2} style={styles.filterIconStyle} />
                <Text style={styles.filterText} numberOfLines={1}>
                  {travelClass}
                </Text>
              </View>
              <ChevronDown size={18} color="#475569" strokeWidth={2.2} />
            </TouchableOpacity>

            {/* Box 2: Quota */}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Select quota"
              activeOpacity={0.8}
              style={styles.filterBox}
              onPress={() => setQuotaModalVisible(true)}
            >
              <View style={styles.filterContent}>
                <TrainFront size={19} color="#0F172A" strokeWidth={2.2} style={styles.filterIconStyle} />
                <Text style={styles.filterText} numberOfLines={1}>
                  {quota}
                </Text>
              </View>
              <ChevronDown size={18} color="#475569" strokeWidth={2.2} />
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
    paddingHorizontal: 20,
  },
  topSection: {
    alignItems: 'center',
    paddingTop: 0,
    marginBottom: 4,
  },
  captionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -38,
  },
  captionMain: {
    fontSize: 27,
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
    marginTop: 6,
  },
  onTheGoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  onTheGoText: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0A1E4A', // Dark navy blue as requested
    letterSpacing: 0.5,
  },
  formSection: {
    backgroundColor: 'transparent',
    marginTop: 14,
  },
  stationBlock: {
    paddingVertical: 8,
  },
  stationLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  stationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  stationName: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: '#0F172A',
    flex: 1,
    marginRight: 12,
  },
  stationCode: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  dividerWrapper: {
    position: 'relative',
    justifyContent: 'center',
    height: 42,
    marginVertical: 4,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 5,
  },
  datePill: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 18,
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
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
    marginBottom: 2,
  },
  dateValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  twoBoxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
  },
  filterBox: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  filterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  filterIconStyle: {
    marginRight: 8,
  },
  filterText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    flex: 1,
  },
  searchButton: {
    marginTop: 26,
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  searchGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 22,
  },
  searchButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
