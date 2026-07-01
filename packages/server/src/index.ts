import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
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

// Jobs
import { startSlotGenerationJob } from './jobs/slotGeneration.cron';
import { startAutoCancelJob } from './jobs/autoCancelOrders.cron';

const app = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8081',
  ...(process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || []),
  ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
].filter(Boolean);

// Socket.IO — permissive because mobile clients have no origin header
const io = new SocketIOServer(server, {
  cors: { origin: (origin, cb) => cb(null, true), credentials: true },
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
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  handler: (req, res) => {
    logger.warn('Global rate limit hit', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  handler: (req, res) => {
    logger.warn('Auth rate limit hit', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  },
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many payment requests.' },
  handler: (req, res) => {
    logger.warn('Payment rate limit hit', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Too many payment requests.' });
  },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many password reset attempts. Try again in an hour.' },
  handler: (req, res) => {
    logger.warn('Forgot-password rate limit hit', { ip: req.ip });
    res.status(429).json({ error: 'Too many password reset attempts. Try again in an hour.' });
  },
});

app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/orders', paymentLimiter);

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
