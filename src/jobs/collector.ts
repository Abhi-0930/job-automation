import { prisma } from '../database/prisma.js';
import { scraperManager } from '../scrapers/index.js';
import { filterUniqueJobs } from './deduplicate.js';
import { classifyJob } from '../ai/classify.js';
import { scoreJob } from '../ai/score.js';
import { formatWhatsAppJobMessage } from '../ai/formatter.js';
import { logger } from '../config/logger.js';
import { RawScrapedJob } from '../types/job.js';

export class JobCollector {
  /**
   * Main collector routine: Scrape -> Deduplicate -> Save Raw -> Classify -> Score -> Insert Clean Jobs.
   */
  public async collectAndProcess(): Promise<{
    scrapedCount: number;
    newUniqueCount: number;
    processedCount: number;
  }> {
    logger.info('🔄 [Collector] Starting job collection and ingestion pipeline...');
    const startTime = Date.now();

    // 1. Scrape all 4 sources
    const scrapedJobs: RawScrapedJob[] = await scraperManager.runAll();
    const scrapedCount = scrapedJobs.length;

    if (scrapedCount === 0) {
      logger.warn('[Collector] No jobs scraped from any source.');
      return { scrapedCount: 0, newUniqueCount: 0, processedCount: 0 };
    }

    // 2. Deduplicate
    const uniqueJobs = await filterUniqueJobs(scrapedJobs);
    const newUniqueCount = uniqueJobs.length;

    if (newUniqueCount === 0) {
      logger.info('[Collector] All %d scraped jobs already exist in database.', scrapedCount);
      return { scrapedCount, newUniqueCount: 0, processedCount: 0 };
    }

    // 3. Ingest into jobs_raw
    let savedRawCount = 0;
    const rawJobRecords: Array<{ id: string; hash: string }> = [];

    for (const job of uniqueJobs) {
      try {
        const record = await prisma.rawJob.upsert({
          where: { hash: job.hash },
          update: {},
          create: {
            source: job.source,
            externalId: job.externalId || null,
            title: job.title,
            company: job.company,
            location: job.location,
            description: job.description,
            url: job.url,
            hash: job.hash,
            metadata: job.metadata as object,
            processed: false,
          },
        });
        savedRawCount++;
        rawJobRecords.push({ id: record.id, hash: record.hash });
      } catch (err) {
        logger.error('[Collector] Error saving raw job %s: %s', job.hash, (err as Error).message);
      }
    }

    logger.info('[Collector] Saved %d new records to jobs_raw', savedRawCount);

    // 4. Process unprocessed raw jobs (Classify, Score, Format & Insert into jobs table)
    const processedCount = await this.processUnprocessedJobs();

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(
      '✅ [Collector] Finished pipeline in %ss: Scraped: %d, Unique: %d, Processed: %d',
      durationSec,
      scrapedCount,
      newUniqueCount,
      processedCount
    );

    return { scrapedCount, newUniqueCount, processedCount };
  }

  /**
   * Processes all pending raw jobs from jobs_raw table into clean jobs.
   */
  public async processUnprocessedJobs(): Promise<number> {
    const pendingRaw = await prisma.rawJob.findMany({
      where: { processed: false },
      take: 50,
      orderBy: { scrapedAt: 'desc' },
    });

    if (pendingRaw.length === 0) {
      return 0;
    }

    logger.info('[Processor] Processing %d pending raw jobs...', pendingRaw.length);
    let count = 0;

    for (const raw of pendingRaw) {
      try {
        // A. Classify (Rule Engine -> DeepSeek Fallback)
        const classification = await classifyJob(raw.title, raw.description, raw.location);

        // B. Score (DeepSeek Scoring 1-100)
        const scoring = await scoreJob({
          title: raw.title,
          company: raw.company,
          location: raw.location,
          description: raw.description,
          isRemote: classification.isRemote,
          category: classification.category,
        });

        // C. Generate WhatsApp Message
        const whatsappMsg = formatWhatsAppJobMessage({
          title: raw.title,
          company: raw.company,
          location: raw.location,
          experience: classification.experience,
          isRemote: classification.isRemote,
          skills: classification.skills,
          url: raw.url,
          category: classification.category,
          score: scoring.score,
        });

        // D. Insert into jobs table
        await prisma.job.upsert({
          where: { hash: raw.hash },
          update: {
            category: classification.category,
            subcategory: classification.subcategory,
            score: scoring.score,
            scoreReasoning: scoring.reasoning,
            isRemote: classification.isRemote,
            experience: classification.experience,
            skills: classification.skills,
            whatsappMessage: whatsappMsg,
            status: 'SCORED',
          },
          create: {
            rawJobId: raw.id,
            title: raw.title,
            company: raw.company,
            location: raw.location,
            description: raw.description,
            url: raw.url,
            hash: raw.hash,
            category: classification.category,
            subcategory: classification.subcategory,
            score: scoring.score,
            scoreReasoning: scoring.reasoning,
            isRemote: classification.isRemote,
            experience: classification.experience,
            skills: classification.skills,
            whatsappMessage: whatsappMsg,
            status: 'SCORED',
          },
        });

        // E. Mark raw job as processed
        await prisma.rawJob.update({
          where: { id: raw.id },
          data: { processed: true },
        });

        count++;
        logger.debug(
          '[Processor] Processed job [%s]: %s at %s -> Score: %d (%s)',
          classification.category,
          raw.title,
          raw.company,
          scoring.score,
          classification.source
        );
      } catch (err) {
        logger.error('[Processor] Failed to process raw job %s: %s', raw.id, (err as Error).message);
      }
    }

    return count;
  }
}

export const jobCollector = new JobCollector();
