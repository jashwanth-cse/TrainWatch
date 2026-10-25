export interface QuotaOption {
  code: string;
  label: string;
  description: string;
}

export const QUOTA_OPTIONS: QuotaOption[] = [
  { code: 'GN', label: 'General Quota (GN)', description: 'Standard reservation quota open to all passengers' },
  { code: 'TQ', label: 'Tatkal Quota (TQ)', description: 'Emergency short-notice booking (opens 10am/11am)' },
  { code: 'PT', label: 'Premium Tatkal (PT)', description: 'Dynamic fare tatkal quota for immediate travel' },
  { code: 'LD', label: 'Ladies Quota (LD)', description: 'Reserved berths exclusively for women passengers' },
  { code: 'SS', label: 'Senior Citizen (SS)', description: 'Lower berth quota for elderly and female travelers 45+' },
];

/** Resolve saved codes and legacy display labels to a consistent API/UI pair. */
export function resolveQuota(quotaCode?: string, quotaLabel?: string): { code: string; label: string } {
  const option = QUOTA_OPTIONS.find((item) => item.code === quotaCode)
    ?? QUOTA_OPTIONS.find((item) => item.code === quotaLabel || item.label.split(' ')[0] === quotaLabel)
    ?? QUOTA_OPTIONS[0];
  return { code: option.code, label: option.label.split(' ')[0] || option.code };
}
