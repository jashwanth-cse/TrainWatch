/**
 * TrainWatch Centralized Design System Tokens
 * Source of truth extracted directly from the locked HomeScreen design language.
 * All screens must consume these tokens for 100% UI/UX and color consistency.
 */

export const colors = {
  // Brand Primary & Accents (Locked to HomeScreen source of truth)
  primary: '#2563EB',
  primaryDark: '#1E40AF',
  primaryAccent: '#3B82F6',
  brandNavy: '#0A1E4A', // Used for on-the-go badge text and deep brand identity
  primaryLight: '#EFF6FF',
  primarySky: '#60A5FA',
  primaryGradientStart: '#1E40AF',
  primaryGradientEnd: '#2563EB',

  // Full HomeScreen Gradient Stops (Seamless blend from Sky Blue to White)
  gradientHomeScreen: [
    '#2563EB',
    '#3B82F6',
    '#60A5FA',
    '#93C5FD',
    '#BFDBFE',
    '#DBEAFE',
    '#EFF6FF',
    '#FFFFFF',
    '#FFFFFF',
  ] as const,
  gradientLocations: [0, 0.08, 0.17, 0.27, 0.38, 0.49, 0.60, 0.74, 1.0] as const,

  // Secondary Header Gradient (Results & Sub-screens)
  headerGradient: ['#1E40AF', '#2563EB', '#3B82F6'] as const,

  // Backgrounds & Surfaces
  background: '#F8FAFC',
  backgroundPure: '#FFFFFF',
  cardBackground: '#FFFFFF',
  surfaceSubtle: '#F8FAFC',
  surfaceActive: '#EFF6FF',

  // Glassmorphism (from HomeScreen on-the-go badge & pills)
  glassBg: 'rgba(255, 255, 255, 0.42)',
  glassBorder: 'rgba(255, 255, 255, 0.75)',
  glassSubtleBg: 'rgba(255, 255, 255, 0.18)',
  glassSubtleBorder: 'rgba(255, 255, 255, 0.28)',

  // Typography
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textTertiary: '#475569',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Borders & Dividers
  borderSubtle: '#E2E8F0',
  borderStrong: '#CBD5E1',

  // Availability Status Badges (Strict matching color language)
  statusAvailable: '#10B981',
  statusAvailableBg: '#ECFDF5',
  statusRac: '#F59E0B',
  statusRacBg: '#FFFBEB',
  statusWl: '#EF4444',
  statusWlBg: '#FEF2F2',
  statusRegret: '#64748B',
  statusRegretBg: '#F1F5F9',

  // Error & Feedback
  error: '#EF4444',
  errorBg: '#FEF2F2',
  success: '#10B981',
  successBg: '#ECFDF5',

  // Interactive Elements
  pillBg: '#F8FAFC',
  swapButtonBg: '#2563EB',
  ctaShadow: 'rgba(37, 99, 235, 0.35)',
};

export const typography = {
  hero: {
    fontSize: 28,
    fontWeight: '800' as const,
    lineHeight: 34,
    letterSpacing: -0.6,
  },
  stationName: {
    fontSize: 34,
    fontWeight: '800' as const,
    letterSpacing: -0.8,
  },
  stationCode: {
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  title: {
    fontSize: 20,
    fontWeight: '800' as const,
    letterSpacing: -0.4,
  },
  body: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  button: {
    fontSize: 17,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 40,
};

export const radius = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 28,
  full: 9999,
};

export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  cta: {
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  badge: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
};
