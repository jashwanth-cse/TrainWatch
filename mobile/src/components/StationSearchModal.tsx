import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';
import {
  Station,
  searchStations,
  POPULAR_STATIONS,
  getRecentStations,
  addRecentStation,
} from '../services/stationService';
import { Search, X, TrainFront, ChevronRight, History } from 'lucide-react-native';

interface StationSearchModalProps {
  visible: boolean;
  title: string; // e.g. "Select Departure Station" or "Select Destination"
  onClose: () => void;
  onSelect: (station: Station) => void;
  halfScreen?: boolean;
}

export const StationSearchModal: React.FC<StationSearchModalProps> = ({
  visible,
  title,
  onClose,
  onSelect,
  halfScreen = false,
}) => {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [recentStations, setRecentStations] = useState<Station[]>([]);

  useEffect(() => {
    if (visible) {
      let isMounted = true;
      getRecentStations().then((list) => {
        if (isMounted) {
          setRecentStations(list);
        }
      });
      return () => {
        isMounted = false;
      };
    }
  }, [visible]);

  const stations = useMemo(() => {
    const list = searchStations(query, 40);
    if (!query.trim() && recentStations.length > 0) {
      // Prioritize recently searched stations at the top of default list
      const recentCodes = new Set(recentStations.map((r) => r.code));
      const remaining = list.filter((s) => !recentCodes.has(s.code));
      return [...recentStations, ...remaining];
    }
    return list;
  }, [query, recentStations]);

  const handleSelect = (station: Station) => {
    void addRecentStation(station);
    onSelect(station);
    setQuery('');
    onClose();
  };

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  const renderModalBody = () => (
    <>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={handleClose}
          style={styles.closeBtn}
        >
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Search size={18} color={colors.textMuted} style={styles.searchIconStyle} />
        <TextInput
          style={styles.input}
          placeholder="Search by station name or code (e.g. NDLS, Pune)"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => setQuery('')}
            style={styles.clearBtn}
          >
            <X size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Quick Picks / Popular Stations & Recent Searches when query is empty */}
      {query.trim().length === 0 && (
        <View>
          <View style={styles.popularSection}>
            <Text style={styles.sectionSubtitle}>POPULAR STATIONS</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.popularRow}
            >
              {POPULAR_STATIONS.slice(0, 8).map((station) => (
                <TouchableOpacity
                  key={`popular-${station.code}`}
                  style={styles.popularChip}
                  onPress={() => handleSelect(station)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.chipCode}>{station.code}</Text>
                  <Text style={styles.chipName} numberOfLines={1}>
                    {station.name.length > 14
                      ? `${station.name.slice(0, 13)}...`
                      : station.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {recentStations.length > 0 && (
            <View style={styles.recentSection}>
              <View style={styles.recentHeaderRow}>
                <History size={12} color={colors.primary} strokeWidth={2.4} style={{ marginRight: 5 }} />
                <Text style={[styles.sectionSubtitle, styles.recentSubtitle]}>RECENT SEARCHES</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.popularRow}
              >
                {recentStations.map((station) => (
                  <TouchableOpacity
                    key={`recent-${station.code}`}
                    style={[styles.popularChip, styles.recentChip]}
                    onPress={() => handleSelect(station)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipCode, styles.recentChipCode]}>{station.code}</Text>
                    <Text style={styles.chipName} numberOfLines={1}>
                      {station.name.length > 14
                        ? `${station.name.slice(0, 13)}...`
                        : station.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* Station Results List */}
      <FlatList
        data={stations}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <TrainFront size={44} color={colors.textMuted} strokeWidth={1.8} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>No Stations Found</Text>
            <Text style={styles.emptySubtitle}>
              Try searching with station code (e.g. CNB) or city name.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.stationItem}
            onPress={() => handleSelect(item)}
            activeOpacity={0.7}
          >
            <View style={styles.codeBadge}>
              <Text style={styles.codeBadgeText}>{item.code}</Text>
            </View>
            <View style={styles.itemTextGroup}>
              <Text style={styles.itemName}>{item.name}</Text>
              {item.state ? (
                <Text style={styles.itemState}>{item.state}</Text>
              ) : null}
            </View>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        )}
      />
    </>
  );

  if (halfScreen) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={handleClose}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close station selector"
          />
          <View
            style={[
              styles.sheet,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <View style={styles.dragHandle} />
            {renderModalBody()}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
        {renderModalBody()}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.xs,
    maxHeight: '64%',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  closeText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    height: 48,
  },
  searchIconStyle: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  clearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  popularSection: {
    marginTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  recentSection: {
    marginTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  recentSubtitle: {
    paddingHorizontal: 0,
    marginBottom: 0,
    color: colors.primary,
  },
  recentChip: {
    borderColor: colors.primaryLight,
    backgroundColor: colors.surfaceSubtle,
  },
  recentChipCode: {
    color: colors.primary,
  },
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.8,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  popularRow: {
    paddingHorizontal: spacing.md,
    gap: 8,
  },
  popularChip: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  chipCode: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  chipName: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  stationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  codeBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
    minWidth: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  codeBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  itemTextGroup: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  itemState: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  selectArrow: {
    fontSize: 20,
    color: colors.textMuted,
    fontWeight: '300',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
});
