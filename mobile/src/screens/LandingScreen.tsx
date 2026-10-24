import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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
      colors={['#1E3A8A', '#2563EB', '#3B82F6']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 20 }]}
    >
      <StatusBar style="light" />

      <View style={styles.contentCenter}>
        {/* Actual Colorful Logo Text Alone */}
        <View style={styles.brandRow}>
          <Text style={styles.brandTrain}>Train</Text>
          <Text style={styles.brandWatch}>Watch</Text>
        </View>

        {/* Tagline matching the exclusive on-the-go styling */}
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

      {/* Primary CTA Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/home')}
          activeOpacity={0.88}
        >
          <Text style={styles.buttonText}>Search Trains</Text>
          <ArrowRight size={20} color="#2563EB" strokeWidth={2.4} style={styles.buttonArrow} />
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
  contentCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  brandTrain: {
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
    textShadowColor: 'rgba(0, 0, 0, 0.25)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  brandWatch: {
    fontSize: 44,
    fontWeight: '800',
    color: '#BAE6FD',
    letterSpacing: -1,
    textShadowColor: 'rgba(30, 58, 138, 0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  captionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  captionMain: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.15)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  onTheGoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 8,
  },
  captionIn: {
    fontSize: 22,
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
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  onTheGoText: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  footer: {
    width: '100%',
    paddingBottom: 24,
  },
  button: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 30,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  buttonText: {
    color: '#2563EB',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonArrow: {
    marginLeft: 8,
  },
});
