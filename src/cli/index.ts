import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { connectDatabase, disconnectDatabase } from '../database/prisma.js';
import { jobCollector } from '../jobs/collector.js';
import { scraperManager } from '../scrapers/index.js';
import { whatsAppPublisher } from '../publisher/whatsapp.js';
import { publishingQueue } from '../publisher/queue.js';
import { schedulerService } from '../scheduler/cron.js';
import { JobCategory, RawScrapedJob } from '../types/job.js';
import { formatWhatsAppJobMessage, formatDailyDigestMessage } from '../ai/formatter.js';
import { extractExperience } from '../ai/classify.js';
import { env } from '../config/env.js';
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
  .option('-s, --source <source>', 'Specific source to scrape (for example: linkedin, internshala, niche-internships, govt)')
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

// Helper: Compile and send Daily Digest without database dependency
async function compileAndSendLiveDigest(targetGroupOverride?: string): Promise<void> {
  const targetGroup = targetGroupOverride || env.WHATSAPP_GROUP_COMMUNITY || 'Daily Highlights';
  logger.info('📰 [Daily Digest] Compiling live Digest across Tech, Internships, and Non-Tech for "%s"...', targetGroup);

  let techRaw: RawScrapedJob[] = [];
  let internRaw: RawScrapedJob[] = [];
  let nonTechRaw: RawScrapedJob[] = [];

  try {
    techRaw = await scraperManager.runSource('public-feeds');
  } catch (e) {
    logger.warn('Tech feeds error in digest: %s', (e as Error).message);
  }

  try {
    internRaw = await scraperManager.runSource('internshala');
  } catch (e) {
    logger.warn('Internships error in digest: %s', (e as Error).message);
  }

  try {
    nonTechRaw = await scraperManager.runSource('startup-boards');
  } catch (e) {
    logger.warn('Non-Tech error in digest: %s', (e as Error).message);
  }

  // Filter fresh & verified Tech picks
  const techPicks = techRaw
    .filter((j) => {
      const text = `${j.title} ${j.description}`;
      const exp = extractExperience(text, 'TECH');
      return exp.isFresherEligible && /\b(software|developer|frontend|backend|fullstack|engineer|data|devops|cloud|react|node|python|java|web)\b/i.test(j.title);
    })
    .slice(0, 3)
    .map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      score: 92,
    }));

  // Filter fresh Internships
  const internPicks = internRaw
    .filter((j) => {
      const text = `${j.title} ${j.description}`.toLowerCase();
      return /\b(intern|internship|trainee|apprentice|fellow)\b/i.test(text);
    })
    .slice(0, 2)
    .map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      score: 90,
    }));

  // Filter Non-Tech / Business picks
  const nonTechPicks = nonTechRaw
    .filter((j) => {
      const text = `${j.title} ${j.description}`;
      const exp = extractExperience(text, 'NON_TECH');
      return exp.isFresherEligible && !/\b(software engineer|developer|frontend|backend|devops|sre)\b/i.test(j.title);
    })
    .slice(0, 2)
    .map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      score: 88,
    }));

  const totalCount = techPicks.length + internPicks.length + nonTechPicks.length;
  if (totalCount === 0) {
    logger.warn('No jobs available to compile Daily Digest.');
    return;
  }

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const digestText = formatDailyDigestMessage({
    date: todayStr,
    techJobs: techPicks,
    internships: internPicks,
    nonTechJobs: nonTechPicks,
    totalCount,
  });

  logger.info('Prepared Daily Digest with %d opportunities. Sending to WhatsApp group "%s"...', totalCount, targetGroup);
  const result = await whatsAppPublisher.sendMessage(targetGroup, digestText);

  if (result.success) {
    logger.info('🎉 Successfully published Daily Digest to "%s"!', targetGroup);
  } else {
    logger.error('⚠️ Failed to publish Daily Digest: %s', result.error);
    process.exit(1);
  }
}

