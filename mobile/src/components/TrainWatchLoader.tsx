import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { TrainFront } from 'lucide-react-native';

export interface TrainWatchLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  subMessage?: string;
}

/**
 * TrainWatch Innovative UI/UX Loader
 * Designed with a high-speed orbital pulse, glowing ambient radar,
 * and dynamic train glide trajectory running at 60 FPS.
 */
export const TrainWatchLoader: React.FC<TrainWatchLoaderProps> = ({
  size = 'md',
  message,
  subMessage,
}) => {
  const [spinValue] = useState(() => new Animated.Value(0));
  const [pulseValue] = useState(() => new Animated.Value(0.85));
  const [wave1] = useState(() => new Animated.Value(0));
  const [wave2] = useState(() => new Animated.Value(0));
  const [wave3] = useState(() => new Animated.Value(0));
  const [floatValue] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // 1. Continuous Orbital Spin
    const spinAnim = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    // 2. Breathing Pulse Aura
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1.15,
          duration: 900,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 0.85,
          duration: 900,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }),
      ])
    );

    // 3. Subtle Vertical Float (Train motion)
    const floatAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(floatValue, {
          toValue: -3,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(floatValue, {
          toValue: 2,
          duration: 600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    // 4. Staggered Quantum Dot Wave
    const waveLoop = Animated.loop(
      Animated.stagger(180, [
        Animated.sequence([
          Animated.timing(wave1, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(wave1, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(wave2, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(wave2, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(wave3, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(wave3, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    spinAnim.start();
    pulseAnim.start();
    floatAnim.start();
    waveLoop.start();

    return () => {
      spinAnim.stop();
      pulseAnim.stop();
      floatAnim.stop();
      waveLoop.stop();
    };
  }, [spinValue, pulseValue, floatValue, wave1, wave2, wave3]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const isSmall = size === 'sm';
  const isLarge = size === 'lg';

  const containerDim = isSmall ? 40 : isLarge ? 88 : 64;
  const trainIconSize = isSmall ? 16 : isLarge ? 32 : 24;

  return (
    <View style={[styles.wrapper, isSmall && styles.wrapperSmall]}>
      <View style={[styles.canvas, { width: containerDim, height: containerDim }]}>
        {/* Outer Pulsing Aura Ring */}
        <Animated.View
          style={[
            styles.auraRing,
            {
              width: containerDim,
              height: containerDim,
              borderRadius: containerDim / 2,
              transform: [{ scale: pulseValue }],
            },
          ]}
        />

        {/* Orbital Segmented Ring */}
        <Animated.View
          style={[
            styles.orbitalRing,
            {
              width: containerDim,
              height: containerDim,
              borderRadius: containerDim / 2,
              transform: [{ rotate: spin }],
            },
          ]}
        >
          <View style={[styles.orbitalDot, isSmall && styles.orbitalDotSmall]} />
          <View style={[styles.orbitalTail, isSmall && styles.orbitalTailSmall]} />
        </Animated.View>

        {/* Center Floating Train Emblem */}
        <Animated.View
          style={[
            styles.centerEmblem,
            {
              width: containerDim - (isSmall ? 12 : 20),
              height: containerDim - (isSmall ? 12 : 20),
              borderRadius: (containerDim - (isSmall ? 12 : 20)) / 2,
              transform: [{ translateY: floatValue }],
            },
          ]}
        >
          <TrainFront
            size={trainIconSize}
            color={colors.primary}
            strokeWidth={2.4}
          />
        </Animated.View>
      </View>

      {/* Synchronized Traveling Quantum Dots */}
      <View style={styles.dotsRow}>
        <Animated.View
          style={[
            styles.dot,
            isSmall && styles.dotSmall,
            {
              opacity: wave1.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [
                {
                  scale: wave1.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.4] }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.dot,
            isSmall && styles.dotSmall,
            {
              opacity: wave2.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [
                {
                  scale: wave2.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.4] }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.dot,
            isSmall && styles.dotSmall,
            {
              opacity: wave3.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [
                {
                  scale: wave3.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.4] }),
                },
              ],
            },
          ]}
        />
      </View>

      {/* Typographic Context */}
      {message ? (
        <Text style={[styles.message, isSmall && styles.messageSmall]}>
          {message}
        </Text>
      ) : null}

      {subMessage ? (
        <Text style={styles.subMessage}>{subMessage}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  wrapperSmall: {
    paddingVertical: spacing.xs,
  },
  canvas: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  auraRing: {
    position: 'absolute',
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.28)',
  },
  orbitalRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: colors.primary,
    borderRightColor: 'rgba(96, 165, 250, 0.65)',
  },
  orbitalDot: {
    position: 'absolute',
    top: -3,
    alignSelf: 'center',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  orbitalDotSmall: {
    top: -2,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  orbitalTail: {
    position: 'absolute',
    bottom: -2,
    alignSelf: 'center',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(96, 165, 250, 0.4)',
  },
  orbitalTailSmall: {
    bottom: -1,
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  centerEmblem: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1.2,
    borderColor: 'rgba(226, 232, 240, 0.9)',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primary,
  },
  dotSmall: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  message: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.xs + 2,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  messageSmall: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  subMessage: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
});
