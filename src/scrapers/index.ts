import { BaseScraper } from './base.scraper.js';
import { LinkedInScraper } from './linkedin/linkedin.scraper.js';
import { InternshalaScraper } from './internshala/internshala.scraper.js';
import { WellfoundScraper } from './wellfound/wellfound.scraper.js';
import { CareersScraper } from './careers/careers.scraper.js';
import { NaukriScraper } from './naukri/naukri.scraper.js';
import { GovtJobsScraper } from './govt/govt.scraper.js';
import { UnstopScraper } from './unstop/unstop.scraper.js';
import { NicheInternshipScraper } from './internships/niche.scraper.js';
import { CuratedStartupJobsScraper } from './startups/curated.scraper.js';
import { PublicFeedsScraper } from './remote/feed.scraper.js';
import { RawScrapedJob } from '../types/job.js';
import { logger } from '../config/logger.js';

export class ScraperManager {
  private scrapers: BaseScraper[];

  constructor() {
    this.scrapers = [
      new CareersScraper(),
      new PublicFeedsScraper(),
      new InternshalaScraper(),
      new LinkedInScraper(),
      new NaukriScraper(),
      new GovtJobsScraper(),
      new UnstopScraper(),
      new NicheInternshipScraper(),
      new CuratedStartupJobsScraper(),
      new WellfoundScraper(),
    ];
  }

  /**
   * Returns registered scraper instances.
   */
  public getScrapers(): BaseScraper[] {
    return this.scrapers;
  }

  /**
   * Runs all scrapers and collects all scraped job listings.
   */
  public async runAll(): Promise<RawScrapedJob[]> {
    logger.info('🚀 Starting batch scraping across %d sources...', this.scrapers.length);
    const allJobs: RawScrapedJob[] = [];

    // Run scrapers with error isolation
    for (const scraper of this.scrapers) {
      try {
        const jobs = await scraper.execute();
        allJobs.push(...jobs);
      } catch (err) {
        logger.error('Error executing scraper %s: %s', scraper.name, (err as Error).message);
      }
    }

    logger.info('🏁 Batch scraping completed. Collected total %d jobs across all sources.', allJobs.length);
    return allJobs;
  }

  /**
   * Runs a single scraper by source name (e.g. 'linkedin', 'internshala', 'wellfound', 'careers').
   */
  public async runSource(source: string): Promise<RawScrapedJob[]> {
    const target = this.scrapers.find((s) => s.source.toLowerCase() === source.toLowerCase());
    if (!target) {
      throw new Error(`Scraper not found for source: ${source}`);
    }
    return target.execute();
  }
}

export const scraperManager = new ScraperManager();
