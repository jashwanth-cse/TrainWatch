import React, { useState } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  Animated,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { colors, radius, spacing, shadows } from '../theme/tokens';

export interface ResponsiveButtonProps {
  onPress: () => void;
  title: string;
  variant?: 'primary' | 'outline' | 'glass' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

/**
 * ResponsiveButton
 * Production-grade tactile button with instantaneous press response,
 * native spring scale micro-interaction, and zero gesture delay.
 */
export const ResponsiveButton: React.FC<ResponsiveButtonProps> = ({
  onPress,
  title,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'right',
  style,
  textStyle,
  accessibilityLabel,
}) => {
  const [scaleAnim] = useState(() => new Animated.Value(1));

  const handlePressIn = () => {
    if (disabled || loading) return;
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    if (disabled || loading) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

  const isPrimary = variant === 'primary';
  const isOutline = variant === 'outline';
  const isGlass = variant === 'glass';

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        pressRetentionOffset={{ top: 20, left: 20, bottom: 20, right: 20 }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        style={({ pressed }) => [
          styles.baseButton,
          isPrimary && styles.primaryButton,
          isOutline && styles.outlineButton,
          isGlass && styles.glassButton,
          pressed && styles.pressedState,
          disabled && styles.disabledButton,
        ]}
      >
        {icon && iconPosition === 'left' && !loading ? icon : null}

        <Text
          style={[
            styles.baseText,
            isPrimary && styles.primaryText,
            isOutline && styles.outlineText,
            isGlass && styles.glassText,
            disabled && styles.disabledText,
            textStyle,
          ]}
        >
          {loading ? 'Processing...' : title}
        </Text>

        {icon && iconPosition === 'right' && !loading ? icon : null}
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    ...shadows.cta,
  },
  outlineButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  glassButton: {
    backgroundColor: colors.glassBg,
    borderWidth: 1.2,
    borderColor: colors.glassBorder,
    ...shadows.badge,
  },
  pressedState: {
    opacity: 0.92,
  },
  disabledButton: {
    opacity: 0.55,
    shadowOpacity: 0,
    elevation: 0,
  },
  baseText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  primaryText: {
    color: '#FFFFFF',
  },
  outlineText: {
    color: colors.primary,
  },
  glassText: {
    color: colors.brandNavy,
  },
  disabledText: {
    color: colors.textMuted,
  },
});
