import crypto from 'crypto';
import { prisma } from '../database/prisma.js';
import { logger } from '../config/logger.js';
import { RawScrapedJob } from '../types/job.js';

/**
 * Normalizes text for consistent canonical hashing.
 * Removes symbols, punctuation, and extra whitespace, and converts to lowercase.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates SHA-256 hash for deduplication using company, title, and location.
 */
export function generateJobHash(company: string, title: string, location: string): string {
  const normCompany = normalizeText(company);
  const normTitle = normalizeText(title);
  const normLocation = normalizeText(location);

  const rawKey = `${normCompany}|${normTitle}|${normLocation}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export interface DedupCheckResult {
  isDuplicate: boolean;
  hash: string;
  reason?: 'EXISTS_IN_RAW' | 'EXISTS_IN_JOBS';
}

/**
 * Checks whether a job hash already exists in jobs_raw or jobs table.
 */
export async function checkDuplicate(hash: string): Promise<DedupCheckResult> {
  try {
    const existingRaw = await prisma.rawJob.findUnique({
      where: { hash },
      select: { id: true },
    });

    if (existingRaw) {
      return { isDuplicate: true, hash, reason: 'EXISTS_IN_RAW' };
    }

    const existingJob = await prisma.job.findUnique({
      where: { hash },
      select: { id: true },
    });

    if (existingJob) {
      return { isDuplicate: true, hash, reason: 'EXISTS_IN_JOBS' };
    }

    return { isDuplicate: false, hash };
  } catch (error) {
    logger.error('Error during deduplication check for hash %s: %s', hash, (error as Error).message);
    // In case of transient DB error, return false so we don't drop jobs prematurely
    return { isDuplicate: false, hash };
  }
}

/**
 * Filters a list of scraped jobs, returning only unique new jobs with their computed hashes.
 */
export async function filterUniqueJobs(
  scrapedJobs: RawScrapedJob[]
): Promise<Array<RawScrapedJob & { hash: string }>> {
  const uniqueJobs: Array<RawScrapedJob & { hash: string }> = [];
  const seenHashesInBatch = new Set<string>();

  for (const job of scrapedJobs) {
    const hash = generateJobHash(job.company, job.title, job.location);

    if (seenHashesInBatch.has(hash)) {
      logger.debug('Skipping in-batch duplicate: %s at %s', job.title, job.company);
      continue;
    }
    seenHashesInBatch.add(hash);

    const dedup = await checkDuplicate(hash);
    if (dedup.isDuplicate) {
      logger.debug('Skipping existing duplicate (%s): %s at %s (%s)', dedup.reason, job.title, job.company, hash);
      continue;
    }

    uniqueJobs.push({
      ...job,
      hash,
    });
  }

  logger.info(
    'Deduplication complete: %d received -> %d new unique jobs (%d duplicates skipped)',
    scrapedJobs.length,
    uniqueJobs.length,
    scrapedJobs.length - uniqueJobs.length
  );

  return uniqueJobs;
}