// Command: Publish Category Batch or Daily Digest
program
  .command('publish')
  .description('Publish top scored jobs for a category or daily digest to WhatsApp group')
  .option('-c, --category <category>', 'Category to publish: TECH, INTERNSHIP, NON_TECH, GOVT, COHORT, REFERRAL')
  .option('-l, --limit <limit>', 'Maximum jobs to publish', '5')
  .option('-d, --digest', 'Generate and publish 8:00 PM daily digest of top picks')
  .action(async (options) => {
    if (options.digest) {
      if (!process.env.DATABASE_URL) {
        logger.info('ℹ️ No DATABASE_URL found. Compiling Daily Digest live from active feeds...');
        await compileAndSendLiveDigest();
        return;
      }

      const connected = await connectDatabase();
      if (!connected) {
        logger.info('ℹ️ Database connection skipped. Falling back to live Daily Digest compilation...');
        await compileAndSendLiveDigest();
        return;
      }

      try {
        await publishingQueue.publishDailyDigest();
      } finally {
        await disconnectDatabase();
      }
      return;
    }

    const connected = await connectDatabase();
    if (!connected) process.exit(1);

    try {
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
    if (!process.env.DATABASE_URL) {
      logger.info('ℹ️ No DATABASE_URL found. Compiling Daily Digest live from active feeds...');
      await compileAndSendLiveDigest();
      return;
    }

    const connected = await connectDatabase();
    if (!connected) {
      logger.info('ℹ️ Database connection skipped. Falling back to live Daily Digest compilation...');
      await compileAndSendLiveDigest();
      return;
    }

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

// Command: Scrape and Send Live to WhatsApp (Works standalone, no DB required)
program
  .command('live')
  .description('Scrape live jobs and immediately publish matches to WhatsApp')
  .option('-c, --category <category>', 'Category: TECH, INTERNSHIP, NON_TECH, GOVT, COHORT, REFERRAL, COMMUNITY', 'GOVT')
  .option('-l, --limit <limit>', 'Maximum jobs to publish (or "all")', '1')
  .option('-g, --group <group>', 'Override target WhatsApp group name')
  .action(async (options) => {
    try {
      const category = (options.category || 'GOVT').toUpperCase() as JobCategory;
      let targetGroup = options.group;
      let rawJobs: RawScrapedJob[] = [];

      switch (category) {
        case 'TECH':
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_TECH;
          logger.info('🚀 [Live Dispatch] Scraping live Tech listings across all platforms (Feeds, Startups, Wellfound, LinkedIn, Naukri)...');
          try {
            const feedJobs = await scraperManager.runSource('public-feeds');
            rawJobs.push(...feedJobs);
          } catch (e) {
            logger.warn('Public feeds error: %s', (e as Error).message);
          }
          try {
            const startupJobs = await scraperManager.runSource('startup-boards');
            rawJobs.push(...startupJobs);
          } catch (e) {
            logger.warn('Startups scraper error: %s', (e as Error).message);
          }
          try {
            const wellfoundJobs = await scraperManager.runSource('wellfound');
            rawJobs.push(...wellfoundJobs);
          } catch (e) {
            logger.warn('Wellfound scraper error: %s', (e as Error).message);
          }
          try {
            const liJobs = await scraperManager.runSource('linkedin');
            rawJobs.push(...liJobs);
          } catch (e) {
            logger.warn('LinkedIn scraper error: %s', (e as Error).message);
          }
          try {
            const naukriJobs = await scraperManager.runSource('naukri');
            rawJobs.push(...naukriJobs);
          } catch (e) {
            logger.warn('Naukri scraper error: %s', (e as Error).message);
          }
          break;

        case 'INTERNSHIP':
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_INTERNSHIP;
          logger.info('🚀 [Live Dispatch] Scraping live Internships (Internshala + Niche Internships)...');
          try {
            const internshalaJobs = await scraperManager.runSource('internshala');
            rawJobs.push(...internshalaJobs);
          } catch (e) {
            logger.warn('Internshala error: %s', (e as Error).message);
          }
          try {
            const nicheJobs = await scraperManager.runSource('niche-internships');
            rawJobs.push(...nicheJobs);
          } catch (e) {
            logger.warn('Niche internships error: %s', (e as Error).message);
          }
          break;

        case 'NON_TECH':
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_NON_TECH;
          logger.info('🚀 [Live Dispatch] Scraping live Non-Tech listings across platforms (Feeds, Startups, LinkedIn, Naukri)...');
          try {
            const remoteJobs = await scraperManager.runSource('public-feeds');
            rawJobs.push(...remoteJobs);
          } catch (e) {
            logger.warn('Remote scraper error: %s', (e as Error).message);
          }
          try {
            const startupJobs = await scraperManager.runSource('startup-boards');
            rawJobs.push(...startupJobs);
          } catch (e) {
            logger.warn('Startups scraper error: %s', (e as Error).message);
          }
          try {
            const liJobs = await scraperManager.runSource('linkedin');
            rawJobs.push(...liJobs);
          } catch (e) {
            logger.warn('LinkedIn scraper error: %s', (e as Error).message);
          }
          try {
            const naukriJobs = await scraperManager.runSource('naukri');
            rawJobs.push(...naukriJobs);
          } catch (e) {
            logger.warn('Naukri scraper error: %s', (e as Error).message);
          }
          break;

        case 'GOVT':
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_GOVT;
          logger.info('🚀 [Live Dispatch] Scraping live Government & PSU listings...');
          rawJobs = await scraperManager.runSource('govt');
          break;

        case 'COHORT':
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_COHORT;
          logger.info('🚀 [Live Dispatch] Scraping live Cohorts & Hackathons (Unstop)...');
          try {
            rawJobs = await scraperManager.runSource('unstop');
          } catch (e) {
            logger.warn('Unstop error: %s', (e as Error).message);
          }
          break;

        case 'REFERRAL':
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_REFERRAL;
          logger.info('🚀 [Live Dispatch] Scraping live Referral / Startup opportunities...');
          try {
            const startupJobs = await scraperManager.runSource('curated-startups');
            rawJobs.push(...startupJobs);
          } catch (e) {
            logger.warn('Startups scraper error: %s', (e as Error).message);
          }
          try {
            const liJobs = await scraperManager.runSource('linkedin');
            rawJobs.push(...liJobs);
          } catch (e) {
            logger.warn('LinkedIn scraper error: %s', (e as Error).message);
          }
          break;

        case 'DIGEST':
        case 'COMMUNITY':
          await compileAndSendLiveDigest(targetGroup);
          return;

        default:
          // Daily Community Highlights
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_COMMUNITY;
          logger.info('🚀 [Live Dispatch] Scraping highlights across categories...');
          try {
            const fJobs = await scraperManager.runSource('public-feeds');
            rawJobs.push(...fJobs.slice(0, 10));
          } catch { }
          try {
            const sJobs = await scraperManager.runSource('startup-boards');
            rawJobs.push(...sJobs.slice(0, 10));
          } catch { }
          try {
            const iJobs = await scraperManager.runSource('internshala');
            rawJobs.push(...iJobs.slice(0, 10));
          } catch { }
          try {
            const gJobs = await scraperManager.runSource('govt');
            rawJobs.push(...gJobs.slice(0, 10));
          } catch { }
          break;
      }

      if (!rawJobs || rawJobs.length === 0) {
        logger.warn('No jobs returned for category: %s', category);
        return;
      }

      // Category-tailored filtering:
      let validJobs: RawScrapedJob[] = [];

      if (category === 'GOVT') {
        validJobs = rawJobs.filter((j) => {
          const t = j.title.toLowerCase();
          return (
            !t.includes('result') &&
            !t.includes('admit card') &&
            !t.includes('answer key') &&
            !t.includes('marks') &&
            !t.includes('cut off')
          );
        });
      } else if (category === 'INTERNSHIP') {
        validJobs = rawJobs.filter((j) => {
          const text = `${j.title} ${j.description}`.toLowerCase();
          return /\b(intern|internship|trainee|apprentice|fellow)\b/i.test(text);
        });
      } else if (category === 'TECH') {
        validJobs = rawJobs.filter((j) => {
          const text = `${j.title} ${j.description}`;
          const exp = extractExperience(text, 'TECH');
          if (!exp.isFresherEligible) return false;
          return /\b(software|developer|frontend|backend|fullstack|engineer|data|devops|cloud|react|node|python|java|web|intern|qa|test)\b/i.test(j.title);
        });
      } else if (category === 'NON_TECH') {
        validJobs = rawJobs.filter((j) => {
          const text = `${j.title} ${j.description}`;
          const exp = extractExperience(text, 'NON_TECH');
          if (!exp.isFresherEligible) return false;
          if (/\b(software engineer|developer|frontend|backend|fullstack|devops|cloud architect|sre|qa engineer|data engineer)\b/i.test(j.title)) {
            return false;
          }
          return /\b(marketing|sales|operations|hr|human resources|people|recruiter|talent|business|finance|accountant|content|copywriter|writer|designer|ui\/ux|support|customer|success|analyst|associate|coordinator|specialist|representative|executive|administrative|admin)\b/i.test(j.title);
        });
      } else {
        // COHORT, REFERRAL, COMMUNITY
        validJobs = rawJobs;
      }

      // In-batch deduplication by title + company
      const seen = new Set<string>();
      validJobs = validJobs.filter((j) => {
        const key = `${j.title}|${j.company}`.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Persistent cross-run deduplication: prevent re-sending jobs already dispatched
      const historyFile = path.resolve(process.cwd(), 'data', 'live_published_history.json');
      let publishedHistory: string[] = [];
      try {
        if (fs.existsSync(historyFile)) {
          publishedHistory = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
        }
      } catch { }

      const unpostedJobs = validJobs.filter((j) => {
        const key = `${j.title}|${j.company}`.toLowerCase().replace(/[^a-z0-9]/g, '');
        return !publishedHistory.includes(key) && !publishedHistory.includes(j.url);
      });

      const candidatePool = unpostedJobs.length > 0 ? unpostedJobs : validJobs;
      const isAll = options.limit === 'all' || options.all;
      const limit = isAll ? candidatePool.length : parseInt(options.limit, 10) || candidatePool.length;
      const targetJobs = candidatePool.slice(0, limit);

      logger.info(
        'Fetched %d live listings (%d eligible openings, %d unposted). Preparing %d alert(s) for WhatsApp group "%s"...',
        rawJobs.length,
        validJobs.length,
        unpostedJobs.length,
        targetJobs.length,
        targetGroup
      );

      // For Government jobs, enrich candidate jobs with their article details (exact age limit, qualification, last date)
      if (category === 'GOVT') {
        const { enrichGovtJob } = await import('../scrapers/govt/govt.scraper.js');
        logger.info('🔍 Enriching %d target Government job(s) with live notice details...', targetJobs.length);
        for (let i = 0; i < targetJobs.length; i++) {
          targetJobs[i] = await enrichGovtJob(targetJobs[i]);
        }
      }

      const messages: string[] = targetJobs.map((job) => {
        const meta = (job.metadata || {}) as Record<string, string>;
        const exp = extractExperience(`${job.title} ${job.description}`, category);

        return formatWhatsAppJobMessage({
          title: job.title,
          company: job.company,
          location: job.location,
          category,
          score: category === 'GOVT' ? undefined : 88,
          qualification: meta.qualification || (category === 'GOVT' ? 'Any Degree / B.Tech / Diploma' : undefined),
          ageLimit: meta.ageLimit || (category === 'GOVT' ? 'As per Govt rules' : undefined),
          lastDate: meta.lastDate || (category === 'GOVT' ? 'See Notification' : undefined),
          batchLine: exp.batchLine,
          experience: job.experience || exp.label,
          url: job.url,
          description: job.description,
          metadata: job.metadata,
        });
      });

      // Dispatch all messages in a single continuous session
      const result = await whatsAppPublisher.sendBatchMessages(targetGroup, messages);

      if (result.success && result.sent > 0) {
        try {
          const sentKeys = targetJobs.slice(0, result.sent).flatMap((j) => [
            `${j.title}|${j.company}`.toLowerCase().replace(/[^a-z0-9]/g, ''),
            j.url,
          ]);
          const updatedHistory = Array.from(new Set([...publishedHistory, ...sentKeys])).slice(-2000);
          fs.writeFileSync(historyFile, JSON.stringify(updatedHistory, null, 2), 'utf-8');
        } catch { }
        logger.info('🎉 Done! Successfully published %d/%d alert(s) to WhatsApp group "%s".', result.sent, messages.length, targetGroup);
      } else {
        logger.error('⚠️ Finished with error: %s (Sent %d/%d)', result.error || 'No messages confirmed', result.sent, messages.length);
        process.exit(1);
      }
    } catch (error) {
      logger.error('Live dispatch error: %s', (error as Error).message);
      process.exit(1);
    }
  });

program.parse(process.argv);

