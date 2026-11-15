import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { db } from './db';
import { errorHandler } from './errors';
import { adminRouter } from './routes/admin';
import { aiRouter } from './routes/ai';
import { analysisRouter } from './routes/analysis';
import { authRouter } from './routes/auth';
import { studentRouter } from './routes/student';

/** The API only. server.ts adds the React app (Vite in development, static files in production). */
export function createApp() {
  const app = express();

  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      // AI Studio shows the app inside a frame during development.
      frameguard: config.isProd ? { action: 'sameorigin' } : false,
    })
  );

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('select 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/student', studentRouter);
  // Analysis is open to HODs too, so it is mounted before the admin-only router.
  app.use('/api/admin/analysis', analysisRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use(errorHandler);
  return app;
}
