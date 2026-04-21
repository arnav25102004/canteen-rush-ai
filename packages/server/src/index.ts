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
console.log('Looking for .env at:', path.resolve(__dirname, '../.env'));
console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? 'LOADED ✅' : 'MISSING ❌');
console.log('All env keys:', Object.keys(process.env).filter(k => k.includes('RAZORPAY')));

import { prisma } from './config/database';
import { redis } from './config/redis';
import { setupSocketIO } from './socket/orderSocket';

// Routes
import authRoutes from './routes/auth.routes';
import canteenRoutes from './routes/canteen.routes';
import menuRoutes from './routes/menu.routes';
import slotRoutes from './routes/slot.routes';
import orderRoutes from './routes/order.routes';
import walletRoutes from './routes/wallet.routes';
import paymentRoutes from './routes/payment.routes';
import notificationRoutes from './routes/notification.routes';
import adminRoutes from './routes/admin.routes';
import analyticsRoutes from './routes/analytics.routes';

// Jobs
import { startSlotGenerationJob } from './jobs/slotGeneration.cron';
import { startAutoCancelJob } from './jobs/autoCancelOrders.cron';

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8081',
  ...(process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || []),
  ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
].filter(Boolean);

// Socket.IO setup
const io = new SocketIOServer(server, {
  cors: { origin: (origin, cb) => cb(null, true), credentials: true },
});

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (mobile apps, health checks) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, true); // permissive for now — tighten in production
  },
  credentials: true,
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Attach io to requests
app.use((req: any, _res, next) => {
  req.io = io;
  next();
});

// Health check (both paths for compatibility)
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API Routes
app.use('/api/auth', authRoutes);
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

// Setup Socket.IO
setupSocketIO(io);

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ error: message });
});

const PORT = parseInt(process.env.PORT || '3001', 10);

async function bootstrap() {
  try {
    await prisma.$connect();
    console.log('PostgreSQL connected');

    await redis.ping();
    console.log('Redis connected');

    // Start background jobs
    startSlotGenerationJob();
    startAutoCancelJob();

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Socket.IO ready`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();

export { io };
