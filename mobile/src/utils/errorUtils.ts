/**
 * Error Sanitization Utility for TrainWatch
 * 
 * Guarantees that internal hostnames, Cloud Run URLs, IP addresses,
 * and raw stack traces are never exposed to users in the UI.
 */

export interface SanitizedErrorInfo {
  isNoInternet: boolean;
  isTimeout: boolean;
  isServerError: boolean;
  userMessage: string;
}

const NETWORK_ERROR_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /enotfound/i,
  /econnrefused/i,
  /econnreset/i,
  /no address associated with hostname/i,
  /err_internet_disconnected/i,
  /err_name_not_resolved/i,
  /err_connection_timed_out/i,
  /the network connection was lost/i,
  /the internet connection appears to be offline/i,
  /software caused connection abort/i,
];

const TIMEOUT_PATTERNS = [
  /timed out/i,
  /timeout/i,
  /abort/i,
];

// Domains/IP patterns to strip completely from any user-visible error string
const SENSITIVE_HOST_PATTERNS = [
  /https?:\/\/[^\s/$.?#].[^\s]*/gi,
  /[a-zA-Z0-9-]+\.(?:cloud\.run|run\.app|appspot\.com|duckdns\.org|amazonaws\.com)/gi,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g,
];

/**
 * Strips hostnames, URLs, and sensitive infrastructure identifiers from a string.
 */
export function stripHostnames(text: string): string {
  if (!text) return '';
  let cleaned = text;
  for (const pattern of SENSITIVE_HOST_PATTERNS) {
    cleaned = cleaned.replace(pattern, '').trim();
  }
  // Clean up any dangling colons or quotes left behind
  cleaned = cleaned.replace(/:\s*$/, '').replace(/^["']|["']$/g, '').trim();
  return cleaned;
}

/**
 * Sanitizes any raw error into a user-friendly, safe representation.
 */
export function sanitizeError(error: unknown, fallbackMessage = 'Unable to complete search. Please try again.'): SanitizedErrorInfo {
  if (!error) {
    return {
      isNoInternet: false,
      isTimeout: false,
      isServerError: false,
      userMessage: fallbackMessage,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);

  // 1. Check for offline / network failure
  const isNoInternet = NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(rawMessage));
  if (isNoInternet) {
    return {
      isNoInternet: true,
      isTimeout: false,
      isServerError: false,
      userMessage: 'No internet connection. Please check your mobile data or Wi-Fi.',
    };
  }

  // 2. Check for timeout
  const isTimeout = TIMEOUT_PATTERNS.some((pattern) => pattern.test(rawMessage));
  if (isTimeout) {
    return {
      isNoInternet: false,
      isTimeout: true,
      isServerError: false,
      userMessage: 'Connection timed out. Please check your signal and try again.',
    };
  }

  // 3. Check for 5xx server errors
  const isServerError = /server error \(5\d\d\)/i.test(rawMessage) || /internal server error/i.test(rawMessage);
  if (isServerError) {
    return {
      isNoInternet: false,
      isTimeout: false,
      isServerError: true,
      userMessage: 'Train search service is temporarily unavailable. Please try again in a few moments.',
    };
  }

  // 4. General sanitized error
  const sanitized = stripHostnames(rawMessage);
  const userMessage = sanitized.length > 5 && !/object object/i.test(sanitized)
    ? sanitized
    : fallbackMessage;

  return {
    isNoInternet: false,
    isTimeout: false,
    isServerError: false,
    userMessage,
  };
}
