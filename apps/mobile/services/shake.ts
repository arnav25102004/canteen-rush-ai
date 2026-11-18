import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Opt-in shake-to-report. OFF by default; no sensor is started while it is off. */

const KEY = 'shake_to_report_v1';
export const SHAKE_G = 2.4; // acceleration magnitude in g that counts as a shake
export const SHAKE_DEBOUNCE_MS = 2000;

const listeners = new Set<(v: boolean) => void>();

export async function getShakeEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY)) === '1'; } catch { return false; }
}

export async function setShakeEnabled(v: boolean) {
  try { await AsyncStorage.setItem(KEY, v ? '1' : '0'); } catch { /* best effort */ }
  listeners.forEach((l) => l(v));
}

/** True when a reading is a shake and the debounce window has passed. */
export function isShake(x: number, y: number, z: number, now: number, last: number): boolean {
  return Math.sqrt(x * x + y * y + z * z) > SHAKE_G && now - last > SHAKE_DEBOUNCE_MS;
}

export function useShakeToReport(loggedIn: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    void getShakeEnabled().then(setEnabled);
    listeners.add(setEnabled);
    return () => { listeners.delete(setEnabled); };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setActive(st === 'active'));
    return () => sub.remove();
  }, []);

  const onFeedback = pathname?.startsWith('/feedback/app');

  useEffect(() => {
    if (!enabled || !loggedIn || !active || onFeedback) return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;
    let last = 0;
    void import('expo-sensors').then(({ Accelerometer }) => {
      if (cancelled) return;
      Accelerometer.setUpdateInterval(150);
      sub = Accelerometer.addListener(({ x, y, z }) => {
        const now = Date.now();
        if (!isShake(x, y, z, now, last)) return;
        last = now;
        router.push({ pathname: '/feedback/app', params: { kind: 'APP_BUG' } });
      });
    }).catch(() => { /* no sensor: nothing to do */ });
    return () => { cancelled = true; sub?.remove(); };
  }, [enabled, loggedIn, active, onFeedback, router]);
}
