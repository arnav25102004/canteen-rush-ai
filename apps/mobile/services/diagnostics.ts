import { Platform } from 'react-native';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

/**
 * Diagnostics attached to a bug report. Only what is listed in `Diagnostics` is ever sent; the
 * feedback screen shows this exact object to the user before they submit.
 */

export const MAX_BREADCRUMBS = 20;

export interface Breadcrumb { route: string; at: string }

export interface Diagnostics {
  appVersion: string;
  build: string;
  os: string;
  device: string;
  route: string;
  network: string;
  locale: string;
  breadcrumbs: Breadcrumb[];
}

const crumbs: Breadcrumb[] = [];
let currentRoute = '';

/** Records a route change. Keeps only the last 20, in memory only. */
export function recordRoute(route: string, now = new Date()) {
  if (!route || route === currentRoute) return;
  currentRoute = route;
  crumbs.push({ route, at: now.toISOString() });
  if (crumbs.length > MAX_BREADCRUMBS) crumbs.splice(0, crumbs.length - MAX_BREADCRUMBS);
}

export function getBreadcrumbs(): Breadcrumb[] {
  return crumbs.slice();
}

function deviceModel(): string {
  const c: any = Platform.constants ?? {};
  if (Platform.OS === 'android') return [c.Brand, c.Model].filter(Boolean).join(' ') || 'android';
  return c.interfaceIdiom ? `ios ${c.interfaceIdiom}` : 'ios';
}

function locale(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return 'unknown'; }
}

export async function collectDiagnostics(): Promise<Diagnostics> {
  let network = 'unknown';
  try { network = (await NetInfo.fetch()).type; } catch { /* keep unknown */ }
  const cfg: any = Constants.expoConfig ?? {};
  const build = Platform.OS === 'android' ? cfg.android?.versionCode : cfg.ios?.buildNumber;
  return {
    appVersion: String(cfg.version ?? 'unknown'),
    build: String(build ?? 'unknown'),
    os: `${Platform.OS} ${Platform.Version}`,
    device: deviceModel(),
    route: currentRoute || 'unknown',
    network,
    locale: locale(),
    breadcrumbs: getBreadcrumbs(),
  };
}
