import React, { useState, useMemo } from 'react';
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
} from '../services/stationService';

interface StationSearchModalProps {
  visible: boolean;
  title: string; // e.g. "Select Departure Station" or "Select Destination"
  onClose: () => void;
  onSelect: (station: Station) => void;
}

export const StationSearchModal: React.FC<StationSearchModalProps> = ({
  visible,
  title,
  onClose,
  onSelect,
}) => {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const stations = useMemo(() => {
    return searchStations(query, 40);
  }, [query]);

  const handleSelect = (station: Station) => {
    onSelect(station);
    setQuery('');
    onClose();
  };

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 16) }]}>
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
          <Text style={styles.searchIcon}>🔍</Text>
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
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Quick Picks / Popular Stations Row when query is empty */}
        {query.trim().length === 0 && (
          <View style={styles.popularSection}>
            <Text style={styles.sectionSubtitle}>POPULAR STATIONS</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.popularRow}
            >
              {POPULAR_STATIONS.slice(0, 8).map((station) => (
                <TouchableOpacity
                  key={station.code}
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
              <Text style={styles.emptyIcon}>🚉</Text>
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
              <Text style={styles.selectArrow}>›</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  searchIcon: {
    fontSize: 16,
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
