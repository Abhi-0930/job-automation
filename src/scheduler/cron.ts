import cron from 'node-cron';
import { jobCollector } from '../jobs/collector.js';
import { publishingQueue } from '../publisher/queue.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export class SchedulerService {
  private tasks: cron.ScheduledTask[] = [];

  /**
   * Initializes all cron schedules.
   */
  public start(): void {
    logger.info('⏰ Initializing Cron Scheduler...');

    // 1. Scraping & Ingestion Task (Default: Every 15 minutes)
    const collectionTask = cron.schedule(env.CRON_COLLECTION, async () => {
      logger.info('⏰ [CRON TRIGGER] Running 15-Minute Job Collection...');
      try {
        await jobCollector.collectAndProcess();
      } catch (error) {
        logger.error('Error during scheduled job collection: %s', (error as Error).message);
      }
    });
    this.tasks.push(collectionTask);
    logger.info('   ✔ Job Collection: %s', env.CRON_COLLECTION);

    // 2. Tech Jobs Publishing (2x Daily: 9:00 AM & 4:00 PM)
    const techTask = cron.schedule(env.CRON_TECH, async () => {
      logger.info('⏰ [CRON TRIGGER] Publishing Top Tech Jobs Batch (2x Daily Slot)...');
      try {
        await publishingQueue.publishCategoryBatch('TECH');
      } catch (error) {
        logger.error('Error during Tech publishing: %s', (error as Error).message);
      }
    });
    this.tasks.push(techTask);
    logger.info('   ✔ Tech Jobs (2x Daily): %s', env.CRON_TECH);

    // 3. Government Jobs Publishing (Default: 11:00 AM)
    const govtTask = cron.schedule(env.CRON_GOVT, async () => {
      logger.info('⏰ [CRON TRIGGER] 11:00 AM - Publishing Top Govt Jobs...');
      try {
        await publishingQueue.publishCategoryBatch('GOVT');
      } catch (error) {
        logger.error('Error during 11:00 AM Govt publishing: %s', (error as Error).message);
      }
    });
    this.tasks.push(govtTask);
    logger.info('   ✔ 11:00 AM Govt Jobs: %s', env.CRON_GOVT);

    // 4. Internships Publishing (Default: 1:00 PM)
    const internshipTask = cron.schedule(env.CRON_INTERNSHIP, async () => {
      logger.info('⏰ [CRON TRIGGER] 1:00 PM - Publishing Top Internships...');
      try {
        await publishingQueue.publishCategoryBatch('INTERNSHIP');
      } catch (error) {
        logger.error('Error during 1:00 PM Internship publishing: %s', (error as Error).message);
      }
    });
    this.tasks.push(internshipTask);
    logger.info('   ✔ 1:00 PM Internships: %s', env.CRON_INTERNSHIP);

    // 5. Non-Tech Jobs Publishing (2x Daily: 2:00 PM & 6:00 PM)
    const nonTechTask = cron.schedule(env.CRON_NON_TECH, async () => {
      logger.info('⏰ [CRON TRIGGER] Publishing Top Non-Tech Jobs Batch (2x Daily Slot)...');
      try {
        await publishingQueue.publishCategoryBatch('NON_TECH');
      } catch (error) {
        logger.error('Error during Non-Tech publishing: %s', (error as Error).message);
      }
    });
    this.tasks.push(nonTechTask);
    logger.info('   ✔ Non-Tech Jobs (2x Daily): %s', env.CRON_NON_TECH);

    // 7. Referrals & Networking Publishing (Default: 7:00 PM)
    const referralTask = cron.schedule(env.CRON_REFERRAL, async () => {
      logger.info('⏰ [CRON TRIGGER] 7:00 PM - Publishing Top Referrals...');
      try {
        await publishingQueue.publishCategoryBatch('REFERRAL');
      } catch (error) {
        logger.error('Error during 7:00 PM Referrals publishing: %s', (error as Error).message);
      }
    });
    this.tasks.push(referralTask);
    logger.info('   ✔ 7:00 PM Referrals: %s', env.CRON_REFERRAL);

    // 8. Daily Digest Publishing (Default: 8:00 PM)
    const digestTask = cron.schedule(env.CRON_DIGEST, async () => {
      logger.info('⏰ [CRON TRIGGER] 8:00 PM - Publishing Daily Digest...');
      try {
        await publishingQueue.publishDailyDigest();
      } catch (error) {
        logger.error('Error during 8:00 PM Daily Digest: %s', (error as Error).message);
      }
    });
    this.tasks.push(digestTask);
    logger.info('   ✔ 8:00 PM Daily Digest: %s', env.CRON_DIGEST);

    logger.info('✅ All %d cron tasks scheduled and active.', this.tasks.length);
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
