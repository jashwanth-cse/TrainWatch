import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, radius } from '../theme/tokens';
import { useAuth } from '../services/AuthContext';
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

/**
 * Main Search Screen Header replicating ref.jpg card exactly:
 * Top gradient card with "Track your seats in one-go",
 * Interactive FROM / TO stations, Date pill, Classes & Quota pills,
 * and prominent blue "Search Trains ->" button.
 */
export const SearchHeaderCard: React.FC<{
  source: Station;
  destination: Station;
  displayDate: string;
  travelClass: string;
  quota: string;
  onSelectSource: () => void;
  onSelectDestination: () => void;
  onSelectDate: () => void;
  onSelectClass: () => void;
  onSelectQuota: () => void;
  onSwap: () => void;
  onSearch: () => void;
}> = ({
  source,
  destination,
  displayDate,
  travelClass,
  quota,
  onSelectSource,
  onSelectDestination,
  onSelectDate,
  onSelectClass,
  onSelectQuota,
  onSwap,
  onSearch,
}) => {
  return (
    <View style={styles.cardWrapper}>
      {/* Top Gradient Banner with headline */}
      <LinearGradient
        colors={[colors.primaryGradientStart, colors.primaryGradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.heroCard}
      >
        <Text style={styles.heroHeadline}>Track your seats{'\n'}in one-go</Text>
      </LinearGradient>

      {/* Embedded Route Selection Sheet */}
      <View style={styles.routeContainer}>
        {/* FROM Section */}
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.stationBlock}
          onPress={onSelectSource}
        >
          <Text style={styles.stationLabel}>FROM</Text>
          <View style={styles.stationRow}>
            <Text style={styles.stationName} numberOfLines={1}>
              {source.name}
            </Text>
            <Text style={styles.stationCode}>{source.code}</Text>
          </View>
        </TouchableOpacity>

        {/* Swap Floating Action Circle */}
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.85}
          style={styles.swapCircle}
          onPress={onSwap}
        >
          <Text style={styles.swapIcon}>⇅</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} />

        {/* TO Section */}
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.stationBlock}
          onPress={onSelectDestination}
        >
          <Text style={styles.stationLabel}>TO</Text>
          <View style={styles.stationRow}>
            <Text style={styles.stationName} numberOfLines={1}>
              {destination.name}
            </Text>
            <Text style={styles.stationCode}>{destination.code}</Text>
          </View>
        </TouchableOpacity>

        {/* Date Selector Pill */}
        <TouchableOpacity
          activeOpacity={0.75}
          style={styles.pillContainer}
          onPress={onSelectDate}
        >
          <View style={styles.dateBlock}>
            <Text style={styles.metaLabel}>Journey Date</Text>
            <Text style={styles.metaValue}>{displayDate}</Text>
          </View>
          <Text style={styles.calendarIcon}>📅</Text>
        </TouchableOpacity>

        {/* Filter Pills: All Classes / General */}
        <View style={styles.filterRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.filterPill}
            onPress={onSelectClass}
          >
            <View style={styles.pillContent}>
              <Text style={styles.pillMiniLabel}>CLASS</Text>
              <Text style={styles.filterPillText} numberOfLines={1}>
                💺 {travelClass}
              </Text>
            </View>
            <Text style={styles.filterCaret}>▾</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.filterPill}
            onPress={onSelectQuota}
          >
            <View style={styles.pillContent}>
              <Text style={styles.pillMiniLabel}>QUOTA</Text>
              <Text style={styles.filterPillText} numberOfLines={1}>
                🎫 {quota}
              </Text>
            </View>
            <Text style={styles.filterCaret}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* Primary CTA Search Button */}
        <TouchableOpacity
          activeOpacity={0.88}
          style={styles.searchButton}
          onPress={onSearch}
        >
          <Text style={styles.searchButtonText}>Search Trains</Text>
          <Text style={styles.searchArrow}>→</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const HomeScreen: React.FC = () => {
  const router = useRouter();
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Default tomorrow date for instant convenience
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [source, setSource] = useState<Station>({
    code: 'NDLS',
    name: 'NEW DELHI',
    state: 'DELHI',
  });
  const [destination, setDestination] = useState<Station>({
    code: 'CNB',
    name: 'KANPUR CENTRAL JN.',
    state: 'UTTAR PRADESH',
  });
  const [apiDate, setApiDate] = useState<string>(formatDateToApi(tomorrow));
  const [displayDate, setDisplayDate] = useState<string>(formatDateForDisplay(tomorrow));
  const [travelClass, setTravelClass] = useState<string>('All Classes');
  const [quota, setQuota] = useState<string>('GN');

  // Modal visibility states
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchTarget, setSearchTarget] = useState<'source' | 'destination'>('source');
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [classModalVisible, setClassModalVisible] = useState(false);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);

  // Swap animation
  const [swapRotate] = useState(() => new Animated.Value(0));

  const handleSwap = () => {
    Animated.sequence([
      Animated.timing(swapRotate, {
        toValue: 1,
        duration: 250,
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
    if (searchTarget === 'source') {
      setSource(station);
    } else {
      setDestination(station);
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
    setQuota(option.code);
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
        quota,
        travelClass,
      },
    });
  };

  const handleSignOut = async () => {
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('Sign-out failed. Please try signing out again.');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Top Gradient Header enclosing AppHeader */}
      <LinearGradient
        colors={[colors.primaryGradientStart, colors.primaryGradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.topHeaderGradient}
      >
        <AppHeader variant="light" onSignOut={handleSignOut} />
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {signOutError ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.signOutError}>
              {signOutError}
            </Text>
          </View>
        ) : null}

        {/* Main Hero Route Card exactly matching ref.jpg */}
        <SearchHeaderCard
          source={source}
          destination={destination}
          displayDate={displayDate}
          travelClass={travelClass}
          quota={quota}
          onSelectSource={() => {
            setSearchTarget('source');
            setSearchModalVisible(true);
          }}
          onSelectDestination={() => {
            setSearchTarget('destination');
            setSearchModalVisible(true);
          }}
          onSelectDate={() => setDateModalVisible(true)}
          onSelectClass={() => setClassModalVisible(true)}
          onSelectQuota={() => setQuotaModalVisible(true)}
          onSwap={handleSwap}
          onSearch={handleSearchTrains}
        />

        {/* Live Features Summary Card */}
        <View style={styles.featuresCard}>
          <Text style={styles.featureHeading}>TrainWatch Live Benefits</Text>
          <View style={styles.featureItem}>
            <Text style={styles.featureEmoji}>⚡</Text>
            <View style={styles.featureTextGroup}>
              <Text style={styles.featureTitle}>Sub-Second Direct Route Search</Text>
              <Text style={styles.featureDesc}>Queries IRCTC network directly across all 8,500+ Indian railway stations.</Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <Text style={styles.featureEmoji}>🔔</Text>
            <View style={styles.featureTextGroup}>
              <Text style={styles.featureTitle}>Smart Background Watching</Text>
              <Text style={styles.featureDesc}>Set watch alerts on any waitlisted class to get notified immediately when berths open.</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Station Autocomplete Modal */}
      <StationSearchModal
        visible={searchModalVisible}
        title={searchTarget === 'source' ? 'Select Origin Station' : 'Select Destination Station'}
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
        selectedQuota={quota}
        onSelect={handleQuotaSelected}
        onClose={() => setQuotaModalVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topHeaderGradient: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingBottom: spacing.sm,
  },
  scrollContent: {
    paddingTop: spacing.sm,
  },
  errorBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.statusWlBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  signOutError: {
    color: colors.statusWl,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  cardWrapper: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.cardBackground,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
    overflow: 'hidden',
  },
  heroCard: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  heroHeadline: {
    ...typography.hero,
    color: colors.textInverse,
  },
  routeContainer: {
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    position: 'relative',
  },
  stationBlock: {
    marginVertical: spacing.xs,
    paddingVertical: 4,
  },
  stationLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: 4,
  },
  stationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  stationName: {
    ...typography.stationTitle,
    color: colors.textPrimary,
    flex: 1,
    paddingRight: spacing.sm,
  },
  stationCode: {
    ...typography.stationCode,
    color: colors.textSecondary,
  },
  swapCircle: {
    position: 'absolute',
    right: spacing.lg,
    top: '25%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.swapButtonBg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.swapButtonBg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 10,
  },
  swapIcon: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.md,
  },
  pillContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.md,
  },
  dateBlock: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  calendarIcon: {
    fontSize: 18,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: 8,
  },
  filterPill: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.pillBg,
  },
  pillContent: {
    flex: 1,
  },
  pillMiniLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 1,
  },
  filterCaret: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    shadowColor: colors.ctaShadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 6,
  },
  searchButtonText: {
    ...typography.button,
    color: colors.textInverse,
    marginRight: spacing.sm,
  },
  searchArrow: {
    color: colors.textInverse,
    fontSize: 18,
    fontWeight: '700',
  },
  featuresCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  featureHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  featureEmoji: {
    fontSize: 20,
    marginRight: spacing.md,
    marginTop: 2,
  },
  featureTextGroup: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
