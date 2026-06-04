import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

// Load .env for local dev; in production env vars are injected by the platform
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import leadsRouter from '../routes/leads';
import outreachRouter from '../routes/outreach';
import signalsRouter from '../routes/signals';
import metricsRouter from '../routes/metrics';
import cronRouter from '../routes/cron';
import configRouter from '../routes/config';

const app = express();
const PORT = process.env.BACKEND_PORT ?? 3001;

// ---- Security middleware ----
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : ['http://localhost:3000', 'http://localhost:3001'],
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

// ---- Logging & parsing ----
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- Health check ----
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'anta-lead-radar-api', timestamp: new Date().toISOString() });
});

// ---- API Routes ----
app.use('/api/leads', leadsRouter);
app.use('/api/outreach', outreachRouter);
app.use('/api/signals', signalsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/cron', cronRouter);
app.use('/api/config', configRouter);

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
});

export default app;
