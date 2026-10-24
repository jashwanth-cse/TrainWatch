import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme/tokens';

interface AppHeaderProps {
  variant?: 'light' | 'dark';
}

/**
 * Top Adaptive App Header
 * Displays the centered colorful TrainWatch wordmark blending seamlessly with the blue atmosphere.
 */
export const AppHeader: React.FC<AppHeaderProps> = () => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 10) }]}>
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
  wordmarkImage: {
    width: 220,
    height: 42.5,
  },
});
