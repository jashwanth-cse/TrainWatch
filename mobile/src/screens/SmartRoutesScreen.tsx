import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { radius } from '../theme/tokens';
import {
  computeComparisonMetrics,
  fetchSmartRoutes,
  resolveSolutionPresentation,
  SmartRoutesResultData,
  SmartRouteSolution,
  SolutionPresentation,
  SubLeg,
} from '../services/smartRouteService';
import { getStationName } from '../services/stationService';
import { NostalgicTrainLoader } from '../components/NostalgicTrainLoader';
import { BookingTrickModal } from '../components/BookingTrickModal';
import {
  ArrowLeft,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Info,
  ShieldCheck,
  Split,
  TrainFront,
  ChevronDown,
  ChevronUp,
  Zap,
  MapPin,
} from 'lucide-react-native';

interface OptionTheme {
  primary: string;
  gradient: [string, string];
  accent: string;
  badgeBg: string;
  badgeText: string;
  lightBg: string;
  borderColor: string;
}

const OPTION_THEMES: OptionTheme[] = [
  // Option 1 (Royal Sapphire)
  {
    primary: '#1E40AF',
    gradient: ['#1E3A8A', '#2563EB'],
    accent: '#2563EB',
    badgeBg: '#EFF6FF',
    badgeText: '#1D4ED8',
    lightBg: '#F8FAFC',
    borderColor: '#BFDBFE',
  },
  // Option 2 (Emerald Forest)
  {
    primary: '#065F46',
    gradient: ['#065F46', '#059669'],
    accent: '#059669',
    badgeBg: '#ECFDF5',
    badgeText: '#047857',
    lightBg: '#F0FDF4',
    borderColor: '#A7F3D0',
  },
  // Option 3 (Royal Violet)
  {
    primary: '#5B21B6',
    gradient: ['#5B21B6', '#7C3AED'],
    accent: '#7C3AED',
    badgeBg: '#F5F3FF',
    badgeText: '#6D28D9',
    lightBg: '#FAF5FF',
    borderColor: '#DDD6FE',
  },
  // Option 4 (Warm Amber)
  {
    primary: '#9A3412',
    gradient: ['#9A3412', '#D97706'],
    accent: '#D97706',
    badgeBg: '#FFFBEB',
    badgeText: '#B45309',
    lightBg: '#FEFCE8',
    borderColor: '#FDE68A',
  },
  // Option 5 (Deep Teal)
  {
    primary: '#115E59',
    gradient: ['#115E59', '#0D9488'],
    accent: '#0D9488',
    badgeBg: '#F0FDFA',
    badgeText: '#0F766E',
    lightBg: '#F0FDFA',
    borderColor: '#99F6E4',
  },
];

