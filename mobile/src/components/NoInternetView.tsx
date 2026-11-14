import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Svg, {
  Path,
  Rect,
  Circle,
  G,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
} from 'react-native-svg';
import { Wifi, RefreshCw } from 'lucide-react-native';
import { openNetworkSettings } from '../services/networkService';

interface NoInternetViewProps {
  onRetry?: () => void;
  isRetrying?: boolean;
  compact?: boolean;
  title?: string;
  description?: string;
}

/**
 * Custom SVG Illustration: Themed Wi-Fi Router with Severed/Broken Wire and Electric Spark.
 * Styled in TrainWatch brand colors: Deep Navy (#091224), Cobalt (#2563EB), Warning Spark (#EF4444, #F59E0B).
 */
export const BrokenWireRouterSvg: React.FC<{ size?: number }> = ({ size = 120 }) => {
  return (
    <Svg width={size} height={size * 0.85} viewBox="0 0 200 170" fill="none">
      <Defs>
        <SvgGradient id="routerBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#1E293B" />
          <Stop offset="100%" stopColor="#0F172A" />
        </SvgGradient>
        <SvgGradient id="signalOffGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#EF4444" stopOpacity="0.8" />
          <Stop offset="100%" stopColor="#F87171" stopOpacity="0.2" />
        </SvgGradient>
        <SvgGradient id="sparkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#F59E0B" />
          <Stop offset="100%" stopColor="#EF4444" />
        </SvgGradient>
      </Defs>

      {/* Disconnected Signal Arcs (Broken Wi-Fi waves above antennas) */}
      <Path
        d="M60 40 C75 25, 125 25, 140 40"
        stroke="#EF4444"
        strokeWidth="3"
        strokeDasharray="4 4"
        strokeLinecap="round"
      />
      <Path
        d="M75 52 C85 42, 115 42, 125 52"
        stroke="#F87171"
        strokeWidth="2.5"
        strokeDasharray="3 3"
        strokeLinecap="round"
      />

      {/* Cross mark over Wi-Fi waves */}
      <Path
        d="M93 25 L107 39 M107 25 L93 39"
        stroke="#EF4444"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Left Antenna */}
      <Path
        d="M68 95 L52 48"
        stroke="#475569"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <Circle cx="50" cy="45" r="4.5" fill="#3B82F6" />

      {/* Right Antenna */}
      <Path
        d="M132 95 L148 48"
        stroke="#475569"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <Circle cx="150" cy="45" r="4.5" fill="#3B82F6" />

      {/* Router Main Chassis */}
      <Rect
        x="35"
        y="90"
        width="130"
        height="38"
        rx="10"
        fill="url(#routerBodyGrad)"
        stroke="#334155"
        strokeWidth="2"
      />

      {/* Subtle Router Glow Bar */}
      <Rect
        x="45"
        y="96"
        width="110"
        height="2"
        rx="1"
        fill="#3B82F6"
        fillOpacity="0.4"
      />

      {/* Front Indicator LED Lights */}
      <Circle cx="55" cy="110" r="3" fill="#10B981" />
      <Circle cx="70" cy="110" r="3" fill="#10B981" />
      <Circle cx="85" cy="110" r="3" fill="#3B82F6" />
      {/* Red Alert Offline LED with pulsing ring */}
      <Circle cx="135" cy="110" r="5" fill="#EF4444" fillOpacity="0.25" />
      <Circle cx="135" cy="110" r="3" fill="#EF4444" />
      <Circle cx="148" cy="110" r="2.5" fill="#64748B" />

      {/* Router Base Feet */}
      <Rect x="48" y="128" width="14" height="4" rx="2" fill="#1E293B" />
      <Rect x="138" y="128" width="14" height="4" rx="2" fill="#1E293B" />

      {/* Severed / Broken Network Cable (Left Section from Router) */}
      <Path
        d="M40 118 C25 125, 20 145, 42 152"
        stroke="#475569"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Frayed wire end */}
      <Path d="M42 152 L47 150 M42 152 L46 155" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />

      {/* Electrical Spark at the Cable Break */}
      <G transform="translate(52, 145)">
        {/* Flash Star */}
        <Path
          d="M10 0 L13 7 L20 10 L13 13 L10 20 L7 13 L0 10 L7 7 Z"
          fill="url(#sparkGrad)"
        />
        <Circle cx="10" cy="10" r="2" fill="#FFFFFF" />
        <Path d="M3 3 L-1 0 M17 3 L21 0 M3 17 L-1 20 M17 17 L21 20" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />
      </G>

      {/* Severed Cable (Right Section trailing off disconnected) */}
      <Path
        d="M80 156 C95 160, 115 158, 125 164"
        stroke="#334155"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="6 2"
      />
      {/* Frayed end matching */}
      <Path d="M78 156 L73 154 M78 156 L74 158" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
};

export const NoInternetView: React.FC<NoInternetViewProps> = ({
  onRetry,
  isRetrying = false,
  compact = false,
  title = 'No Internet Connection',
  description = 'You appear to be offline. Turn on mobile data or Wi-Fi to search trains and check live seat availability.',
}) => {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {/* Broken Wire Router Vector Illustration */}
      <View style={styles.illustrationWrapper}>
        <BrokenWireRouterSvg size={compact ? 90 : 120} />
      </View>

      {/* Title & Description */}
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      <Text style={[styles.description, compact && styles.descriptionCompact]}>
        {description}
      </Text>

      {/* Action Buttons */}
      <View style={[styles.actionRow, compact && styles.actionRowCompact]}>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.8}
          onPress={() => void openNetworkSettings()}
        >
          <Wifi size={16} color="#FFFFFF" style={styles.btnIcon} />
          <Text style={styles.primaryButtonText}>Enable Wi-Fi / Data</Text>
        </TouchableOpacity>

        {Boolean(onRetry) && (
          <TouchableOpacity
            style={styles.secondaryButton}
            activeOpacity={0.8}
            onPress={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color="#2563EB" style={styles.btnIcon} />
            ) : (
              <RefreshCw size={15} color="#2563EB" style={styles.btnIcon} />
            )}
            <Text style={styles.secondaryButtonText}>
              {isRetrying ? 'Checking...' : 'Retry'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    width: '100%',
    backgroundColor: 'transparent',
  },
  containerCompact: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  illustrationWrapper: {
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  titleCompact: {
    fontSize: 15,
    marginBottom: 4,
  },
  description: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
    maxWidth: 300,
  },
  descriptionCompact: {
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 14,
    maxWidth: 260,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
    width: '100%',
  },
  actionRowCompact: {
    gap: 8,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 13.5,
    fontWeight: '600',
  },
  btnIcon: {
    marginRight: 6,
  },
});
