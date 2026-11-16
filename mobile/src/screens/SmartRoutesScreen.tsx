import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors, radius, spacing } from '../theme/tokens';
import {
  fetchSmartRoutes,
  SmartRoutesResultData,
  SmartRouteSolution,
  SubLeg,
} from '../services/smartRouteService';
import { NostalgicTrainLoader } from '../components/NostalgicTrainLoader';
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
} from 'lucide-react-native';

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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const alternativeSolutions: SmartRouteSolution[] =
    resultData && resultData.solutions && resultData.solutions.length > 1
      ? resultData.solutions.slice(1)
      : [];

  const directStatusText = params.directStatus || resultData?.direct_status || 'Waitlist';
  const directFareNum = params.directFare
    ? parseInt(params.directFare, 10)
    : resultData?.direct_fare || null;

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

              {/* Right Column: Smart Split Solution */}
              <View style={[styles.comparisonCol, styles.comparisonColHighlight]}>
                <Text style={[styles.colLabel, { color: '#1E40AF' }]}>Smart Split</Text>
                <View style={styles.splitStatusBadge}>
                  <CheckCircle2 size={13} color="#FFFFFF" strokeWidth={2.4} style={{ marginRight: 4 }} />
                  <Text style={styles.splitStatusText}>CONFIRMED</Text>
                </View>
                <Text style={styles.colFareHighlight}>
                  {bestSolution?.total_fare ? `₹${bestSolution.total_fare}` : 'Dynamic'}
                </Text>
                <Text style={styles.colSubHighlight}>
                  {bestSolution ? `${bestSolution.legs.length - 1} seat shift` : 'Same train'}
                </Text>
                <View style={styles.confirmedTag}>
                  <Text style={styles.confirmedTagText}>Guaranteed Seat</Text>
                </View>
              </View>
            </View>

            {bestSolution && bestSolution.fare_surcharge > 0 && (
              <View style={styles.surchargeFooter}>
                <Info size={13} color="#1E40AF" style={{ marginRight: 6 }} />
                <Text style={styles.surchargeFooterText}>
                  Confirmed berth for just ₹{bestSolution.fare_surcharge} more (+
                  {bestSolution.fare_surcharge_pct.toFixed(1)}%).
                </Text>
              </View>
            )}
          </View>

          {/* Best Recommended Solution Card */}
          {bestSolution ? (
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
                <Text style={styles.solutionHeadline}>
                  Stay on the same train! Just shift your seat at{' '}
                  <Text style={{ fontWeight: '800', color: '#1E40AF' }}>
                    {bestSolution.split_stations.join(', ')}
                  </Text>
                  .
                </Text>

                {/* Leg-by-Leg Journey Timeline */}
                <View style={styles.timelineContainer}>
                  {bestSolution.legs.map((leg: SubLeg, idx: number) => {
                    const isLast = idx === bestSolution.legs.length - 1;
                    return (
                      <React.Fragment key={idx}>
                        {/* Leg Card */}
                        <View style={styles.legCard}>
                          <View style={styles.legHeaderRow}>
                            <View style={styles.legNumberCircle}>
                              <Text style={styles.legNumberText}>Leg {leg.leg_number}</Text>
                            </View>
                            <View style={styles.legStatusPill}>
                              <CheckCircle2 size={12} color="#15803D" strokeWidth={2.4} style={{ marginRight: 4 }} />
                              <Text style={styles.legStatusPillText}>{leg.raw_status}</Text>
                            </View>
                            {leg.fare !== null && (
                              <Text style={styles.legFareText}>₹{leg.fare}</Text>
                            )}
                          </View>

                          <View style={styles.legRouteRow}>
                            <View>
                              <Text style={styles.legStationCode}>{leg.from_station}</Text>
                              <Text style={styles.legTimeText}>{leg.departure_time || 'Dep'}</Text>
                            </View>
                            <View style={styles.legArrowBlock}>
                              <Text style={styles.legDistanceText}>{leg.distance_km} km</Text>
                              <View style={styles.legLine}>
                                <View style={styles.legDot} />
                                <View style={styles.legDash} />
                                <View style={styles.legDot} />
                              </View>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={styles.legStationCode}>{leg.to_station}</Text>
                              <Text style={styles.legTimeText}>{leg.arrival_time || 'Arr'}</Text>
                            </View>
                          </View>
                        </View>

                        {/* Shift Point Connector */}
                        {!isLast && (
                          <View style={styles.shiftConnector}>
                            <View style={styles.shiftLineVertical} />
                            <View style={styles.shiftBadge}>
                              <Split size={14} color="#D97706" strokeWidth={2.4} style={{ marginRight: 6 }} />
                              <Text style={styles.shiftBadgeText}>
                                Shift seat at {leg.to_station} (Same Train)
                              </Text>
                            </View>
                            <View style={styles.shiftLineVertical} />
                          </View>
                        )}
                      </React.Fragment>
                    );
                  })}
                </View>

                {/* IRCTC Booking Guidance Box */}
                <View style={styles.bookingGuideBox}>
                  <Text style={styles.bookingGuideTitle}>How to book on IRCTC:</Text>
                  {bestSolution.legs.map((leg: SubLeg, idx: number) => (
                    <Text key={idx} style={styles.bookingGuideStep}>
                      {idx + 1}. Book Ticket {idx + 1}: {leg.from_station} to {leg.to_station} on Train {leg.train_no} ({leg.travel_class})
                    </Text>
                  ))}
                  <Text style={styles.bookingGuideNote}>
                    You remain on Train {params.trainNo} throughout the entire journey.
                  </Text>
                </View>
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
              <Text style={styles.altSectionTitle}>Alternative Split Options</Text>
              {alternativeSolutions.map((sol: SmartRouteSolution, idx: number) => (
                <View key={sol.solution_id || idx} style={styles.altCard}>
                  <View style={styles.altCardHeader}>
                    <View style={styles.altBadge}>
                      <Text style={styles.altBadgeText}>Option {idx + 2}</Text>
                    </View>
                    <Text style={styles.altScoreText}>Score: {Math.round(sol.recommendation_score)}</Text>
                    <Text style={styles.altFareText}>₹{sol.total_fare}</Text>
                  </View>
                  <Text style={styles.altRouteText}>
                    Split at: {sol.split_stations.join(', ')} ({sol.legs.length} legs)
                  </Text>
                </View>
              ))}
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
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
    marginBottom: 16,
  },
  altSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  altCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  altCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  altBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  altBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2563EB',
  },
  altScoreText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  altFareText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  altRouteText: {
    fontSize: 12,
    color: '#475569',
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
});
