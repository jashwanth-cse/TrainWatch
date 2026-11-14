import React, { useCallback, useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CheckCircle2, X } from 'lucide-react-native';
import { colors } from '../theme/tokens';

export interface UpdateToastProps {
  visible: boolean;
  version: string;
  onDismiss: () => void;
  durationMs?: number;
}

export const UpdateToast: React.FC<UpdateToastProps> = ({
  visible,
  version,
  onDismiss,
  durationMs = 4500,
}) => {
  const [opacity] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(20));

  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 20,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [opacity, translateY, onDismiss]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        handleDismiss();
      }, durationMs);

      return () => clearTimeout(timer);
    } else {
      opacity.setValue(0);
      translateY.setValue(20);
    }
  }, [visible, durationMs, handleDismiss, opacity, translateY]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.toast}>
        <View style={styles.iconCircle}>
          <CheckCircle2 size={18} color={colors.statusAvailable} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>App Updated Successfully</Text>
          <Text style={styles.subtitle}>You are now running version {version}</Text>
        </View>
        <TouchableOpacity
          onPress={handleDismiss}
          style={styles.closeButton}
          activeOpacity={0.7}
          accessibilityLabel="Dismiss confirmation"
        >
          <X size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.statusAvailableBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  closeButton: {
    padding: 6,
    borderRadius: 8,
  },
});
