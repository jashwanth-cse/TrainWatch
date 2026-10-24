import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme/tokens';

interface AppHeaderProps {
  variant?: 'light' | 'dark';
  includeTopInset?: boolean;
}

/**
 * Top Adaptive App Header
 * Displays the complete TrainWatch brand logo (circular emblem + wordmark together from android-icon-foreground.png)
 * smoothly blending into the blue atmosphere with medium spacing.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({ includeTopInset = false }) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, includeTopInset && { paddingTop: Math.max(insets.top, 8) }]}>
      <Image
        source={require('../../assets/android-icon-foreground.png')}
        style={styles.brandLogo}
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
    paddingBottom: 2,
  },
  brandLogo: {
    width: 130,
    height: 130,
  },
});
