import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../theme/tokens';
import { ArrowRight } from 'lucide-react-native';

export const LandingScreen: React.FC = () => {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TrainWatch</Text>
      <Text style={styles.subtitle}>Track your seats in one-go</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace('/home')}
        activeOpacity={0.8}
      >
        <View style={styles.buttonContent}>
          <Text style={styles.buttonText}>Go to Search</Text>
          <ArrowRight size={18} color="#FFFFFF" strokeWidth={2.4} style={{ marginLeft: 6 }} />
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
