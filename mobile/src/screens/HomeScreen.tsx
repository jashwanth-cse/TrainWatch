import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { colors, typography, spacing, radius } from '../theme/tokens';
import { useAuth } from '../services/AuthContext';

/**
 * Main Search Screen Header replicating ref.jpg card exactly:
 * Top gradient card with "Track your seats in one-go",
 * FROM: New Delhi (NDLS), TO: Kanpur (CNB), Date pill, Classes pill,
 * and prominent blue "Search Trains ->" button.
 */
export const SearchHeaderCard: React.FC<{
  source?: string;
  sourceCode?: string;
  destination?: string;
  destinationCode?: string;
  date?: string;
  onSwap?: () => void;
  onSearch?: () => void;
}> = ({
  source = 'New Delhi',
  sourceCode = 'NDLS',
  destination = 'Kanpur',
  destinationCode = 'CNB',
  date = '20/06/2026 (Tuesday)',
  onSwap,
  onSearch,
}) => {
  return (
    <View style={styles.cardWrapper}>
      {/* Top Gradient Banner with updated headline */}
      <LinearGradient
        colors={[colors.primaryGradientStart, colors.primaryGradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.heroCard}
      >
        <View style={styles.topBar}>
          <Text style={styles.heroClock}>19:02</Text>
          <Text style={styles.heroSignals}>●●● 4G</Text>
        </View>

        <Text style={styles.heroHeadline}>Track your seats{'\n'}in one-go</Text>
      </LinearGradient>

      {/* Embedded Route Selection Sheet */}
      <View style={styles.routeContainer}>
        {/* FROM Section */}
        <View style={styles.stationBlock}>
          <Text style={styles.stationLabel}>FROM</Text>
          <View style={styles.stationRow}>
            <Text style={styles.stationName} numberOfLines={1}>{source}</Text>
            <Text style={styles.stationCode}>{sourceCode}</Text>
          </View>
        </View>

        {/* Swap Floating Action Circle */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.swapCircle}
          onPress={onSwap}
        >
          <Text style={styles.swapIcon}>⇅</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} />

        {/* TO Section */}
        <View style={styles.stationBlock}>
          <Text style={styles.stationLabel}>TO</Text>
          <View style={styles.stationRow}>
            <Text style={styles.stationName} numberOfLines={1}>{destination}</Text>
            <Text style={styles.stationCode}>{destinationCode}</Text>
          </View>
        </View>

        {/* Date Selector Pill */}
        <View style={styles.pillContainer}>
          <View style={styles.dateBlock}>
            <Text style={styles.metaLabel}>Journey Date</Text>
            <Text style={styles.metaValue}>{date}</Text>
          </View>
          <Text style={styles.calendarIcon}>📅</Text>
        </View>

        {/* Filter Pills: All Classes / General */}
        <View style={styles.filterRow}>
          <TouchableOpacity activeOpacity={0.8} style={styles.filterPill}>
            <Text style={styles.filterPillText}>💺 All Classes</Text>
            <Text style={styles.filterCaret}>▾</Text>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.8} style={styles.filterPill}>
            <Text style={styles.filterPillText}>🎫 General</Text>
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
  const { user, signOut } = useAuth();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* User bar */}
        <View style={styles.userBar}>
          <Text style={styles.welcomeText}>Hello, {user?.displayName || 'Traveler'}</Text>
          <TouchableOpacity onPress={signOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Main Hero Route Card exactly matching ref.jpg */}
        <SearchHeaderCard />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  userBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.primaryGradientStart,
  },
  welcomeText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 16,
  },
  signOutBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: radius.full,
  },
  signOutText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '600',
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  heroClock: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  heroSignals: {
    color: colors.textInverse,
    fontSize: 12,
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
  },
  filterPill: {
    flex: 0.48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.pillBg,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  filterCaret: {
    fontSize: 12,
    color: colors.textSecondary,
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
});
