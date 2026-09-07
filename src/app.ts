import http from 'http';
import { connectDatabase, disconnectDatabase } from './database/prisma.js';
import { schedulerService } from './scheduler/cron.js';
import { jobCollector } from './jobs/collector.js';
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

  // 1. Connect to Database
  const dbOk = await connectDatabase();
  if (!dbOk) {
    logger.error('Database connection failed. Please ensure PostgreSQL is running.');
  }

  // 2. Start Cron Scheduler
  schedulerService.start();

  // 3. Run an initial quick collection on startup if in development mode
  if (env.NODE_ENV === 'development' && dbOk) {
    logger.info('🔄 [Startup] Running initial collection cycle...');
    jobCollector.collectAndProcess().catch((err) => {
      logger.warn('Initial startup collection encountered error: %s', (err as Error).message);
    });
  }

  // 4. Start Lightweight HTTP Server for Render Health Checks & Keep-Alive
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.listen(env.PORT, '0.0.0.0', () => {
    logger.info('🌐 Health check server listening on port %d (http://0.0.0.0:%d/health)', env.PORT, env.PORT);
  });

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
