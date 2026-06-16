import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';

// Load .env for local dev; in production env vars are injected by the platform
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import leadsRouter from '../routes/leads';
import outreachRouter from '../routes/outreach';
import signalsRouter from '../routes/signals';
import metricsRouter from '../routes/metrics';
import cronRouter, { initCronJobs } from '../routes/cron';
import configRouter from '../routes/config';
import authRouter from '../routes/auth';
import { authenticate } from './middleware/auth';

const app = express();
const PORT = process.env.BACKEND_PORT ?? 3001;

// ---- Security middleware ----
app.use(helmet());
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.FRONTEND_URL ?? '').split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  credentials: true,
}));

// ---- Rate limiting ----
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Tighter limit on credential endpoints to prevent brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Separate, more lenient limit for refresh — the frontend calls this automatically
// every 14 minutes per tab. 60/15min allows ~4 concurrent tabs with headroom.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, error: 'Too many refresh attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/refresh', refreshLimiter);

// ---- Logging & parsing ----
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- Health check (unauthenticated — needed by Render and monitoring) ----
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'anta-lead-radar-api', timestamp: new Date().toISOString() });
});

// ---- Auth routes (no protection — this is the auth surface itself) ----
app.use('/api/auth', authRouter);

// ---- Protected API Routes ----
app.use('/api/leads',    authenticate, leadsRouter);
app.use('/api/outreach', authenticate, outreachRouter);
app.use('/api/signals',  authenticate, signalsRouter);
app.use('/api/metrics',  authenticate, metricsRouter);
app.use('/api/config',   authenticate, configRouter);
app.use('/api/cron',     authenticate, cronRouter);

// ---- 404 handler ----
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ---- Error handler ----
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`ANTA Lead Radar API running on http://localhost:${PORT}`);
  initCronJobs();
});

export default app;
