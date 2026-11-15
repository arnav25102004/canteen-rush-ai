import './config/bootEnv'; // must stay first: loads .env and validates it
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import type { ScheduledTask } from 'node-cron';
import { Server as SocketIOServer } from 'socket.io';

import { prisma } from './config/database';
import { redis } from './config/redis';
import { setupSocketIO } from './socket/orderSocket';
import { logger } from './utils/logger';
import { parseOrigins, originChecker } from './config/cors';

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import canteenRoutes from './routes/canteen.routes';
import menuRoutes from './routes/menu.routes';
import slotRoutes from './routes/slot.routes';
import orderRoutes from './routes/order.routes';
import walletRoutes from './routes/wallet.routes';
import paymentRoutes from './routes/payment.routes';
import notificationRoutes from './routes/notification.routes';
import adminRoutes from './routes/admin.routes';
import analyticsRoutes from './routes/analytics.routes';
import institutionRoutes from './routes/institution.routes';
import loyaltyRoutes from './routes/loyalty.routes';
import { globalErrorHandler } from './middleware/errorHandler';
import { globalLimiter, authLimiter, forgotPasswordLimiter } from './middleware/rateLimit';

// Jobs
import { FEATURES } from './config/features';
import { startSlotGenerationJob } from './jobs/slotGeneration.cron';
import { startAutoCancelJob } from './jobs/autoCancelOrders.cron';

const app = express();
const server = http.createServer(app);

// Render (and any reverse proxy) forwards the client IP in X-Forwarded-For.
// Without this, req.ip is the proxy's address for every request, which
// collapses all per-IP rate limiting into one shared bucket and makes the
// abuse logs useless. Trust exactly one hop — trusting all hops would let a
// client spoof X-Forwarded-For and bypass the limiter entirely.
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = parseOrigins();
const checkOrigin = originChecker(allowedOrigins);

// Socket.IO — mobile clients send no Origin header, so those are allowed through;
// browser origins must be whitelisted. Every connection is additionally
// authenticated by the handshake middleware in setupSocketIO.
const io = new SocketIOServer(server, {
  cors: {
    origin: checkOrigin,
    credentials: true,
  },
});

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'res.cloudinary.com'],
      connectSrc: ["'self'", 'https://api.razorpay.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  // Mobile apps send no Origin; unknown browser origins just get no CORS headers (no 500).
  origin: checkOrigin,
  credentials: true,
}));

// ── Health checks (before the rate limiter so probes are never throttled) ─────
const liveness = (_req: express.Request, res: express.Response) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
app.get('/health', liveness);
app.get('/api/health', liveness);
app.get('/ready', async (_req, res) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2000); }),
    ]);
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Per-user limits on the expensive paths live next to their routes; see
// middleware/rateLimit.ts for why IP-keyed limits are coarse here.
app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({
  limit: '100kb',
  verify: (req: any, _res, buf) => {
    // rawBody needed by Razorpay webhook for HMAC signature verification
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

// Attach io to requests
app.use((req: any, _res, next) => {
  req.io = io;
  next();
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/canteens', canteenRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/vendor', menuRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/vendor/slots', slotRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/vendor/orders', orderRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/vendor/analytics', analyticsRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/loyalty', loyaltyRoutes);

// Setup Socket.IO
setupSocketIO(io);

// Global error handler
app.use(globalErrorHandler);

const PORT = parseInt(process.env.PORT || '3001', 10);

const cronTasks: ScheduledTask[] = [];

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error('Failed to connect to PostgreSQL', { err });
    process.exit(1);
  }

  try {
    await redis.connect();
    await redis.ping();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis unavailable — running without the slot availability cache');
  }

  // Start background jobs
  if (FEATURES.RAZORPAY_ENABLED) {
    logger.warn('RAZORPAY_ENABLED=true: cancel/no-show refunds are credited to the student wallet and do NOT reverse Razorpay Route transfers or refund the card. Reconcile vendor payouts manually.');
  }
  cronTasks.push(startSlotGenerationJob(), startAutoCancelJob());

  server.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
}

// Last line of defence for stray promise rejections (cron jobs, fire-and-forget
// work). Route handlers are already covered by utils/router.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

let shuttingDown = false;
async function shutdown(signal: string, exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);
  setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();

  // io.close() disconnects websocket clients and closes the underlying HTTP
  // server; calling server.close() first would hang on open websockets.
  try {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('HTTP and Socket.IO servers closed');
  } catch (err) { logger.warn('Server close failed', { err }); }
  for (const task of cronTasks) {
    try { await task.stop(); } catch (err) { logger.warn('Cron stop failed', { err }); }
  }
  try { await prisma.$disconnect(); } catch (err) { logger.warn('Prisma disconnect failed', { err }); }
  try { await redis.quit(); } catch { redis.disconnect(); }
  logger.info('Shutdown complete');
  process.exit(exitCode);
}

process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
process.once('SIGINT', () => void shutdown('SIGINT', 0));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: err.stack || err });
  void shutdown('uncaughtException', 1);
});

bootstrap();

export { io };
