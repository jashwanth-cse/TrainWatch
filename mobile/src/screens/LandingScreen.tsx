import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight } from 'lucide-react-native';

export const LandingScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={[
        '#1E40AF',
        '#2563EB',
        '#3B82F6',
        '#60A5FA',
        '#93C5FD',
        '#BFDBFE',
        '#DBEAFE',
        '#EFF6FF',
        '#FFFFFF',
        '#FFFFFF',
      ]}
      locations={[0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.74, 0.86, 0.94, 1.0]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 16) + 12,
          paddingBottom: Math.max(insets.bottom, 16) + 12,
        },
      ]}
    >
      <StatusBar style="light" />

      {/* Top Center: Unique Logo Wordmark design blending with the blue */}
      <View style={styles.topCenterContainer}>
        <View style={styles.wordmarkContainer}>
          <Image
            source={require('../../assets/brand-wordmark.png')}
            style={styles.brandWordmark}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="TrainWatch Logo"
          />
        </View>

        {/* Tagline aligned for a vibeful matching of the word on-the-go */}
        <View style={styles.captionContainer}>
          <Text style={styles.captionMain}>Track your seats</Text>
          <View style={styles.onTheGoRow}>
            <Text style={styles.captionIn}>in</Text>
            <View style={styles.onTheGoBadge}>
              <Text style={styles.onTheGoText}>on-the-go</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.middleSpace} />

      {/* Primary CTA Button on the white lower section */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/home')}
          activeOpacity={0.88}
        >
          <Text style={styles.buttonText}>Search Trains</Text>
          <ArrowRight size={20} color="#FFFFFF" strokeWidth={2.4} style={styles.buttonArrow} />
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  topCenterContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  wordmarkContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  brandWordmark: {
    width: 280,
    height: 54,
  },
  captionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  captionMain: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  onTheGoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 8,
  },
  captionIn: {
    fontSize: 24,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.92)',
    fontStyle: 'italic',
  },
  onTheGoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 22,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  onTheGoText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  middleSpace: {
    flex: 1,
  },
  footer: {
    width: '100%',
    paddingBottom: 16,
  },
  button: {
    backgroundColor: '#2563EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 30,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonArrow: {
    marginLeft: 8,
  },
});
