import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';

const { width } = Dimensions.get('window');

interface SplashScreenProps {
  onAnimationComplete: () => void;
}

/**
 * Award-Winning Brand Reveal Splash Transition
 * Play Store Best UX Award-Winning Pattern:
 * 1. Deep brand gradient with gentle light flare.
 * 2. Icon gently springs into view (0.8 -> 1.05 -> 1.0) with subtle glow.
 * 3. Typographic wordmark dissolves upward with tracking expansion.
 * 4. Tagline fades in: "Track your seats in one-go".
 * 5. Screen dissolves seamlessly into the main app shell.
 */
export const SplashScreen: React.FC<SplashScreenProps> = ({ onAnimationComplete }) => {
  const [logoScale] = useState(() => new Animated.Value(0.75));
  const [logoOpacity] = useState(() => new Animated.Value(0));
  const [glowPulse] = useState(() => new Animated.Value(0.4));
  const [textTranslateY] = useState(() => new Animated.Value(18));
  const [textOpacity] = useState(() => new Animated.Value(0));
  const [taglineOpacity] = useState(() => new Animated.Value(0));
  const [containerOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    // 1. Continuous breathing ambient glow
    const ambientLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 0.9,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0.4,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    ambientLoop.start();

    // 2. Coordinated entrance orchestration
    Animated.sequence([
      // Stage A: Logo spring reveal
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 60,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),

      // Stage B: Brand wordmark fluid rise
      Animated.parallel([
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),

      // Stage C: Tagline reveal
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),

      // Stage D: Lingering beat for recognition
      Animated.delay(650),

      // Stage E: Smooth dissolve into app
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start(() => {
      ambientLoop.stop();
      onAnimationComplete();
    });

    return () => {
      ambientLoop.stop();
    };
  }, [
    containerOpacity,
    glowPulse,
    logoOpacity,
    logoScale,
    onAnimationComplete,
    taglineOpacity,
    textOpacity,
    textTranslateY,
  ]);

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <StatusBar style="light" />

      {/* Deep cinematic brand background */}
      <LinearGradient
        colors={['#0F1E3D', '#091224', '#04070F']}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Ambient Radial Accent Flare */}
      <Animated.View
        style={[
          styles.ambientGlow,
          {
            opacity: glowPulse,
            transform: [{ scale: logoScale }],
          },
        ]}
      />

      {/* Center Branding Assembly */}
      <View style={styles.centerStage}>
        {/* Animated Brand Emblem */}
        <Animated.View
          style={[
            styles.emblemContainer,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <Image
            source={require('../../assets/brand-emblem.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Wordmark & Tagline Assembly */}
        <Animated.View
          style={[
            styles.brandTextGroup,
            {
              opacity: textOpacity,
              transform: [{ translateY: textTranslateY }],
            },
          ]}
        >
          <View style={styles.titleRow}>
            <Text style={styles.titleTrain}>Train</Text>
            <Text style={styles.titleWatch}>Watch</Text>
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: taglineOpacity }}>
          <Text style={styles.tagline}>Track your seats in one-go</Text>
        </Animated.View>
      </View>

      {/* Bottom Subtle Trust Badge */}
      <View style={styles.footer}>
        <View style={styles.liveIndicator} />
        <Text style={styles.footerText}>Real-Time IRCTC Seat Intelligence</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#091224',
  },
  ambientGlow: {
    position: 'absolute',
    width: width * 0.85,
    height: width * 0.85,
    borderRadius: (width * 0.85) / 2,
    backgroundColor: 'rgba(43, 102, 246, 0.22)',
  },
  centerStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemContainer: {
    width: 130,
    height: 130,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#2B66F6',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 12,
  },
  logoImage: {
    width: 104,
    height: 104,
  },
  brandTextGroup: {
    alignItems: 'center',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleTrain: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  titleWatch: {
    fontSize: 34,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.72)',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  liveIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  footerText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.65)',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
