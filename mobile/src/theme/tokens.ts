/**
 * TrainWatch Design System Tokens
 * Replicated from ref.jpg design language
 */

export const colors = {
  // Brand Gradients & Accents
  primary: '#2B66F6',
  primaryGradientStart: '#4382EC',
  primaryGradientEnd: '#6FA4F8',
  primaryDark: '#1E40AF',
  primaryLight: '#EFF6FF',

  // Backgrounds & Canvas
  background: '#F8FAFC',
  cardBackground: '#FFFFFF',
  surfaceSubtle: '#F1F5F9',

  // Typography
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Borders & Dividers
  borderSubtle: '#E2E8F0',
  borderStrong: '#CBD5E1',

  // Availability Badges
  statusAvailable: '#10B981',
  statusAvailableBg: '#ECFDF5',
  statusRac: '#F59E0B',
  statusRacBg: '#FFFBEB',
  statusWl: '#EF4444',
  statusWlBg: '#FEF2F2',
  statusRegret: '#64748B',
  statusRegretBg: '#F1F5F9',

  // Interactive Elements
  pillBg: '#F8FAFC',
  swapButtonBg: '#3B82F6',
  ctaShadow: 'rgba(59, 130, 246, 0.35)',
};

export const typography = {
  hero: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  stationTitle: {
    fontSize: 26,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  stationCode: {
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  body: {
    fontSize: 14,
    fontWeight: '400' as const,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  full: 9999,
};
