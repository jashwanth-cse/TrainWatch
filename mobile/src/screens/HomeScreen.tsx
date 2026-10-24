import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { spacing } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { Station } from '../services/stationService';
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
    } else {
      setDestination(formatted);
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
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Top Gradient Banner replicating ref image */}
      <LinearGradient
        colors={['#4382EC', '#6AA0F7', '#E8F2FE']}
        locations={[0, 0.7, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.heroBanner, { paddingTop: insets.top + spacing.xs }]}
      >
        <AppHeader variant="light" />

        <View style={styles.captionContainer}>
          <Text style={styles.appCaption}>Track your seats{'\n'}in one-go</Text>
        </View>
      </LinearGradient>

      {/* Main Elevated White Form Card replicating the image layout */}
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
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
              colors={['#3B82F6', '#5295F8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.searchGradient}
            >
              <Text style={styles.searchButtonText}>Search Trains</Text>
              <ArrowRight size={22} color="#FFFFFF" strokeWidth={2.4} />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>

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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  heroBanner: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  captionContainer: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  appCaption: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 40,
    color: '#FFFFFF',
    letterSpacing: -0.6,
  },
  scrollContent: {
    paddingTop: spacing.xs,
  },
  card: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  stationBlock: {
    paddingVertical: 10,
  },
  stationLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: '#8E9BAE',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  stationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  stationName: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: '#0F172A',
    flex: 1,
    paddingRight: spacing.sm,
  },
  stationCode: {
    fontSize: 17,
    fontWeight: '600',
    color: '#334155',
  },
  dividerWrapper: {
    position: 'relative',
    justifyContent: 'center',
    marginVertical: 14,
    height: 44,
  },
  dividerLine: {
    height: 1,
    backgroundColor: '#EEF2F6',
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
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
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
    marginTop: 22,
    backgroundColor: '#FFFFFF',
  },
  dateTextGroup: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
    marginBottom: 3,
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
    marginTop: 36,
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  searchGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
  searchButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
