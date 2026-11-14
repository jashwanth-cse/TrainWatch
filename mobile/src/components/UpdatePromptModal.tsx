import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Download, Sparkles, X, ArrowRight, AlertCircle } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import type { AppReleaseInfo } from '../services/updateService';

export interface UpdatePromptModalProps {
  visible: boolean;
  release: AppReleaseInfo | null;
  currentVersion: string;
  onDismiss: () => void;
  onUpdate: () => void;
  isDownloading: boolean;
  downloadProgress: number;
  bytesWritten: number;
  totalBytes: number;
  errorMessage?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export const UpdatePromptModal: React.FC<UpdatePromptModalProps> = ({
  visible,
  release,
  currentVersion,
  onDismiss,
  onUpdate,
  isDownloading,
  downloadProgress,
  bytesWritten,
  totalBytes,
  errorMessage,
}) => {
  if (!visible || !release) {
    return null;
  }

  const percent = Math.min(100, Math.max(0, Math.round(downloadProgress * 100)));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!isDownloading) onDismiss();
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {!isDownloading && (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onDismiss}
              activeOpacity={0.7}
              accessibilityLabel="Dismiss update"
            >
              <X size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Sparkles size={24} color={colors.primary} />
            </View>
            <Text style={styles.title}>New Version Available</Text>
            <Text style={styles.subtitle}>
              A new update of TrainWatch is ready to install
            </Text>
          </View>

          <View style={styles.versionRow}>
            <View style={styles.versionBadge}>
              <Text style={styles.versionBadgeText}>{currentVersion}</Text>
            </View>
            <ArrowRight size={16} color={colors.textMuted} />
            <View style={[styles.versionBadge, styles.versionBadgeActive]}>
              <Text style={styles.versionBadgeActiveText}>{release.version}</Text>
            </View>
          </View>

          {Boolean(release.releaseNotes) && (
            <View style={styles.notesContainer}>
              <Text style={styles.notesLabel}>What&apos;s New:</Text>
              <ScrollView
                style={styles.notesScroll}
                contentContainerStyle={styles.notesContent}
                nestedScrollEnabled
              >
                <Text style={styles.notesText}>{release.releaseNotes}</Text>
              </ScrollView>
            </View>
          )}

          {isDownloading ? (
            <View style={styles.downloadContainer}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressText}>Downloading update...</Text>
                <Text style={styles.progressPercent}>{percent}%</Text>
              </View>
              <View style={styles.progressBarTrack}>
                <View
                  style={[styles.progressBarFill, { width: `${percent}%` }]}
                />
              </View>
              <Text style={styles.progressSubtext}>
                {formatBytes(bytesWritten)}{' '}
                {totalBytes > 0 ? `/ ${formatBytes(totalBytes)}` : ''}
              </Text>
            </View>
          ) : (
            <>
              {Boolean(errorMessage) && (
                <View style={styles.errorContainer}>
                  <AlertCircle size={16} color={colors.error} />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.updateButton}
                  onPress={onUpdate}
                  activeOpacity={0.8}
                >
                  <Download size={18} color="#FFFFFF" style={styles.buttonIcon} />
                  <Text style={styles.updateButtonText}>Update Now</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.laterButton}
                  onPress={onDismiss}
                  activeOpacity={0.6}
                >
                  <Text style={styles.laterButtonText}>Later</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {isDownloading && (
            <View style={styles.downloadingFooter}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.downloadingFooterText}>
                Preparing package installer...
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.cardBackground,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  versionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  versionBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  versionBadgeActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primarySky,
  },
  versionBadgeActiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  notesContainer: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  notesScroll: {
    maxHeight: 90,
  },
  notesContent: {
    paddingBottom: 4,
  },
  notesText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  downloadContainer: {
    marginVertical: 8,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  progressPercent: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: colors.borderSubtle,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressSubtext: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'right',
  },
  downloadingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  downloadingFooterText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.error,
  },
  actions: {
    gap: 10,
  },
  updateButton: {
    flexDirection: 'row',
    height: 48,
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonIcon: {
    marginRight: 8,
  },
  updateButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  laterButton: {
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  laterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
