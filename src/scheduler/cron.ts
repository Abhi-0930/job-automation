import cron from 'node-cron';
import { jobCollector } from '../jobs/collector.js';
import { publishingQueue } from '../publisher/queue.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export class SchedulerService {
  private tasks: cron.ScheduledTask[] = [];

  private registerSchedule(
    cronConfig: string,
    label: string,
    action: () => Promise<void>,
    tzOptions: { timezone: string }
  ): void {
    const expressions = cronConfig
      .split(/[|;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const expr of expressions) {
      const task = cron.schedule(expr, action, tzOptions);
      this.tasks.push(task);
      logger.info('   ✔ %s: %s', label, expr);
    }
  }

  /**
   * Initializes all cron schedules.
   */
  public start(): void {
    logger.info('⏰ Initializing Cron Scheduler...');

    const tzOptions = { timezone: 'Asia/Kolkata' };

    // 1. Scraping & Ingestion Task (Default: Every 15 minutes)
    this.registerSchedule(
      env.CRON_COLLECTION,
      'Job Collection (Every 15m IST)',
      async () => {
        logger.info('⏰ [CRON TRIGGER] Running 15-Minute Job Collection...');
        try {
          await jobCollector.collectAndProcess();
        } catch (error) {
          logger.error('Error during scheduled job collection: %s', (error as Error).message);
        }
      },
      tzOptions
    );

    // 2. Government Jobs Publishing (8:45 AM & 8:15 PM IST)
    this.registerSchedule(
      env.CRON_GOVT,
      'Govt Jobs (IST)',
      async () => {
        logger.info('⏰ [CRON TRIGGER] Publishing Top Govt Jobs...');
        try {
          await publishingQueue.publishCategoryBatch('GOVT');
        } catch (error) {
          logger.error('Error during Govt publishing: %s', (error as Error).message);
        }
      },
      tzOptions
    );

    // 3. Tech Jobs Publishing (9:45 AM & 6:15 PM IST)
    this.registerSchedule(
      env.CRON_TECH,
      'Tech Jobs (IST)',
      async () => {
        logger.info('⏰ [CRON TRIGGER] Publishing Top Tech Jobs...');
        try {
          await publishingQueue.publishCategoryBatch('TECH');
        } catch (error) {
          logger.error('Error during Tech publishing: %s', (error as Error).message);
        }
      },
      tzOptions
    );

    // 4. Internships Publishing (10:15 AM & 5:30 PM IST)
    this.registerSchedule(
      env.CRON_INTERNSHIP,
      'Internships (IST)',
      async () => {
        logger.info('⏰ [CRON TRIGGER] Publishing Top Internships...');
        try {
          await publishingQueue.publishCategoryBatch('INTERNSHIP');
        } catch (error) {
          logger.error('Error during Internship publishing: %s', (error as Error).message);
        }
      },
      tzOptions
    );

    // 5. Non-Tech Jobs Publishing (11:00 AM & 7:15 PM IST)
    this.registerSchedule(
      env.CRON_NON_TECH,
      'Non-Tech Jobs (IST)',
      async () => {
        logger.info('⏰ [CRON TRIGGER] Publishing Top Non-Tech Jobs...');
        try {
          await publishingQueue.publishCategoryBatch('NON_TECH');
        } catch (error) {
          logger.error('Error during Non-Tech publishing: %s', (error as Error).message);
        }
      },
      tzOptions
    );

    // 6. Referrals & Networking (1:45 PM IST)
    this.registerSchedule(
      env.CRON_REFERRAL,
      'Referrals & Networking (IST)',
      async () => {
        logger.info('⏰ [CRON TRIGGER] Publishing Top Referrals...');
        try {
          await publishingQueue.publishCategoryBatch('REFERRAL');
        } catch (error) {
          logger.error('Error during Referrals publishing: %s', (error as Error).message);
        }
      },
      tzOptions
    );

    // 7. Daily Digest Publishing (9:00 PM IST)
    this.registerSchedule(
      env.CRON_DIGEST,
      'Daily Digest (IST)',
      async () => {
        logger.info('⏰ [CRON TRIGGER] Publishing Daily Digest...');
        try {
          await publishingQueue.publishDailyDigest();
        } catch (error) {
          logger.error('Error during Daily Digest: %s', (error as Error).message);
        }
      },
      tzOptions
    );

    logger.info('✅ All %d cron tasks scheduled and active (Timezone: Asia/Kolkata).', this.tasks.length);
  }

  /**
   * Stops all active schedules.
   */
  public stop(): void {
    logger.info('Stopping all scheduled cron tasks...');
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }
}

export const schedulerService = new SchedulerService();
