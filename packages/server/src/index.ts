import './config/bootEnv'; // must stay first: loads .env and validates it
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import type { ScheduledTask } from 'node-cron';
import { Server as SocketIOServer } from 'socket.io';

import { prisma } from './config/database';
import { redis, redisEnabled } from './config/redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { startCacheSync, stopCacheSync } from './config/cache';
import { observe, requestDeadline, shedLoad } from './middleware/resilience';
import { metrics } from './utils/metrics';
import { startOutboxWorker } from './services/outbox.service';
import { cloudinaryConfigured } from './config/cloudinary';
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
import feedbackAdminRoutes from './routes/feedback.admin.routes';
import changelogAdminRoutes from './routes/changelog.admin.routes';
import feedbackVendorRoutes from './routes/feedback.vendor.routes';
import analyticsRoutes from './routes/analytics.routes';
import institutionRoutes from './routes/institution.routes';
import loyaltyRoutes from './routes/loyalty.routes';
import feedbackRoutes from './routes/feedback.routes';
import assistantRoutes from './routes/assistant.routes';
import { globalErrorHandler } from './middleware/errorHandler';
import { globalLimiter, authLimiter, forgotPasswordLimiter } from './middleware/rateLimit';

// Jobs
import { FEATURES } from './config/features';
import { startSlotGenerationJob } from './jobs/slotGeneration.cron';
import { startAutoCancelJob } from './jobs/autoCancelOrders.cron';
import { startFeedbackNudgeJob } from './jobs/feedbackNudge.cron';
import { startFeedbackSlaJob } from './jobs/feedbackSla.cron';
import { startFeedbackRetentionJob } from './jobs/feedbackRetention.cron';
import { startAssistantRetentionJob } from './jobs/assistantRetention.cron';

const app = express();
const server = http.createServer(app);

// Render (and any reverse proxy) forwards the client IP in X-Forwarded-For.
// Without this, req.ip is the proxy's address for every request, which
// collapses all per-IP rate limiting into one shared bucket and makes the
// abuse logs useless. Trust exactly the known hops (1 for Render; set
// TRUST_PROXY_HOPS=2 behind a CDN) — trusting all hops would let a client spoof
// X-Forwarded-For and bypass the limiter entirely.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);
// Cached responses set their own ETag; hashing every dynamic response is wasted CPU.
app.disable('etag');

// api = HTTP + sockets, worker = queue + cron, all = both (single-instance deploys).
const ROLE = process.env.PROCESS_ROLE === 'api' || process.env.PROCESS_ROLE === 'worker' ? process.env.PROCESS_ROLE : 'all';
const runsApi = ROLE !== 'worker';
const runsJobs = ROLE !== 'api';

// ── API versioning ────────────────────────────────────────────────────────────
// /api/v1/* is the stable contract. Unversioned /api/* stays as an alias so app
// versions already installed on phones keep working.
app.use((req, res, next) => {
  if (req.url === '/api/v1' || req.url.startsWith('/api/v1/') || req.url.startsWith('/api/v1?')) {
    req.url = `/api${req.url.slice('/api/v1'.length)}`;
  }
  res.setHeader('API-Version', '1');
  next();
});

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
  maxHttpBufferSize: 16 * 1024, // clients only send small room-join events
  connectTimeout: 10_000,
});

// Slow-client protection (slowloris) and keep-alive longer than typical proxies.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 65_000;

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

app.get('/metrics', (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) return res.status(404).end();
  res.type('text/plain').send(metrics.render());
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Per-user limits on the expensive paths live next to their routes; see
// middleware/rateLimit.ts for why IP-keyed limits are coarse here.
app.use(observe);
app.use(shedLoad);
app.use(requestDeadline);
app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
// Small JSON costs more CPU to compress than it saves on the wire.
app.use(compression({ threshold: 2048 }));
app.use(express.json({
  limit: '100kb',
  verify: (req: any, _res, buf) => {
    // rawBody needed by Razorpay webhook for HMAC signature verification
    if (/^\/api(\/v1)?\/payments\/webhook/.test(req.originalUrl)) req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: '100kb', parameterLimit: 100 }));

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
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
// Before '/api/admin': that router rejects SUPER_ADMIN for everything it serves.
app.use('/api/admin/feedback', feedbackAdminRoutes);
app.use('/api/admin/changelog', changelogAdminRoutes);
// Before '/api/vendor' (menu routes): the anonymised vendor feedback view is VENDOR-only.
app.use('/api/vendor/feedback', feedbackVendorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/assistant', assistantRoutes);

// Setup Socket.IO
setupSocketIO(io);

// Global error handler
app.use(globalErrorHandler);

const PORT = parseInt(process.env.PORT || '3001', 10);

const cronTasks: ScheduledTask[] = [];
let stopOutbox: (() => Promise<void>) | null = null;
const socketRedis: Array<typeof redis> = [];

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error('Failed to connect to PostgreSQL', { err });
    process.exit(1);
  }

  if (!cloudinaryConfigured) {
    logger.warn('Cloudinary not configured — menu photo uploads are disabled (endpoint returns 503)');
  }
  if (!redisEnabled) {
    logger.info('REDIS_URL not set — running without the slot availability cache');
  } else {
    try {
      await redis.connect();
      await redis.ping();
      logger.info('Redis connected');
    } catch (err) {
      logger.warn('Redis unavailable — running without the slot availability cache (will keep retrying)');
    }
    if (runsApi && redis.status === 'ready') {
      // Delivers room events across instances. Without it, a single instance still works.
      const pub = redis.duplicate({ commandTimeout: undefined, enableAutoPipelining: false });
      const sub = redis.duplicate({ commandTimeout: undefined, enableAutoPipelining: false });
      pub.on('error', () => {});
      sub.on('error', () => {});
      io.adapter(createAdapter(pub, sub));
      socketRedis.push(pub, sub);
    }
  }
  await startCacheSync();

  // Start background jobs
  if (FEATURES.RAZORPAY_ENABLED) {
    logger.warn('RAZORPAY_ENABLED=true: cancel/no-show refunds are credited to the student wallet and do NOT reverse Razorpay Route transfers or refund the card. Reconcile vendor payouts manually.');
  }
  if (runsJobs) {
    cronTasks.push(startSlotGenerationJob(), startAutoCancelJob(), startAssistantRetentionJob(), startFeedbackNudgeJob(), startFeedbackSlaJob(), startFeedbackRetentionJob());
    stopOutbox = startOutboxWorker();
  }

  if (runsApi) {
    server.listen(PORT, () => {
      logger.info(`Server running on http://localhost:${PORT} (role: ${ROLE})`);
    });
  } else {
    logger.info('Worker running');
  }
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
  try { await stopOutbox?.(); } catch (err) { logger.warn('Outbox stop failed', { err }); }
  await stopCacheSync();
  for (const r of socketRedis) r.disconnect();
  for (const task of cronTasks) {
    try { await task.stop(); } catch (err) { logger.warn('Cron stop failed', { err }); }
  }
  try { await prisma.$disconnect(); } catch (err) { logger.warn('Prisma disconnect failed', { err }); }
  if (redisEnabled) {
    try { await redis.quit(); } catch { redis.disconnect(); }
  }
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
