import http from 'http';
import { connectDatabase, disconnectDatabase } from './database/prisma.js';
import { schedulerService } from './scheduler/cron.js';
import { jobCollector } from './jobs/collector.js';
import { publishingQueue } from './publisher/queue.js';
import { JobCategory } from './types/job.js';
import { restoreSessionFromCloud } from './publisher/session-sync.js';
import { logger } from './config/logger.js';
import { env } from './config/env.js';

async function bootstrap() {
  logger.info('====================================================');
  logger.info('🤖 JOB AGGREGATION & DISTRIBUTION SYSTEM');
  logger.info('====================================================');
  logger.info('Environment: %s | Dry Run: %s | Log Level: %s', env.NODE_ENV, env.DRY_RUN, env.LOG_LEVEL);
  logger.info('WhatsApp Groups:');
  logger.info('  💻 Tech:        "%s"', env.WHATSAPP_GROUP_TECH);
  logger.info('  🎓 Internship:  "%s"', env.WHATSAPP_GROUP_INTERNSHIP);
  logger.info('  🏢 Non-Tech:    "%s"', env.WHATSAPP_GROUP_NON_TECH);
  logger.info('  🏛️ Govt:        "%s"', env.WHATSAPP_GROUP_GOVT);
  logger.info('  📚 Cohort:      "%s"', env.WHATSAPP_GROUP_COHORT);
  logger.info('  🤝 Referral:    "%s"', env.WHATSAPP_GROUP_REFERRAL);
  logger.info('  🔥 Community:   "%s"', env.WHATSAPP_GROUP_COMMUNITY);
  logger.info('====================================================');

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : env.PORT;

  // 1. Start Lightweight HTTP Server IMMEDIATELY for Render Health Checks & Keep-Alive
  let dbReady = false;
  let sessionReady = false;

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (parsedUrl.pathname === '/health' || parsedUrl.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          dbReady,
          sessionReady,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (parsedUrl.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'online',
          uptime: process.uptime(),
          dbReady,
          sessionReady,
          crons: {
            tech: env.CRON_TECH,
            internship: env.CRON_INTERNSHIP,
            nonTech: env.CRON_NON_TECH,
            govt: env.CRON_GOVT,
            referral: env.CRON_REFERRAL,
            digest: env.CRON_DIGEST,
          },
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (parsedUrl.pathname === '/publish-now') {
      const categoryParam = parsedUrl.searchParams.get('category');
      const digestParam = parsedUrl.searchParams.get('digest');
      const limitParam = parseInt(parsedUrl.searchParams.get('limit') || '1', 10);

      try {
        if (digestParam === 'true' || digestParam === '1') {
          logger.info('🌐 [/publish-now] Triggering on-demand Daily Digest...');
          const success = await publishingQueue.publishDailyDigest();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ action: 'digest', success }));
          return;
        }

        const cat = (categoryParam || 'TECH').toUpperCase() as JobCategory;
        logger.info('🌐 [/publish-now] Triggering on-demand batch for category %s (limit: %d)...', cat, limitParam);
        const count = await publishingQueue.publishCategoryBatch(cat, limitParam);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ action: 'publish', category: cat, publishedCount: count }));
      } catch (err) {
        logger.error('Error during on-demand publish: %s', (err as Error).message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    if (parsedUrl.pathname === '/collect-now') {
      try {
        logger.info('🌐 [/collect-now] Triggering on-demand scraping & ingestion...');
        const summary = await jobCollector.collectAndProcess();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ action: 'collect', summary }));
      } catch (err) {
        logger.error('Error during on-demand collect: %s', (err as Error).message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info('🌐 Health check server listening on port %d (http://0.0.0.0:%d/health)', port, port);
  });

  // 2. Connect to Database & Restore Session
  const dbOk = await connectDatabase();
  if (!dbOk) {
    logger.error('Database connection failed. Please ensure PostgreSQL is running.');
  } else {
    dbReady = true;
    // Restore WhatsApp Cloud Session
    sessionReady = await restoreSessionFromCloud();
  }

  // 3. Start Cron Scheduler
  schedulerService.start();

  // 4. Run an initial quick collection on startup if in development mode
  if (env.NODE_ENV === 'development' && dbOk) {
    logger.info('🔄 [Startup] Running initial collection cycle...');
    jobCollector.collectAndProcess().catch((err) => {
      logger.warn('Initial startup collection encountered error: %s', (err as Error).message);
    });
  }

  // 5. Graceful Shutdown Handlers
  const handleShutdown = async (signal: string) => {
    logger.info('\nReceived %s signal. Performing graceful shutdown...', signal);
    schedulerService.stop();
    server.close();
    await disconnectDatabase();
    logger.info('👋 Process terminated cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error('Fatal initialization error: %s', (error as Error).message);
  process.exit(1);
});
