// Imported first by index.ts: loads .env, then validates. Kept as a module
// (not inline statements) so import order is preserved after esbuild hoisting.
import dotenv from 'dotenv';
import path from 'path';
import { assertEnv } from './env';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
assertEnv();
