import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { colors, typography, spacing, radius } from '../theme/tokens';
import { useAuth } from '../services/AuthContext';

const { width } = Dimensions.get('window');

/**
 * Google Sign-In Landing Screen
 * Strictly adhering to ref.jpg visual language and the requested headline:
 * "Track your seats in one-go"
 */
export const LandingScreen: React.FC = () => {
  const { signInWithGoogle, continueAsGuest, isLoading, error } = useAuth();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar style="light" />

      {/* Top Gradient Hero Banner replicating ref.jpg */}
      <LinearGradient
        colors={[colors.primaryGradientStart, colors.primaryGradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.heroSection,
          { minHeight: height * 0.46, paddingTop: Math.max(insets.top, 16) + spacing.md },
        ]}
      >
        {/* Subtle dot matrix / pattern overlay representation */}
        <View style={styles.patternOverlay}>
          <View style={styles.patternDotGrid} />
        </View>

        <View style={styles.heroContent}>
          {/* Top-Left Brand Logo & Wordmark Header */}
          <View style={styles.brandHeader}>
            <View style={styles.logoBadge}>
              <Image
                source={require('../../assets/brand-emblem.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <View style={styles.brandTextGroup}>
              <View style={styles.brandTitleRow}>
                <Text style={styles.brandTitleTrain}>Train</Text>
                <Text style={styles.brandTitleWatch}>Watch</Text>
              </View>
              <View style={styles.liveIndicatorRow}>
                <View style={styles.pulseDot} />
                <Text style={styles.liveIndicatorText}>LIVE TRACKER</Text>
              </View>
            </View>
          </View>

          <Text style={styles.heroTitle}>Track your seats{'\n'}in one-go</Text>
          <Text style={styles.heroSubtitle}>
            Never miss a confirmed berth. Automated IRCTC availability tracking and proactive seat alerts.
          </Text>
        </View>
      </LinearGradient>

      {/* Main Elevated Card Container */}
      <View style={styles.cardContainer}>
        <View style={styles.benefitRow}>
          <View style={styles.benefitIconBox}>
            <Text style={styles.benefitIcon}>⚡</Text>
          </View>
          <View style={styles.benefitTextGroup}>
            <Text style={styles.benefitTitle}>Direct Live Availability</Text>
            <Text style={styles.benefitDesc}>Sub-second live seat status across all train classes</Text>
          </View>
        </View>

        <View style={styles.benefitRow}>
          <View style={styles.benefitIconBox}>
            <Text style={styles.benefitIcon}>🔔</Text>
          </View>
          <View style={styles.benefitTextGroup}>
            <Text style={styles.benefitTitle}>Smart Background Watching</Text>
            <Text style={styles.benefitDesc}>Instant push notification when RAC or berths open</Text>
          </View>
        </View>

        <View style={styles.benefitRow}>
          <View style={styles.benefitIconBox}>
            <Text style={styles.benefitIcon}>🛡️</Text>
          </View>
          <View style={styles.benefitTextGroup}>
            <Text style={styles.benefitTitle}>Blackout-Safe Engine</Text>
            <Text style={styles.benefitDesc}>Respects IRCTC maintenance & Tatkal rate limits</Text>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Primary Google Sign-In Action Button */}
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.88}
          style={styles.googleButton}
          onPress={signInWithGoogle}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : (
            <View style={styles.buttonContent}>
              <View style={styles.googleIconCircle}>
                <Text style={styles.googleIconG}>G</Text>
              </View>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Guest Explorer Action Button */}
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          style={styles.guestButton}
          onPress={continueAsGuest}
        >
          <Text style={styles.guestButtonText}>Continue as Guest (Explore App) →</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimerText}>
          Sign in to synchronize watch subscriptions across devices, or explore as guest.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  heroSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: 'space-between',
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    position: 'relative',
    overflow: 'hidden',
  },
  patternOverlay: {
    ...StyleSheet.absoluteFill,
    opacity: 0.12,
  },
  patternDotGrid: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.2,
  },
  heroContent: {
    zIndex: 2,
    marginBottom: spacing.xl,
  },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 4,
  },
  logoImage: {
    width: 32,
    height: 32,
  },
  brandTextGroup: {
    justifyContent: 'center',
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitleTrain: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  brandTitleWatch: {
    fontSize: 22,
    fontWeight: '800',
    color: '#BAE6FD',
    letterSpacing: -0.4,
  },
  liveIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  liveIndicatorText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.8,
  },
  heroTitle: {
    ...typography.hero,
    color: colors.textInverse,
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    ...typography.body,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 20,
    maxWidth: width * 0.85,
  },
  cardContainer: {
    flexGrow: 1,
    flexShrink: 0,
    backgroundColor: colors.cardBackground,
    marginHorizontal: spacing.md,
    marginTop: -spacing.xl,
    borderRadius: radius.lg,
    padding: spacing.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  benefitIconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  benefitIcon: {
    fontSize: 20,
  },
  benefitTextGroup: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  benefitDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4285F4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm + 2,
  },
  googleIconG: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
  },
  googleButtonText: {
    ...typography.button,
    color: colors.textPrimary,
  },
  guestButton: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.full,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  guestButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  errorText: {
    color: colors.statusWl,
    fontSize: 12,
    textAlign: 'center',
    marginVertical: spacing.xs,
  },
  disclaimerText: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 15,
    marginTop: spacing.sm,
  },
});
