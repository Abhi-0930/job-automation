import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

export class LinkedInScraper extends BaseScraper {
  public readonly name = 'LinkedIn Scraper';
  public readonly source = 'linkedin';

  private keywords = ['software engineer', 'intern', 'marketing', 'frontend developer', 'data analyst'];
  private locations = ['India', 'Remote', 'Bengaluru', 'Hyderabad'];

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    // Iterate over top keywords
    for (const keyword of this.keywords.slice(0, 3)) {
      for (const loc of this.locations.slice(0, 2)) {
        try {
          const fetched = await this.fetchGuestJobs(keyword, loc);
          jobs.push(...fetched);
          // Rate limit pause between keyword searches
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (err) {
          logger.warn('[LinkedIn] Error fetching query "%s" in "%s": %s', keyword, loc, (err as Error).message);
        }
      }
    }

    // If HTTP API returned results, return them
    if (jobs.length > 0) {
      return jobs;
    }

    // Fallback: Playwright Browser Scrape
    return this.scrapeWithBrowser();
  }

  private async fetchGuestJobs(keywords: string, location: string): Promise<RawScrapedJob[]> {
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`;
    const params = {
      keywords,
      location,
      start: 0,
      f_TPR: 'r86400', // Past 24 hours
    };

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };

    const response = await axios.get(url, { params, headers, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const jobs: RawScrapedJob[] = [];

    $('li').each((_, el) => {
      const title = $(el).find('.base-search-card__title').text().trim();
      const company = $(el).find('.base-search-card__subtitle').text().trim();
      const location = $(el).find('.job-search-card__location').text().trim();
      const jobLink = $(el).find('.base-card__full-link').attr('href') || '';
      const dateText = $(el).find('time').text().trim();

      if (title && company && jobLink) {
        // Strip tracking params from LinkedIn URL
        const cleanUrl = jobLink.split('?')[0];
        const isRemote = location.toLowerCase().includes('remote') || title.toLowerCase().includes('remote');

        jobs.push({
          source: this.source,
          title,
          company,
          location: location || 'India',
          description: `Job at ${company}: ${title} located in ${location || 'India'}. Posted recently (${dateText || 'Recent'}). Apply via LinkedIn.`,
          url: cleanUrl,
          isRemote,
          metadata: { keywords, scrapedLocation: location, postedDate: dateText },
        });
      }
    });

    return jobs;
  }

  private async scrapeWithBrowser(): Promise<RawScrapedJob[]> {
    const { context, page } = await this.createBrowserContext();
    const jobs: RawScrapedJob[] = [];

    try {
      const searchUrl = 'https://www.linkedin.com/jobs/search?keywords=Software%20Engineer&location=India&f_TPR=r86400';
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for job cards to load
      await page.waitForSelector('.jobs-search__results-list li', { timeout: 10000 }).catch(() => {});

      const items = await page.$$('.jobs-search__results-list li');
      for (const item of items.slice(0, 15)) {
        try {
          const title = await item.$eval('.base-search-card__title', (el) => el.textContent?.trim() || '').catch(() => '');
          const company = await item.$eval('.base-search-card__subtitle', (el) => el.textContent?.trim() || '').catch(() => '');
          const location = await item.$eval('.job-search-card__location', (el) => el.textContent?.trim() || '').catch(() => '');
          const link = await item.$eval('.base-card__full-link', (el) => (el as HTMLAnchorElement).href || '').catch(() => '');

          if (title && company && link) {
            jobs.push({
              source: this.source,
              title,
              company,
              location: location || 'India',
              description: `LinkedIn Job: ${title} at ${company}. Location: ${location || 'India'}.`,
              url: link.split('?')[0],
              isRemote: location.toLowerCase().includes('remote') || title.toLowerCase().includes('remote'),
            });
          }
        } catch {
          // ignore single item extract error
        }
      }
    } catch (error) {
      logger.warn('[LinkedIn] Browser fallback failed: %s', (error as Error).message);
    } finally {
      await context.close().catch(() => {});
    }

    return jobs;
  }
}
