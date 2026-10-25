import { colors } from '../theme/tokens';

export interface ParsedAvailabilityStatus {
  raw: string;
  badgeLabel: string;
  modalLabel: string;
  bgColor: string;
  textColor: string;
  dotColor: string;
  isBookable: boolean;
  canTrack: boolean;
  untrackableReason?: string;
}

/**
 * Normalizes railway availability strings into UI states with strict color safety.
 * Prevents "NOT AVAILABLE" from false-matching "AVAILABLE", and correctly labels
 * REGRET and TRAIN DEPARTED as Non Bookable and untrackable.
 */
export function parseAvailabilityStatus(rawAvailability: string | null | undefined): ParsedAvailabilityStatus {
  const raw = rawAvailability || '';
  const upper = raw.trim().toUpperCase();

  if (!upper) {
    return {
      raw,
      badgeLabel: 'UNKNOWN',
      modalLabel: 'STATUS UNKNOWN',
      bgColor: colors.surfaceSubtle,
      textColor: colors.textSecondary,
      dotColor: colors.textMuted,
      isBookable: false,
      canTrack: false,
      untrackableReason: 'Availability status is not currently available.',
    };
  }

  // 1. Regret / Departed / Cannot Book / Booking Closed -> NON BOOKABLE
  if (
    upper.includes('REGRET') ||
    upper.includes('DEPARTED') ||
    upper.includes('TRAIN DEPARTED') ||
    upper.includes('CANNOT BOOK') ||
    upper.includes('BOOKING CLOSED') ||
    upper.includes('CLASS NOT EXISTS')
  ) {
    const isDeparted = upper.includes('DEPARTED');
    return {
      raw,
      badgeLabel: 'NON BOOKABLE',
      modalLabel: 'NON BOOKABLE',
      bgColor: colors.statusRegretBg,
      textColor: colors.statusRegret,
      dotColor: colors.statusRegret,
      isBookable: false,
      canTrack: false,
      untrackableReason: isDeparted
        ? 'Train has already departed from the source station.'
        : 'Waitlist limit reached (Regret). Bookings are closed for this class.',
    };
  }

  // 2. Not Available / Unavailable / No Seats (Check BEFORE checking AVAILABLE!)
  if (
    upper.includes('NOT AVAILABLE') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('NOT AVBL') ||
    upper.includes('NO SEATS') ||
    upper.includes('NOT BOOKABLE') ||
    upper.includes('NAVBL')
  ) {
    return {
      raw,
      badgeLabel: 'NOT AVAILABLE',
      modalLabel: 'NOT AVAILABLE',
      bgColor: colors.surfaceSubtle,
      textColor: colors.textSecondary,
      dotColor: colors.textMuted,
      isBookable: false,
      canTrack: false,
      untrackableReason: 'Seats are not available in this class. Tracking is not supported.',
    };
  }

  // 3. Available (Green)
  if (
    upper.includes('CURR_AVBL') ||
    upper.includes('AVAILABLE') ||
    upper.startsWith('AVL') ||
    upper === 'AVL' ||
    (upper.includes('AVL') && !upper.includes('NOT'))
  ) {
    return {
      raw,
      badgeLabel: 'AVAILABLE',
      modalLabel: 'AVAILABLE',
      bgColor: colors.statusAvailableBg,
      textColor: colors.statusAvailable,
      dotColor: colors.statusAvailable,
      isBookable: true,
      canTrack: true,
    };
  }

  // 4. RAC (Amber)
  if (upper.includes('RAC')) {
    return {
      raw,
      badgeLabel: 'RAC',
      modalLabel: 'RAC (RESERVATION AGAINST CANCELLATION)',
      bgColor: colors.statusRacBg,
      textColor: colors.statusRac,
      dotColor: colors.statusRac,
      isBookable: true,
      canTrack: true,
    };
  }

  // 5. Waitlisted (Red)
  if (
    upper.includes('WL') ||
    upper.includes('RLWL') ||
    upper.includes('GNWL') ||
    upper.includes('PQWL') ||
    upper.includes('TQWL') ||
    upper.includes('WAITLIST')
  ) {
    return {
      raw,
      badgeLabel: 'WAITLIST',
      modalLabel: 'WAITLISTED',
      bgColor: colors.statusWlBg,
      textColor: colors.statusWl,
      dotColor: colors.statusWl,
      isBookable: true,
      canTrack: true,
    };
  }

  // 6. Fallback / Unknown
  return {
    raw,
    badgeLabel: 'STATUS UNKNOWN',
    modalLabel: 'STATUS UNKNOWN',
    bgColor: colors.surfaceSubtle,
    textColor: colors.textSecondary,
    dotColor: colors.textMuted,
    isBookable: false,
    canTrack: false,
    untrackableReason: 'Status could not be determined accurately.',
  };
}
