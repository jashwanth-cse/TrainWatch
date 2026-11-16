import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Circle, Line, G, Rect, Path, Defs, RadialGradient, Stop } from 'react-native-svg';
import { colors, radius, spacing } from '../theme/tokens';
import { Sparkles } from 'lucide-react-native';

const RAILWAY_FACTS = [
  'Indian Railways allows passengers to book different berths on the same train.',
  'Smart Split evaluates station-wise quota boundaries to find hidden confirmed berths.',
  'Scanning intermediate junction hubs to stitch seamless confirmed travel.',
  'Did you know? Switching seats once can turn a Waitlist into a Confirmed berth.',
  'Optimizing telescopic fare slabs ensures you get the lowest surcharge possible.',
  'You stay comfortably on the same train — just shift your seat at the junction.',
];

const SEARCH_STEPS = [
  'Scanning timetable & junction stations...',
  'Evaluating intermediate berth quotas...',
  'Synthesizing confirmed multi-leg options...',
];

interface NostalgicTrainLoaderProps {
  trainNumber?: string;
  source?: string;
  destination?: string;
  travelClass?: string;
}

export const NostalgicTrainLoader: React.FC<NostalgicTrainLoaderProps> = ({
  trainNumber,
  source,
  destination,
  travelClass,
}) => {
  // Train rotation around circular track
  const [rotateAnim] = useState(() => new Animated.Value(0));

  // Station pulse animation
  const [pulseAnim] = useState(() => new Animated.Value(1));

  // Fact index and fade animation
  const [factIndex, setFactIndex] = useState(0);
  const [factFadeAnim] = useState(() => new Animated.Value(1));

  // Step tracker based on elapsed time
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    // 1. Train 360 degree loop
    const spinLoop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 2800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spinLoop.start();

    // 2. Center hub pulsating ring
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    // 3. Facts rotation timer
    const factInterval = setInterval(() => {
      Animated.timing(factFadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setFactIndex((prev) => (prev + 1) % RAILWAY_FACTS.length);
        Animated.timing(factFadeAnim, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }).start();
      });
    }, 2800);

    // 4. Search step progression
    const step1Timer = setTimeout(() => setStepIndex(1), 700);
    const step2Timer = setTimeout(() => setStepIndex(2), 1600);

    return () => {
      spinLoop.stop();
      pulseLoop.stop();
      clearInterval(factInterval);
      clearTimeout(step1Timer);
      clearTimeout(step2Timer);
    };
  }, [factFadeAnim, pulseAnim, rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Generate 24 sleepers evenly around the circle
  const sleepers = Array.from({ length: 24 }).map((_, i) => {
    const angle = (i * 360) / 24;
    const rad = (angle * Math.PI) / 180;
    const rInner = 66;
    const rOuter = 84;
    const x1 = 100 + rInner * Math.cos(rad);
    const y1 = 100 + rInner * Math.sin(rad);
    const x2 = 100 + rOuter * Math.cos(rad);
    const y2 = 100 + rOuter * Math.sin(rad);
    return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#BFDBFE" strokeWidth="2" strokeLinecap="round" />;
  });

  return (
    <View style={styles.container}>
      {/* Route & Train Header Tag */}
      {trainNumber && (
        <View style={styles.headerTag}>
          <Text style={styles.headerTagText}>
            Train {trainNumber} • {source || 'Origin'} ➔ {destination || 'Dest'}
            {travelClass ? ` • ${travelClass}` : ''}
          </Text>
        </View>
      )}

      {/* Circular Rail Track & Nostalgic Train */}
      <View style={styles.trackContainer}>
        {/* SVG Track & Sleepers */}
        <Svg width={200} height={200} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#3B82F6" stopOpacity="0.35" />
              <Stop offset="70%" stopColor="#2563EB" stopOpacity="0.1" />
              <Stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
            </RadialGradient>
          </Defs>

          {/* Central Hub Glow */}
          <Circle cx="100" cy="100" r="42" fill="url(#hubGlow)" />

          {/* Cross Sleepers */}
          {sleepers}

          {/* Outer and Inner Circular Rails */}
          <Circle cx="100" cy="100" r="84" stroke="#93C5FD" strokeWidth="2.5" fill="none" />
          <Circle cx="100" cy="100" r="66" stroke="#93C5FD" strokeWidth="2.5" fill="none" />

          {/* Central Station Hub Circle */}
          <Circle cx="100" cy="100" r="16" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="2" />
          <Circle cx="100" cy="100" r="7" fill="#2563EB" />
        </Svg>

        {/* Pulsing Central Hub Ring */}
        <Animated.View
          style={[
            styles.pulseRing,
            {
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />

        {/* Nostalgic Train Circling the Track */}
        <Animated.View
          style={[
            styles.trainSpinnerLayer,
            {
              transform: [{ rotate: spin }],
            },
          ]}
        >
          {/* Miniature Train: Locomotive + Coach positioned on the top circumference */}
          <View style={styles.trainWrapper}>
            <Svg width={52} height={22} viewBox="0 0 52 22">
              <G>
                {/* Coach 1 (Trailing passenger car) */}
                <Rect x="2" y="5" width="18" height="12" rx="3" fill="#1E40AF" />
                <Rect x="5" y="7" width="4" height="4" rx="1" fill="#93C5FD" />
                <Rect x="11" y="7" width="4" height="4" rx="1" fill="#93C5FD" />
                <Circle cx="6" cy="18" r="2.2" fill="#0F172A" />
                <Circle cx="15" cy="18" r="2.2" fill="#0F172A" />

                {/* Coupler link */}
                <Line x1="20" y1="11" x2="24" y2="11" stroke="#475569" strokeWidth="2" />

                {/* Locomotive Engine (Leading car) */}
                <Path
                  d="M 24 7 L 38 7 C 42 7 46 9 47 13 L 47 17 L 24 17 Z"
                  fill="#2563EB"
                />
                <Rect x="26" y="8" width="5" height="4" rx="1" fill="#FFFFFF" />
                <Rect x="34" y="8" width="6" height="4" rx="1" fill="#BFDBFE" />
                {/* Smokestack */}
                <Rect x="41" y="3" width="3" height="4" rx="1" fill="#1D4ED8" />
                {/* Headlight beam */}
                <Circle cx="48" cy="12" r="2.2" fill="#FBBF24" />
                <Path d="M 48 12 L 52 9 L 52 15 Z" fill="#FDE68A" opacity="0.6" />
                {/* Engine wheels */}
                <Circle cx="28" cy="18" r="2.2" fill="#0F172A" />
                <Circle cx="37" cy="18" r="2.2" fill="#0F172A" />
                <Circle cx="44" cy="18" r="2.2" fill="#0F172A" />
              </G>
            </Svg>
          </View>
        </Animated.View>
      </View>

      {/* Progress Step Phase */}
      <View style={styles.stepBox}>
        <View style={styles.stepDot} />
        <Text style={styles.stepText}>{SEARCH_STEPS[stepIndex]}</Text>
      </View>

      {/* Moving Railway Facts Ticker */}
      <View style={styles.factCard}>
        <View style={styles.factHeader}>
          <Sparkles size={14} color="#2563EB" strokeWidth={2.4} style={{ marginRight: 6 }} />
          <Text style={styles.factTitle}>Smart Split Fact</Text>
        </View>
        <Animated.View style={{ opacity: factFadeAnim }}>
          <Text style={styles.factText}>{RAILWAY_FACTS[factIndex]}</Text>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  headerTag: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: spacing.md,
  },
  headerTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E40AF',
    letterSpacing: 0.2,
  },
  trackContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: spacing.sm,
  },
  pulseRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(59, 130, 246, 0.45)',
  },
  trainSpinnerLayer: {
    position: 'absolute',
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  trainWrapper: {
    position: 'absolute',
    top: 14, // Aligned with the circular track path
    left: 74,
  },
  stepBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginRight: 8,
  },
  stepText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  factCard: {
    marginTop: spacing.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1.2,
    borderColor: '#DBEAFE',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    width: '100%',
    maxWidth: 340,
    minHeight: 86,
    justifyContent: 'center',
  },
  factHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  factTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2563EB',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  factText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
    lineHeight: 18,
  },
});
