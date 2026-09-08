import { Command } from 'commander';
import { connectDatabase, disconnectDatabase } from '../database/prisma.js';
import { jobCollector } from '../jobs/collector.js';
import { scraperManager } from '../scrapers/index.js';
import { whatsAppPublisher } from '../publisher/whatsapp.js';
import { publishingQueue } from '../publisher/queue.js';
import { schedulerService } from '../scheduler/cron.js';
import { JobCategory } from '../types/job.js';
import { logger } from '../config/logger.js';

const program = new Command();

program
  .name('job-automation')
  .description('Job Aggregation and Distribution System CLI')
  .version('1.0.0');

// Command: WhatsApp Interactive Authentication
program
  .command('auth')
  .description('Launch browser to scan WhatsApp Web QR code and persist session')
  .action(async () => {
    try {
      await whatsAppPublisher.interactiveAuth();
    } catch (error) {
      logger.error('Auth error: %s', (error as Error).message);
    }
  });

// Command: Backup Session to Cloud DB
program
  .command('session:push')
  .description('Backup local WhatsApp session to Neon Cloud DB')
  .action(async () => {
    const connected = await connectDatabase();
    if (!connected) process.exit(1);
    try {
      const { backupSessionToCloud } = await import('../publisher/session-sync.js');
      await backupSessionToCloud();
    } finally {
      await disconnectDatabase();
    }
  });

// Command: Restore Session from Cloud DB
program
  .command('session:pull')
  .description('Restore WhatsApp session from Neon Cloud DB')
  .action(async () => {
    const connected = await connectDatabase();
    if (!connected) process.exit(1);
    try {
      const { restoreSessionFromCloud } = await import('../publisher/session-sync.js');
      await restoreSessionFromCloud();
    } finally {
      await disconnectDatabase();
    }
  });

// Command: Run Scrapers Only
program
  .command('scrape')
  .description('Run job scrapers and print results')
  .option('-s, --source <source>', 'Specific source to scrape: linkedin, internshala, wellfound, careers')
  .action(async (options) => {
    try {
      if (options.source) {
        logger.info('Scraping source: %s', options.source);
        const results = await scraperManager.runSource(options.source);
        logger.info('Scraped %d jobs from %s', results.length, options.source);
        console.table(results.slice(0, 10).map(j => ({ source: j.source, title: j.title.slice(0, 30), company: j.company, location: j.location })));
      } else {
        const results = await scraperManager.runAll();
        logger.info('Total scraped jobs across all sources: %d', results.length);
        console.table(results.slice(0, 15).map(j => ({ source: j.source, title: j.title.slice(0, 30), company: j.company, location: j.location })));
      }
    } catch (error) {
      logger.error('Scrape error: %s', (error as Error).message);
    }
  });

// Command: Full Collect and Ingest (Scrape + Deduplicate + Classify + Score)
program
  .command('collect')
  .description('Run end-to-end collection, deduplication, AI classification and scoring')
  .action(async () => {
    const connected = await connectDatabase();
    if (!connected) process.exit(1);

    try {
      const summary = await jobCollector.collectAndProcess();
      logger.info('Collection Summary: Scraped=%d, Unique=%d, Processed=%d', summary.scrapedCount, summary.newUniqueCount, summary.processedCount);
    } catch (error) {
      logger.error('Collection error: %s', (error as Error).message);
    } finally {
      await disconnectDatabase();
    }
  });

// Command: Process Pending Raw Jobs
program
  .command('process')
  .description('Classify and score pending raw jobs in jobs_raw table')
  .action(async () => {
    const connected = await connectDatabase();
    if (!connected) process.exit(1);

    try {
      const count = await jobCollector.processUnprocessedJobs();
      logger.info('Processed %d raw jobs into clean jobs', count);
    } catch (error) {
      logger.error('Process error: %s', (error as Error).message);
    } finally {
      await disconnectDatabase();
    }
  });

// Command: Publish Category Batch or Daily Digest
program
  .command('publish')
  .description('Publish top scored jobs for a category or daily digest to WhatsApp group')
  .option('-c, --category <category>', 'Category to publish: TECH, INTERNSHIP, NON_TECH, GOVT, COHORT, REFERRAL')
  .option('-l, --limit <limit>', 'Maximum jobs to publish', '5')
  .option('-d, --digest', 'Generate and publish 8:00 PM daily digest of top picks')
  .action(async (options) => {
    const connected = await connectDatabase();
    if (!connected) process.exit(1);

    try {
      if (options.digest) {
        await publishingQueue.publishDailyDigest();
        return;
      }

      if (!options.category) {
        logger.error('Error: Please specify -c, --category <CATEGORY> (e.g. TECH, INTERNSHIP, NON_TECH, GOVT) or --digest');
        return;
      }

      const category = options.category.toUpperCase() as JobCategory;
      const limit = parseInt(options.limit, 10) || 5;
      await publishingQueue.publishCategoryBatch(category, limit);
    } catch (error) {
      logger.error('Publish error: %s', (error as Error).message);
    } finally {
      await disconnectDatabase();
    }
  });

// Command: Publish Daily Digest
program
  .command('digest')
  .description('Generate and send daily digest of top picks to WhatsApp community')
  .action(async () => {
    const connected = await connectDatabase();
    if (!connected) process.exit(1);

    try {
      await publishingQueue.publishDailyDigest();
    } catch (error) {
      logger.error('Digest error: %s', (error as Error).message);
    } finally {
      await disconnectDatabase();
    }
  });

// Command: Start Scheduler Daemon
program
  .command('daemon')
  .description('Start long-running background scheduler daemon')
  .action(async () => {
    const connected = await connectDatabase();
    if (!connected) process.exit(1);

    logger.info('🚀 Starting Job Aggregation & Distribution System daemon...');
    schedulerService.start();

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info('Received %s. Shutting down gracefully...', signal);
      schedulerService.stop();
      await disconnectDatabase();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

program.parse(process.argv);
