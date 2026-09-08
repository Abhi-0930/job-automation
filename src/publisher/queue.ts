import { prisma } from '../database/prisma.js';
import { whatsAppPublisher } from './whatsapp.js';
import { formatDailyDigestMessage } from '../ai/formatter.js';
import { verifyJobApplicationActive } from '../jobs/verifier.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { JobCategory } from '../types/job.js';

export class PublishingQueue {
  /**
   * Maps job category to configured WhatsApp group name.
   */
  private getGroupNameForCategory(category: JobCategory): string {
    switch (category) {
      case 'TECH':
        return env.WHATSAPP_GROUP_TECH;
      case 'INTERNSHIP':
        return env.WHATSAPP_GROUP_INTERNSHIP;
      case 'NON_TECH':
        return env.WHATSAPP_GROUP_NON_TECH;
      case 'GOVT':
        return env.WHATSAPP_GROUP_GOVT;
      case 'COHORT':
        return env.WHATSAPP_GROUP_COHORT;
      case 'REFERRAL':
        return env.WHATSAPP_GROUP_REFERRAL;
      default:
        return env.WHATSAPP_GROUP_COMMUNITY;
    }
  }

  /**
   * Publishes top jobs for a specific category to its WhatsApp group.
   */
  public async publishCategoryBatch(category: JobCategory, limit: number = env.MAX_JOBS_PER_BATCH): Promise<number> {
    if (category === 'COHORT') {
      logger.info('ℹ️ [PublishQueue] "Cohorts & Upskilling" is reserved for manual course promotions. Automated publishing skipped.');
      return 0;
    }

    const groupName = this.getGroupNameForCategory(category);
    const minScore = env.MIN_SCORE_TO_PUBLISH;

    logger.info('📣 [PublishQueue] Fetching top %s jobs (score >= %d, target: %d) for group "%s"', category, minScore, limit, groupName);

    // Category-specific filters (Ensure Tech/Non-Tech never get internships)
    const titleFilter =
      category === 'INTERNSHIP'
        ? {} // All jobs in INTERNSHIP category are valid
        : {
            not: {
              contains: 'intern',
              mode: 'insensitive' as const,
            },
          };

    // Fetch candidate pool (with buffer to filter out closed jobs)
    const candidateJobs = await prisma.job.findMany({
      where: {
        category,
        score: { gte: minScore },
        status: { notIn: ['PUBLISHED', 'ARCHIVED', 'FAILED'] },
        title: titleFilter,
        experience: {
          not: {
            contains: '2+ Years',
          },
        },
      },
      orderBy: [
        { score: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit * 4,
    });

    if (candidateJobs.length === 0) {
      logger.info('ℹ️ [PublishQueue] No unposted %s jobs found meeting criteria (score >= %d)', category, minScore);
      return 0;
    }

    logger.info('🔍 [PublishQueue] Checking %d candidate jobs for active status before sending...', candidateJobs.length);
    let publishedCount = 0;

    for (const job of candidateJobs) {
      if (publishedCount >= limit) break;

      // 1. Live Pre-Flight Check: Verify application is still actively accepting submissions
      const verification = await verifyJobApplicationActive(job.url);
      if (!verification.isActive) {
        logger.warn(
          '🚫 [Verifier] Job "%s" at "%s" is CLOSED (%s). Archiving and skipping...',
          job.title,
          job.company,
          verification.reason
        );
        await prisma.job.update({
          where: { id: job.id },
          data: { status: 'ARCHIVED' },
        });
        continue;
      }

      // 2. Format & Send WhatsApp message
      const message = job.whatsappMessage || `${job.title} at ${job.company}\n${job.url}`;
      const result = await whatsAppPublisher.sendMessage(groupName, message);

      const status = result.success ? (env.DRY_RUN ? 'SIMULATED' : 'SUCCESS') : 'FAILED';

      // 3. Log publishing event
      await prisma.publishLog.create({
        data: {
          jobId: job.id,
          groupName,
          category,
          status,
          error: result.error || null,
          message,
        },
      });

      if (result.success) {
        // Mark job as published
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        });
        publishedCount++;
      } else {
        logger.error('Failed publishing job %s to %s: %s', job.id, groupName, result.error);
      }
    }

    logger.info('🎉 [PublishQueue] Published %d active %s jobs to "%s"', publishedCount, category, groupName);
    return publishedCount;
  }

  /**
   * Generates and publishes the 8:00 PM Daily Digest to the main WhatsApp community group.
   */
  public async publishDailyDigest(): Promise<boolean> {
    const groupName = env.WHATSAPP_GROUP_COMMUNITY;
    logger.info('📰 [PublishQueue] Generating Daily Digest for community group "%s"', groupName);

    const now = new Date();
    const todayStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    // Fetch top 3 Tech, top 2 Internships, top 2 Non-Tech from the last 24h
    const [techJobs, internships, nonTechJobs] = await Promise.all([
      prisma.job.findMany({
        where: { category: 'TECH', score: { gte: 65 } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: 3,
        select: { title: true, company: true, location: true, url: true, score: true },
      }),
      prisma.job.findMany({
        where: { category: 'INTERNSHIP', score: { gte: 65 } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: 2,
        select: { title: true, company: true, location: true, url: true, score: true },
      }),
      prisma.job.findMany({
        where: { category: 'NON_TECH', score: { gte: 65 } },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: 2,
        select: { title: true, company: true, location: true, url: true, score: true },
      }),
    ]);

    const totalCount = techJobs.length + internships.length + nonTechJobs.length;

    if (totalCount === 0) {
      logger.info('ℹ️ [PublishQueue] No opportunities available to compile Daily Digest.');
      return false;
    }

    const digestText = formatDailyDigestMessage({
      date: todayStr,
      techJobs,
      internships,
      nonTechJobs,
      totalCount,
    });

    const result = await whatsAppPublisher.sendMessage(groupName, digestText);
    const status = result.success ? (env.DRY_RUN ? 'SIMULATED' : 'SUCCESS') : 'FAILED';

    await prisma.publishLog.create({
      data: {
        groupName,
        category: 'DIGEST',
        status,
        error: result.error || null,
        message: digestText,
      },
    });

    logger.info('🎉 [PublishQueue] Daily Digest sent to "%s" (%s)', groupName, status);
    return result.success;
  }
}

export const publishingQueue = new PublishingQueue();
