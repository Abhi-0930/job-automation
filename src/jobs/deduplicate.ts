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
 * Batch checks whether multiple job hashes already exist in jobs_raw or jobs table in a single DB query.
 */
export async function filterUniqueJobs(
  scrapedJobs: RawScrapedJob[]
): Promise<Array<RawScrapedJob & { hash: string }>> {
  if (scrapedJobs.length === 0) return [];

  // 1. Calculate hashes and deduplicate in-memory first
  const jobsWithHash: Array<RawScrapedJob & { hash: string }> = [];
  const seenHashesInBatch = new Set<string>();

  for (const job of scrapedJobs) {
    const hash = generateJobHash(job.company, job.title, job.location);
    if (!seenHashesInBatch.has(hash)) {
      seenHashesInBatch.add(hash);
      jobsWithHash.push({ ...job, hash });
    }
  }

  const allHashes = Array.from(seenHashesInBatch);

  try {
    // 2. Perform single batch DB queries
    const [existingRaw, existingJobs] = await Promise.all([
      prisma.rawJob.findMany({
        where: { hash: { in: allHashes } },
        select: { hash: true },
      }),
      prisma.job.findMany({
        where: { hash: { in: allHashes } },
        select: { hash: true },
      }),
    ]);

    const existingHashSet = new Set<string>([
      ...existingRaw.map((r) => r.hash),
      ...existingJobs.map((j) => j.hash),
    ]);

    const uniqueJobs = jobsWithHash.filter((j) => !existingHashSet.has(j.hash));

    logger.info(
      'Deduplication complete: %d received -> %d unique jobs (%d duplicates filtered out)',
      scrapedJobs.length,
      uniqueJobs.length,
      scrapedJobs.length - uniqueJobs.length
    );

    return uniqueJobs;
  } catch (error) {
    logger.error('Error during batch deduplication: %s', (error as Error).message);
    return jobsWithHash;
  }
}
