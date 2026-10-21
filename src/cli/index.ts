import { Command } from 'commander';
import { connectDatabase, disconnectDatabase } from '../database/prisma.js';
import { jobCollector } from '../jobs/collector.js';
import { scraperManager } from '../scrapers/index.js';
import { whatsAppPublisher } from '../publisher/whatsapp.js';
import { publishingQueue } from '../publisher/queue.js';
import { schedulerService } from '../scheduler/cron.js';
import { JobCategory, RawScrapedJob } from '../types/job.js';
import { formatWhatsAppJobMessage } from '../ai/formatter.js';
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
          logger.info('🚀 [Live Dispatch] Scraping live Tech listings (Company Careers + Remote)...');
          try {
            const careerJobs = await scraperManager.runSource('careers');
            rawJobs.push(...careerJobs);
          } catch (e) {
            logger.warn('Careers scraper error: %s', (e as Error).message);
          }
          try {
            const remoteJobs = await scraperManager.runSource('remote');
            rawJobs.push(...remoteJobs);
          } catch (e) {
            logger.warn('Remote scraper error: %s', (e as Error).message);
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
          logger.info('🚀 [Live Dispatch] Scraping live Non-Tech listings (Remote + Startups)...');
          try {
            const remoteJobs = await scraperManager.runSource('remote');
            rawJobs.push(...remoteJobs);
          } catch (e) {
            logger.warn('Remote scraper error: %s', (e as Error).message);
          }
          try {
            const startupJobs = await scraperManager.runSource('curated-startups');
            rawJobs.push(...startupJobs);
          } catch (e) {
            logger.warn('Startups scraper error: %s', (e as Error).message);
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

        default:
          // Daily Community Highlights
          if (!targetGroup) targetGroup = env.WHATSAPP_GROUP_COMMUNITY;
          logger.info('🚀 [Live Dispatch] Scraping highlights across categories...');
          try {
            const cJobs = await scraperManager.runSource('careers');
            rawJobs.push(...cJobs.slice(0, 10));
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
          return /\b(marketing|sales|operations|hr|human resources|business|finance|content|designer|support|analyst|associate)\b/i.test(j.title);
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

      const isAll = options.limit === 'all' || options.all;
      const limit = isAll ? validJobs.length : parseInt(options.limit, 10) || validJobs.length;
      const targetJobs = validJobs.slice(0, limit);

      logger.info(
        'Fetched %d live listings (%d eligible openings). Preparing %d alert(s) for WhatsApp group "%s"...',
        rawJobs.length,
        validJobs.length,
        targetJobs.length,
        targetGroup
      );

      const messages: string[] = targetJobs.map((job) => {
        const meta = (job.metadata || {}) as Record<string, string>;
        const exp = extractExperience(`${job.title} ${job.description}`, category);

        return formatWhatsAppJobMessage({
          title: job.title,
          company: job.company,
          location: job.location,
          category,
          score: 88,
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

      if (result.success) {
        logger.info('🎉 Done! Successfully published %d/%d alert(s) to WhatsApp group "%s".', result.sent, messages.length, targetGroup);
      } else {
        logger.error('⚠️ Finished with error: %s (Sent %d/%d)', result.error, result.sent, messages.length);
      }
    } catch (error) {
      logger.error('Live dispatch error: %s', (error as Error).message);
    }
  });

program.parse(process.argv);

