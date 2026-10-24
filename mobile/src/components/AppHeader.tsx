import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

interface AppHeaderProps {
  variant?: 'light' | 'dark';
}

/**
 * Top App Bar with TrainWatch Branding
 * Follows Google Play Store Best UI/UX Award design standards:
 * - Top-left: High-resolution brand emblem + dual-tone wordmark ("TrainWatch") + live sync indicator.
 * - Dynamic status bar safe-area padding for notch/cutout compatibility.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({ variant = 'light' }) => {
  const insets = useSafeAreaInsets();
  const isLight = variant === 'light';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: Math.max(insets.top, 14) },
        isLight ? styles.containerLight : styles.containerDark,
      ]}
    >
      {/* Top-Left Brand Cluster */}
      <View style={styles.brandCluster}>
        <View style={[styles.emblemBadge, isLight ? styles.emblemBadgeLight : styles.emblemBadgeDark]}>
          <Image
            source={require('../../assets/brand-emblem.png')}
            style={styles.emblemImage}
            resizeMode="contain"
          />
        </View>

        <View style={styles.titleColumn}>
          <View style={styles.wordmarkRow}>
            <Text style={[styles.titleTrain, isLight ? styles.textWhite : styles.textDark]}>
              Train
            </Text>
            <Text style={[styles.titleWatch, isLight ? styles.textCyan : styles.textPrimary]}>
              Watch
            </Text>
          </View>
          <View style={styles.liveBadge}>
            <View style={styles.pulseDot} />
            <Text style={[styles.liveText, isLight ? styles.liveTextLight : styles.liveTextDark]}>
              LIVE IRCTC TRACKER
            </Text>
          </View>
        </View>
      </View>

      {/* Top-Right Status Pill */}
      <View style={[styles.statusPill, isLight ? styles.statusPillLight : styles.statusPillDark]}>
        <Text style={[styles.statusPillText, isLight ? styles.textWhite : styles.textPrimary]}>
          ⚡ Direct Sync
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  containerLight: {
    backgroundColor: 'transparent',
  },
  containerDark: {
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  brandCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emblemBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  emblemBadgeLight: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
  },
  emblemBadgeDark: {
    backgroundColor: colors.surfaceSubtle,
    shadowColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  emblemImage: {
    width: 26,
    height: 26,
  },
  titleColumn: {
    justifyContent: 'center',
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleTrain: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  titleWatch: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  textWhite: {
    color: '#FFFFFF',
  },
  textDark: {
    color: colors.textPrimary,
  },
  textCyan: {
    color: '#BAE6FD',
  },
  textPrimary: {
    color: colors.primary,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  liveTextLight: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  liveTextDark: {
    color: colors.textSecondary,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusPillLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  statusPillDark: {
    backgroundColor: colors.primaryLight,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
