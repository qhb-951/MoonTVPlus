export const LEGACY_QUARK_TEMP_SOURCE = 'quark-temp';
export const NETDISK_QUARK_SOURCE = 'netdisk-quark';
export const NETDISK_MOBILE_SOURCE = 'netdisk-mobile';

export type NetdiskProvider = 'quark' | 'mobile';

export function normalizeNetdiskSource(source?: string | null): string {
  if (!source) return '';
  if (source === LEGACY_QUARK_TEMP_SOURCE) return NETDISK_QUARK_SOURCE;
  return source;
}

export function isNetdiskSource(source?: string | null): boolean {
  const normalized = normalizeNetdiskSource(source);
  return normalized === NETDISK_QUARK_SOURCE || normalized === NETDISK_MOBILE_SOURCE;
}

export function getNetdiskProvider(source?: string | null): NetdiskProvider | null {
  const normalized = normalizeNetdiskSource(source);
  if (normalized === NETDISK_QUARK_SOURCE) return 'quark';
  if (normalized === NETDISK_MOBILE_SOURCE) return 'mobile';
  return null;
}

export function isNetdiskQuarkSource(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_QUARK_SOURCE;
}

export function isNetdiskMobileSource(source?: string | null): boolean {
  return normalizeNetdiskSource(source) === NETDISK_MOBILE_SOURCE;
}
