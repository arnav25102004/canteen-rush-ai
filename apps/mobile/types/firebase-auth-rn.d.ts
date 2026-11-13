// firebase/auth ships getReactNativePersistence only in its react-native build,
// but its package "types" entry always points at the browser typings, so TS
// can't see it. Metro resolves the react-native build at runtime.
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
