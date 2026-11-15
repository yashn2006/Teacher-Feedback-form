import path from 'path';
import express from 'express';
import { createApp } from './server/app';
import { assertConfig, config } from './server/config';
import { db } from './server/db';

async function startServer() {
  assertConfig();
  const app = createApp();

  if (config.isProd) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`SIES Teacher Evaluation System listening on http://0.0.0.0:${config.port}`);
    console.log(`AI question generator: ${config.ai.provider}`);
  });

  const shutdown = () => {
    server.close(() => {
      db.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
