import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

interface AppHeaderProps {
  variant?: 'light' | 'dark';
}

/**
 * Top Adaptive App Header
 * Displays the centered colorful TrainWatch wordmark blending seamlessly with the blue theme.
 * Clean, minimal, adaptive to notch/status-bar cutouts without clutter.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({ variant = 'light' }) => {
  const insets = useSafeAreaInsets();
  const isLight = variant === 'light';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: Math.max(insets.top, 12) },
      ]}
    >
      <View style={styles.centerBrand}>
        <Text style={[styles.titleTrain, isLight ? styles.textWhite : styles.textDark]}>
          Train
        </Text>
        <Text style={[styles.titleWatch, isLight ? styles.textCyan : styles.textPrimary]}>
          Watch
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  centerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTrain: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  titleWatch: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  textWhite: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.15)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  textDark: {
    color: colors.textPrimary,
  },
  textCyan: {
    color: '#BAE6FD',
    textShadowColor: 'rgba(30, 58, 138, 0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  textPrimary: {
    color: colors.primary,
  },
});
