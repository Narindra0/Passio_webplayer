const isVerboseLoggingEnabled = import.meta.env.VITE_VERBOSE_LOGS === 'true';
const isLocalActive = import.meta.env.VITE_LOCAL === 'active';
const isDev = import.meta.env.DEV;

function formatScope(scope: string, message: unknown) {
  if (typeof message === 'string') return `[${scope}] ${message}`;
  return `[${scope}]`;
}

export const logger = {
  debug(scope: string, message?: unknown, ...extra: unknown[]) {
    if (!isVerboseLoggingEnabled || (!isDev && !isLocalActive)) return;
    console.log(formatScope(scope, message), ...extra);
  },
  info(scope: string, message?: unknown, ...extra: unknown[]) {
    if (!isVerboseLoggingEnabled || (!isDev && !isLocalActive)) return;
    console.info(formatScope(scope, message), ...extra);
  },
  warn(scope: string, message?: unknown, ...extra: unknown[]) {
    if (!isVerboseLoggingEnabled || (!isDev && !isLocalActive)) return;
    console.warn(formatScope(scope, message), ...extra);
  },
  error(scope: string, message?: unknown, ...extra: unknown[]) {
    console.error(formatScope(scope, message), ...extra);
  },
};
