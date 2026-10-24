import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme/tokens';

interface AppHeaderProps {
  variant?: 'light' | 'dark';
}

/**
 * Top Adaptive App Header
 * Displays the transparent brand icon (somewhat smaller-to-middle size) centered above
 * the TrainWatch wordmark logo, smoothly blending into the blue atmosphere.
 */
export const AppHeader: React.FC<AppHeaderProps> = () => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 8) }]}>
      <Image
        source={require('../../assets/android-icon-foreground.png')}
        style={styles.brandIcon}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="TrainWatch Icon"
      />
      <Image
        source={require('../../assets/brand-wordmark.png')}
        style={styles.wordmarkImage}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="TrainWatch"
      />
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
  brandIcon: {
    width: 68,
    height: 68,
    marginBottom: -4,
  },
  wordmarkImage: {
    width: 210,
    height: 40.5,
  },
});
