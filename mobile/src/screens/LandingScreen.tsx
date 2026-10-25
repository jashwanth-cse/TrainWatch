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

      {/* Top Center: Unified Brand Logo and Tagline */}
      <View style={styles.topCenterContainer}>
        <Image
          source={require('../../assets/android-icon-foreground.png')}
          style={styles.brandLogo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="TrainWatch Logo"
        />

        {/* Tagline aligned for a vibeful matching of the word on-the-go */}
        <View style={styles.captionContainer}>
          <Text style={styles.captionMain}>Track your seats</Text>
          <View style={styles.onTheGoRow}>
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
    marginTop: 10,
  },
  brandLogo: {
    width: 295,
    height: 295,
  },
  captionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
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
  },
  onTheGoBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    paddingHorizontal: 18,
    paddingVertical: 5,
    borderRadius: 22,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  onTheGoText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0A1E4A',
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
