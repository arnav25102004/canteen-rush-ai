import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { prisma } from './config/database';
import { redis } from './config/redis';
import { setupSocketIO } from './socket/orderSocket';
import { logger } from './utils/logger';

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
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8081',
  ...(process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || []),
  ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
].filter(Boolean);

// Socket.IO — mobile clients send no Origin header, so those are allowed through;
// browser origins must be whitelisted. Every connection is additionally
// authenticated by the handshake middleware in setupSocketIO.
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) =>
      !origin || allowedOrigins.includes(origin)
        ? cb(null, true)
        : cb(new Error('Not allowed by CORS')),
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
  origin: (_origin, callback) => {
    // Allow mobile apps (no origin) and explicitly whitelisted origins
    if (!_origin || allowedOrigins.includes(_origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

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
  limit: '10mb',
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

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error('Failed to connect to PostgreSQL', { err });
    process.exit(1);
  }

  try {
    await redis.ping();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis unavailable — payment status polling disabled, continuing without it');
  }

  // Start background jobs
  startSlotGenerationJob();
  startAutoCancelJob();

  server.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
}

bootstrap();

export { io };
