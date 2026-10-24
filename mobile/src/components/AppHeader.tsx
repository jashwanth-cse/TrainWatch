import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';
import { useAuth } from '../services/AuthContext';

interface AppHeaderProps {
  variant?: 'light' | 'dark';
  onSignOut?: () => void;
  showProfile?: boolean;
}

/**
 * Top App Bar with TrainWatch Branding
 * Follows Google Play Store Best UI/UX Award design standards:
 * - Top-left: High-resolution brand emblem + dual-tone wordmark ("TrainWatch") + live sync indicator.
 * - Top-right: User avatar / sign-out action with clean micro-interactions.
 * - Dynamic status bar safe-area padding for notch/cutout compatibility.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({
  variant = 'light',
  onSignOut,
  showProfile = true,
}) => {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  const isLight = variant === 'light';
  const handleSignOut = onSignOut || signOut;

  const initials = user?.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'TW';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: Math.max(insets.top, 12) + spacing.xs },
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
              LIVE TRACKER
            </Text>
          </View>
        </View>
      </View>

      {/* Top-Right Profile / Actions */}
      {showProfile && user && (
        <View style={styles.rightSection}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleSignOut}
            style={[styles.profilePill, isLight ? styles.profilePillLight : styles.profilePillDark]}
          >
            <View style={[styles.avatarCircle, isLight ? styles.avatarLight : styles.avatarDark]}>
              {user.photoURL ? (
                <Image source={{ uri: user.photoURL }} style={styles.avatarPhoto} />
              ) : (
                <Text style={[styles.avatarText, isLight ? styles.textWhite : styles.textDark]}>
                  {initials}
                </Text>
              )}
            </View>
            <Text style={[styles.signOutLabel, isLight ? styles.textWhite : styles.textDark]}>
              Sign Out
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md + 2,
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
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  emblemBadgeDark: {
    backgroundColor: colors.surfaceSubtle,
    shadowColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  emblemImage: {
    width: 28,
    height: 28,
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
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: radius.full,
  },
  profilePillLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  profilePillDark: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  avatarCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    overflow: 'hidden',
  },
  avatarLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  avatarDark: {
    backgroundColor: colors.primary,
  },
  avatarPhoto: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 11,
    fontWeight: '700',
  },
  signOutLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});