export const SmartRoutesScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    trainNo: string;
    trainName?: string;
    source: string;
    sourceName?: string;
    destination: string;
    destinationName?: string;
    date: string;
    displayDate?: string;
    travelClass: string;
    quota?: string;
    directStatus?: string;
    directFare?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<SmartRoutesResultData | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number>(0);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const [expandedOptionIds, setExpandedOptionIds] = useState<Record<string, boolean>>({});
  const [trickModalState, setTrickModalState] = useState<{
    visible: boolean;
    solution: SmartRouteSolution | null;
    optionNumber: number;
  }>({
    visible: false,
    solution: null,
    optionNumber: 1,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggleOptionExpansion = useCallback((solKey: string) => {
    setExpandedOptionIds((prev) => ({
      ...prev,
      [solKey]: !prev[solKey],
    }));
  }, []);

  // Normalize date format to YYYY-MM-DD
  const formatToIsoDate = (d: string): string => {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    // Handle DD-MM-YYYY
    const parts = d.split('-');
    if (parts.length === 3 && parts[0].length <= 2) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
    return d;
  };

  const isoDate = formatToIsoDate(params.date || '');

  const loadSmartRoutes = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      setToastNotice(null);

      try {
        const res = await fetchSmartRoutes({
          trainNo: params.trainNo || '',
          origin: params.source || '',
          destination: params.destination || '',
          journeyDate: isoDate,
          travelClass: params.travelClass || 'SL',
          quota: params.quota || 'GN',
          forceRefresh,
        });

        setResultData(res.data);
        setIsFromCache(res.isFromCache);
        setRemainingSec(res.remainingSeconds);

        if (res.rateLimited) {
          const mins = Math.floor(res.remainingSeconds / 60);
          const secs = res.remainingSeconds % 60;
          setToastNotice(
            `Data is cached. Next fresh lookup available in ${mins}m ${secs}s.`
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to discover smart routes.';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [isoDate, params.destination, params.quota, params.source, params.trainNo, params.travelClass]
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadSmartRoutes();
      }
    });
    return () => {
      active = false;
    };
  }, [loadSmartRoutes]);

  // Live countdown timer for the 5-minute cache
  useEffect(() => {
    if (remainingSec > 0) {
      timerRef.current = setInterval(() => {
        setRemainingSec((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [remainingSec]);

  const handleManualRefresh = () => {
    if (remainingSec > 0) {
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      setToastNotice(
        `Results are cached for 5 mins to prevent server overload. Refresh in ${mins}m ${secs}s.`
      );
      setTimeout(() => setToastNotice(null), 4000);
      return;
    }
    loadSmartRoutes(true);
  };

  const bestSolution: SmartRouteSolution | null =
    resultData && resultData.solutions && resultData.solutions.length > 0
      ? resultData.solutions[0]
      : null;

  const bestPres: SolutionPresentation | null = bestSolution
    ? resolveSolutionPresentation(bestSolution, isoDate)
    : null;

  const alternativeSolutions: SmartRouteSolution[] =
    resultData && resultData.solutions && resultData.solutions.length > 1
      ? resultData.solutions.slice(1)
      : [];

  const {
    directStatusText,
    directFareNum,
    fareDelta: displayedFareDelta,
    surchargePct: displayedSurchargePct,
  } = computeComparisonMetrics(resultData, bestSolution, params.directStatus, params.directFare);

  const renderSolutionTimeline = (
    sol: SmartRouteSolution,
    accentColor = '#2563EB',
    themeBadgeBg?: string,
    themeBorder?: string,
    themePrimary?: string
  ) => (
    <View style={styles.timelineContainer}>
      {sol.legs.map((leg: SubLeg, legIdx: number) => {
        const isLast = legIdx === sol.legs.length - 1;
        const isLegRac = (leg.status || '').toUpperCase() === 'RAC';
        return (
          <React.Fragment key={legIdx}>
            <View
              style={[
                styles.legCard,
                themeBadgeBg ? { borderLeftColor: accentColor, borderLeftWidth: 3 } : null,
              ]}
            >
              <View style={styles.legHeaderRow}>
                <View
                  style={[
                    styles.legNumberCircle,
                    themeBadgeBg
                      ? { backgroundColor: themeBadgeBg, borderColor: themeBorder }
                      : null,
                  ]}
                >
                  <Text style={[styles.legNumberText, themePrimary ? { color: themePrimary } : null]}>
                    Leg {leg.leg_number}
                  </Text>
                </View>
                <View
                  style={[
                    styles.legStatusPill,
                    isLegRac ? { backgroundColor: '#FEF3C7' } : null,
                  ]}
                >
                  <CheckCircle2
                    size={12}
                    color={isLegRac ? '#B45309' : '#15803D'}
                    strokeWidth={2.4}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.legStatusPillText,
                      isLegRac ? { color: '#B45309' } : null,
                    ]}
                  >
                    {leg.raw_status}
                  </Text>
                </View>
                {leg.fare !== null && (
                  <Text style={styles.legFareText}>₹{leg.fare}</Text>
                )}
              </View>

              <View style={styles.legRouteRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.legStationCode}>{leg.from_station}</Text>
                  <Text style={styles.legStationName} numberOfLines={1}>
                    {getStationName(leg.from_station)}
                  </Text>
                  <Text style={styles.legTimeText}>
                    {leg.journey_date ? `${leg.journey_date} • ` : ''}
                    {leg.departure_time || 'Dep'}
                  </Text>
                </View>
                <View style={styles.legArrowBlock}>
                  <Text style={styles.legDistanceText}>{leg.distance_km} km</Text>
                  <View style={styles.legLine}>
                    <View style={[styles.legDot, { backgroundColor: accentColor }]} />
                    <View style={styles.legDash} />
                    <View style={[styles.legDot, { backgroundColor: accentColor }]} />
                  </View>
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={styles.legStationCode}>{leg.to_station}</Text>
                  <Text style={[styles.legStationName, { textAlign: 'right' }]} numberOfLines={1}>
                    {getStationName(leg.to_station)}
                  </Text>
                  <Text style={styles.legTimeText}>{leg.arrival_time || 'Arr'}</Text>
                </View>
              </View>
            </View>

            {!isLast && (
              <View style={styles.shiftConnector}>
                <View style={styles.shiftLineVertical} />
                <View
                  style={[
                    styles.shiftBadge,
                    themeBadgeBg
                      ? { backgroundColor: themeBadgeBg, borderColor: themeBorder }
                      : null,
                  ]}
                >
                  <Split
                    size={14}
                    color={themePrimary || '#D97706'}
                    strokeWidth={2.4}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.shiftBadgeText, themePrimary ? { color: themePrimary } : null]}>
                    Shift seat at {leg.to_station} ({getStationName(leg.to_station)}) (Same Train)
                  </Text>
                </View>
                <View style={styles.shiftLineVertical} />
              </View>
            )}
          </React.Fragment>
        );
      })}

      {(sol.tier === 'TIER_2_ORIGIN_EXTENSION' || Boolean(sol.boarding_station)) &&
        sol.boarding_station && (
          <View style={styles.boardingPointBanner}>
            <MapPin size={14} color="#047857" strokeWidth={2.4} style={{ marginRight: 6 }} />
            <Text style={styles.boardingPointText}>
              Set IRCTC Boarding Station to {sol.boarding_station} ({getStationName(sol.boarding_station)})
            </Text>
          </View>
        )}
    </View>
  );

  const renderBookingGuideBox = (
    pres: SolutionPresentation,
    borderColor = '#2563EB',
    noteColor = '#2563EB'
  ) => (
    <View style={[styles.bookingGuideBox, { borderLeftColor: borderColor }]}>
      <Text style={styles.bookingGuideTitle}>How to book on IRCTC:</Text>
      {pres.guide_steps.map((stepText: string, idx: number) => (
        <Text key={idx} style={styles.bookingGuideStep}>
          {stepText}
        </Text>
      ))}
      <Text style={[styles.bookingGuideNote, { color: noteColor }]}>{pres.guide_note}</Text>
    </View>
  );

  return (
    <LinearGradient
      colors={['#1E3A8A', '#2563EB', '#3B82F6', '#EFF6FF', '#FFFFFF']}
      locations={[0, 0.08, 0.22, 0.45, 1.0]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.fullScreen}
    >
      <StatusBar style="light" />

      {/* Top Navigation Bar */}
      <View style={[styles.navBar, { paddingTop: Math.max(insets.top, 12) }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Back to results"
        >
          <ArrowLeft size={20} color="#FFFFFF" strokeWidth={2.4} />
        </TouchableOpacity>

        <View style={styles.navTitleCenter}>
          <Text style={styles.navTitle}>Smart Split Discovery</Text>
          <Text style={styles.navSubtitle}>
            Train {params.trainNo} • {params.travelClass}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={handleManualRefresh}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Refresh smart routes"
        >
          <RotateCcw size={18} color="#FFFFFF" strokeWidth={2.2} />
          {remainingSec > 0 && (
            <View style={styles.cacheCountBadge}>
              <Text style={styles.cacheCountText}>
                {Math.ceil(remainingSec / 60)}m
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Dynamic Toast Notice */}
      {toastNotice && (
        <View style={styles.toastBanner}>
          <Info size={14} color="#1E40AF" style={{ marginRight: 6 }} />
          <Text style={styles.toastText}>{toastNotice}</Text>
        </View>
      )}

      {/* Main Content Body */}
      {loading ? (
        <View style={styles.loaderContainer}>
          <NostalgicTrainLoader
            trainNumber={params.trainNo}
            source={params.source}
            destination={params.destination}
            travelClass={params.travelClass}
          />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <View style={styles.errorCard}>
            <AlertCircle size={32} color="#DC2626" style={{ marginBottom: 12 }} />
            <Text style={styles.errorTitle}>Discovery Error</Text>
            <Text style={styles.errorMsg}>{error}</Text>
            <TouchableOpacity
              style={styles.errorRetryBtn}
              onPress={() => loadSmartRoutes(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.errorRetryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          {/* Train & Route Identity Banner */}
          <View style={styles.routeBanner}>
            <View style={styles.routeBannerTop}>
              <View style={styles.trainNumberBadge}>
                <TrainFront size={14} color="#2563EB" strokeWidth={2.4} style={{ marginRight: 4 }} />
                <Text style={styles.trainNumberText}>{params.trainNo}</Text>
              </View>
              <Text style={styles.trainNameText} numberOfLines={1}>
                {params.trainName || resultData?.train_name || 'Express'}
              </Text>
              <View style={styles.classBadge}>
                <Text style={styles.classBadgeText}>{params.travelClass}</Text>
              </View>
            </View>
            <View style={styles.routePathRow}>
              <Text style={styles.routePathText} numberOfLines={1}>
                {params.source} ({params.sourceName || getStationName(params.source)}) ➔ {params.destination} ({params.destinationName || getStationName(params.destination)})
              </Text>
            </View>
          </View>

          {/* Direct vs Smart Split Comparison Hero Card */}
          <View style={styles.comparisonCard}>
            <View style={styles.comparisonHeader}>
              <Sparkles size={16} color="#2563EB" strokeWidth={2.4} style={{ marginRight: 6 }} />
              <Text style={styles.comparisonHeaderTitle}>Comparison Overview</Text>
            </View>

            <View style={styles.comparisonColumns}>
              {/* Left Column: Direct Ticket */}
              <View style={styles.comparisonCol}>
                <Text style={styles.colLabel}>Direct Ticket</Text>
                <View style={styles.directStatusBadge}>
                  <Text style={styles.directStatusText}>{directStatusText}</Text>
                </View>
                <Text style={styles.colFare}>
                  {directFareNum ? `₹${directFareNum}` : 'Base Fare'}
                </Text>
                <Text style={styles.colSub}>0 seat changes</Text>
                <View style={styles.unconfirmedTag}>
                  <Text style={styles.unconfirmedTagText}>Unconfirmed</Text>
                </View>
              </View>

              <View style={styles.comparisonDivider} />

              {/* Right Column: Recommended Solution */}
              <View style={[styles.comparisonCol, styles.comparisonColHighlight]}>
                <Text style={[styles.colLabel, { color: '#1E40AF' }]}>
                  {bestPres?.strategy_label || 'Smart Split'}
                </Text>
                <View
                  style={[
                    styles.splitStatusBadge,
                    !bestSolution
                      ? { backgroundColor: '#64748B' }
                      : !bestSolution.is_confirmed && bestSolution.is_rac
                        ? { backgroundColor: '#D97706' }
                        : null,
                  ]}
                >
                  <CheckCircle2 size={13} color="#FFFFFF" strokeWidth={2.4} style={{ marginRight: 4 }} />
                  <Text style={styles.splitStatusText}>
                    {bestSolution ? bestPres?.badge_text || 'CONFIRMED' : 'NONE FOUND'}
                  </Text>
                </View>
                <Text style={styles.colFareHighlight}>
                  {bestSolution?.total_fare !== null && bestSolution?.total_fare !== undefined
                    ? `₹${bestSolution.total_fare}`
                    : bestSolution
                      ? 'Dynamic'
                      : '--'}
                </Text>
                <Text style={styles.colSubHighlight}>
                  {bestSolution ? bestPres?.comparison_sublabel || 'Same train' : 'All quotas full'}
                </Text>
                <View
                  style={[
                    styles.confirmedTag,
                    !bestSolution
                      ? { backgroundColor: '#F1F5F9' }
                      : !bestSolution.is_confirmed && bestSolution.is_rac
                        ? { backgroundColor: '#FEF3C7' }
                        : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.confirmedTagText,
                      !bestSolution
                        ? { color: '#64748B' }
                        : !bestSolution.is_confirmed && bestSolution.is_rac
                          ? { color: '#B45309' }
                          : null,
                    ]}
                  >
                    {bestSolution ? bestPres?.confirmed_tag || 'Guaranteed Seat' : 'Try Another Date'}
                  </Text>
                </View>
              </View>
            </View>

            {bestSolution && bestSolution.total_fare !== null && directFareNum !== null && (
              <View style={styles.surchargeFooter}>
                <Info size={13} color="#1E40AF" style={{ marginRight: 6 }} />
                <Text style={styles.surchargeFooterText}>
                  {displayedFareDelta > 0
                    ? `${bestSolution.is_confirmed ? 'Confirmed berth' : 'Improved seat option'} for ₹${displayedFareDelta} more (+${displayedSurchargePct.toFixed(1)}%).`
                    : displayedFareDelta < 0
                      ? `${bestSolution.is_confirmed ? 'Confirmed berth' : 'Improved seat option'} and saves ₹${Math.abs(displayedFareDelta)} (-${displayedSurchargePct.toFixed(1)}%).`
                      : `${bestSolution.is_confirmed ? 'Confirmed berth' : 'Improved seat option'} at the same ₹${bestSolution.total_fare} fare!`}
                </Text>
              </View>
            )}
          </View>

          {/* Best Recommended Solution Card */}
          {bestSolution && bestPres ? (
            <View style={styles.bestSolutionCard}>
              <LinearGradient
                colors={['#1E3A8A', '#2563EB']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.bestBadgeBanner}
              >
                <ShieldCheck size={16} color="#FFFFFF" strokeWidth={2.4} style={{ marginRight: 6 }} />
                <Text style={styles.bestBadgeTitle}>TOP RECOMMENDATION</Text>
                <View style={styles.scorePill}>
                  <Text style={styles.scorePillText}>
                    Score: {Math.round(bestSolution.recommendation_score)}/100
                  </Text>
                </View>
              </LinearGradient>

              <View style={styles.solutionBody}>
                <Text style={styles.solutionHeadline}>{bestPres.card_headline}</Text>

                {/* Leg-by-Leg Journey Timeline */}
                {renderSolutionTimeline(bestSolution)}

                {/* IRCTC Booking Guidance Box */}
                {renderBookingGuideBox(bestPres)}

                {/* Show Booking Trick / Boarding Guide Button */}
                {bestPres.action_button_label && (
                  <TouchableOpacity
                    style={styles.showTrickBtn}
                    activeOpacity={0.8}
                    onPress={() =>
                      setTrickModalState({
                        visible: true,
                        solution: bestSolution,
                        optionNumber: 1,
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${bestPres.action_button_label} for Option 1`}
                  >
                    <Zap size={14} color="#FFFFFF" strokeWidth={2.4} style={{ marginRight: 6 }} />
                    <Text style={styles.showTrickBtnText}>{bestPres.action_button_label}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.noSplitCard}>
              <AlertCircle size={28} color="#D97706" style={{ marginBottom: 8 }} />
              <Text style={styles.noSplitTitle}>No Confirmed Split Found</Text>
              <Text style={styles.noSplitDesc}>
                Intermediate berth quotas for Train {params.trainNo} are also currently waitlisted for this date.
              </Text>
            </View>
          )}

          {/* Alternative Split Options */}
          {alternativeSolutions.length > 0 && (
            <View style={styles.altSection}>
              <View style={styles.altSectionHeaderRow}>
                <Text style={styles.altSectionTitle}>Alternative Options</Text>
                <Text style={styles.altSectionCount}>
                  {alternativeSolutions.length} {alternativeSolutions.length === 1 ? 'option available' : 'options available'}
                </Text>
              </View>
              {alternativeSolutions.map((sol: SmartRouteSolution, idx: number) => {
                const optionNum = idx + 2;
                const solKey = sol.solution_id || `alt-option-${optionNum}`;
                const isExpanded = !!expandedOptionIds[solKey];
                const theme = OPTION_THEMES[(idx + 1) % OPTION_THEMES.length];
                const altPres = resolveSolutionPresentation(sol, isoDate);

                return (
                  <View
                    key={solKey}
                    style={[
                      styles.altCard,
                      {
                        borderColor: isExpanded ? theme.accent : '#E2E8F0',
                        borderWidth: isExpanded ? 1.5 : 1,
                      },
                    ]}
                  >
                    {/* Clickable Card Header */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => toggleOptionExpansion(solKey)}
                      style={[
                        styles.altCardHeaderTouchable,
                        isExpanded && {
                          backgroundColor: theme.lightBg,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.borderColor,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Option ${optionNum}, ${altPres.alt_summary}. Tap to ${isExpanded ? 'collapse' : 'expand'} details.`}
                    >
                      <View style={styles.altHeaderRow}>
                        <View style={styles.altHeaderLeft}>
                          <View
                            style={[
                              styles.altOptionBadge,
                              { backgroundColor: theme.badgeBg, borderColor: theme.borderColor },
                            ]}
                          >
                            <View style={[styles.altColorIndicator, { backgroundColor: theme.accent }]} />
                            <Text style={[styles.altOptionBadgeText, { color: theme.badgeText }]}>
                              Option {optionNum}
                            </Text>
                          </View>
                          <View style={styles.altScoreBadge}>
                            <Text style={styles.altScoreText}>Score: {Math.round(sol.recommendation_score)}</Text>
                          </View>
                        </View>

                        <View style={styles.altHeaderRight}>
                          <Text style={styles.altFareValue}>
                            {sol.total_fare !== null ? `₹${sol.total_fare}` : 'Dynamic'}
                          </Text>
                          <View
                            style={[
                              styles.expandTogglePill,
                              { backgroundColor: isExpanded ? theme.badgeBg : '#F1F5F9' },
                            ]}
                          >
                            <Text style={[styles.expandToggleText, { color: isExpanded ? theme.accent : '#64748B' }]}>
                              {isExpanded ? 'Hide' : 'Details'}
                            </Text>
                            {isExpanded ? (
                              <ChevronUp size={13} color={theme.accent} strokeWidth={2.4} />
                            ) : (
                              <ChevronDown size={13} color="#64748B" strokeWidth={2.4} />
                            )}
                          </View>
                        </View>
                      </View>

                      {/* Route Summary Row */}
                      <View style={styles.altRouteSummaryRow}>
                        {sol.tier === 'TIER_2_ORIGIN_EXTENSION' || Boolean(sol.boarding_station) ? (
                          <MapPin size={13} color={theme.accent} style={{ marginRight: 6 }} />
                        ) : (
                          <Split size={13} color={theme.accent} style={{ marginRight: 6 }} />
                        )}
                        <Text style={styles.altRouteSummaryText} numberOfLines={isExpanded ? undefined : 1}>
                          {altPres.alt_summary}
                        </Text>
                      </View>

                      {/* Quick Booking Trick trigger on collapsed card */}
                      {altPres.action_button_label && !isExpanded && (
                        <TouchableOpacity
                          style={[
                            styles.altQuickTrickBtn,
                            { borderColor: theme.borderColor, backgroundColor: theme.badgeBg },
                          ]}
                          activeOpacity={0.7}
                          onPress={() =>
                            setTrickModalState({
                              visible: true,
                              solution: sol,
                              optionNumber: optionNum,
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`${altPres.action_button_label} for Option ${optionNum}`}
                        >
                          <Zap size={12} color={theme.accent} strokeWidth={2.4} style={{ marginRight: 5 }} />
                          <Text style={[styles.altQuickTrickText, { color: theme.accent }]}>
                            {altPres.action_button_label}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>

                    {/* Detailed Leg Breakdown (when expanded) */}
                    {isExpanded && (
                      <View style={styles.altExpandedBody}>
                        <Text style={styles.solutionHeadline}>{altPres.card_headline}</Text>

                        {/* Leg-by-Leg Journey Timeline */}
                        {renderSolutionTimeline(
                          sol,
                          theme.accent,
                          theme.badgeBg,
                          theme.borderColor,
                          theme.primary
                        )}

                        {/* IRCTC Booking Guidance Box */}
                        {renderBookingGuideBox(altPres, theme.accent, theme.primary)}

                        {/* Show Booking Trick Button for Alternative Option */}
                        {altPres.action_button_label && (
                          <TouchableOpacity
                            style={[styles.showTrickBtnAlt, { backgroundColor: theme.primary }]}
                            activeOpacity={0.8}
                            onPress={() =>
                              setTrickModalState({
                                visible: true,
                                solution: sol,
                                optionNumber: optionNum,
                              })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`${altPres.action_button_label} for Option ${optionNum}`}
                          >
                            <Zap size={14} color="#FFFFFF" strokeWidth={2.4} style={{ marginRight: 6 }} />
                            <Text style={styles.showTrickBtnText}>{altPres.action_button_label}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Cache Footer Notice */}
          <View style={styles.cacheNoticeFooter}>
            <Clock size={12} color="#64748B" style={{ marginRight: 5 }} />
            <Text style={styles.cacheNoticeText}>
              {isFromCache ? 'Serving cached results • ' : ''}Results cached for 5 minutes to prevent IRCTC server overload.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Intelligent Same-Coach Booking Trick Bottom Sheet Modal */}
      <BookingTrickModal
        visible={trickModalState.visible}
        onClose={() => setTrickModalState((prev) => ({ ...prev, visible: false }))}
        solution={trickModalState.solution}
        optionNumber={trickModalState.optionNumber}
        trainNo={params.trainNo || ''}
        trainName={params.trainName}
      />
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitleCenter: {
    alignItems: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  navSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#BFDBFE',
    marginTop: 1,
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cacheCountBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  cacheCountText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  toastText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E40AF',
    flex: 1,
  },
  loaderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#991B1B',
    marginBottom: 6,
  },
  errorMsg: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  errorRetryBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  errorRetryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  routeBanner: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  routeBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routePathRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  routePathText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E40AF',
  },
  trainNumberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  trainNumberText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563EB',
  },
  trainNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  classBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  classBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  comparisonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
  },
  comparisonHeaderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  comparisonColumns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  comparisonCol: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  comparisonColHighlight: {
    backgroundColor: '#EFF6FF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  colLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  directStatusBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.full,
    marginBottom: 6,
  },
  directStatusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
  },
  splitStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16A34A',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.full,
    marginBottom: 6,
  },
  splitStatusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  colFare: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  colFareHighlight: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  colSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  colSubHighlight: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
    marginTop: 2,
  },
  unconfirmedTag: {
    marginTop: 8,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  unconfirmedTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  confirmedTag: {
    marginTop: 8,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  confirmedTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  comparisonDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 8,
  },
  surchargeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 12,
  },
  surchargeFooterText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1E40AF',
  },
  bestSolutionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1.8,
    borderColor: '#3B82F6',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  bestBadgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bestBadgeTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
    flex: 1,
  },
  scorePill: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  scorePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  solutionBody: {
    padding: 16,
  },
  solutionHeadline: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 14,
  },
  timelineContainer: {
    marginBottom: 14,
  },
  legCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: radius.lg,
    padding: 12,
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
  },
  legHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  legNumberCircle: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  legNumberText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  legStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  legStatusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  legFareText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  legRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legStationCode: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  legStationName: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
    maxWidth: 110,
  },
  legTimeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  legArrowBlock: {
    alignItems: 'center',
  },
  legDistanceText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 2,
  },
  legLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#94A3B8',
  },
  legDash: {
    width: 40,
    height: 1.5,
    backgroundColor: '#CBD5E1',
  },
  shiftConnector: {
    alignItems: 'center',
    marginVertical: 4,
  },
  shiftLineVertical: {
    width: 2,
    height: 8,
    backgroundColor: '#F59E0B',
  },
  shiftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  shiftBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  boardingPointBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  boardingPointText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
    flex: 1,
  },
  bookingGuideBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: radius.md,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#2563EB',
  },
  bookingGuideTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  bookingGuideStep: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  bookingGuideNote: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563EB',
    marginTop: 6,
  },
  noSplitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1.2,
    borderColor: '#FDE68A',
  },
  noSplitTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#B45309',
    marginBottom: 4,
  },
  noSplitDesc: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  altSection: {
    marginBottom: 20,
  },
  altSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  altSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  altSectionCount: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  altCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  altCardHeaderTouchable: {
    padding: 14,
  },
  altHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  altHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  altOptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginRight: 8,
  },
  altColorIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  altOptionBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  altScoreBadge: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  altScoreText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  altHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  altFareValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginRight: 10,
  },
  expandTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  expandToggleText: {
    fontSize: 11,
    fontWeight: '700',
    marginRight: 3,
  },
  altRouteSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  altRouteSummaryText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  altExpandedBody: {
    padding: 14,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
  },
  cacheNoticeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingBottom: 16,
  },
  cacheNoticeText: {
    fontSize: 11,
    color: '#64748B',
  },
  showTrickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    marginTop: 12,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  showTrickBtnAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    marginTop: 12,
  },
  showTrickBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  altQuickTrickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  altQuickTrickText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
