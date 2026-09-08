import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

export class UnstopScraper extends BaseScraper {
  public readonly name = 'Unstop Early Career Scraper';
  public readonly source = 'unstop';

  private apiEndpoints = [
    { url: 'https://unstop.com/api/public/opportunity/search-result?opportunity=jobs&per_page=25', isInternship: false },
    { url: 'https://unstop.com/api/public/opportunity/search-result?opportunity=internships&per_page=25', isInternship: true },
  ];

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    // 1. Try public JSON API
    for (const endpoint of this.apiEndpoints) {
      try {
        const fetched = await this.fetchUnstopApi(endpoint.url, endpoint.isInternship);
        jobs.push(...fetched);
      } catch (err) {
        logger.debug('[Unstop] API fetch error %s: %s', endpoint.url, (err as Error).message);
      }
    }

    if (jobs.length > 0) {
      logger.info('[Unstop] Collected %d opportunities via public API', jobs.length);
      return jobs;
    }

    // 2. Fallback to Browser scraping
    return this.scrapeWithBrowser();
  }

  private async fetchUnstopApi(url: string, isInternship: boolean): Promise<RawScrapedJob[]> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    };

    const response = await axios.get(url, { headers, timeout: 12000 });
    const data = response.data?.data?.data || response.data?.data || [];
    const jobs: RawScrapedJob[] = [];

    if (Array.isArray(data)) {
      for (const item of data) {
        const title = item.title || item.name || '';
        const company = item.organisation?.name || item.organisation_name || 'Hiring Partner';
        const slug = item.public_url || item.seo_url || `https://unstop.com/o/${item.id}`;
        const fullUrl = slug.startsWith('http') ? slug : `https://unstop.com/${slug.startsWith('/') ? slug.slice(1) : slug}`;
        const region = item.region || item.job_location || 'India / Remote';
        const isRemote = String(region).toLowerCase().includes('remote') || String(region).toLowerCase().includes('online');

        if (title && fullUrl) {
          jobs.push({
            source: this.source,
            title: isInternship && !title.toLowerCase().includes('intern') ? `${title} (Internship)` : title,
            company,
            location: isRemote ? 'Work From Home (Remote)' : String(region),
            description: `${isInternship ? 'Internship' : 'Job'} at ${company}: ${title}. Location: ${region}. Apply on Unstop.`,
            url: fullUrl,
            isRemote,
            experience: isInternship ? 'Students / Freshers' : 'Freshers / 0-1 Yr',
            metadata: { unstopId: item.id, isInternship },
          });
        }
      }
    }

    return jobs;
  }

  private async scrapeWithBrowser(): Promise<RawScrapedJob[]> {
    const { context, page } = await this.createBrowserContext();
    const jobs: RawScrapedJob[] = [];

    try {
      await page.goto('https://unstop.com/jobs/freshers', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const cards = await page.$$('a[href*="/jobs/"], a[href*="/competitions/"]');
      for (const card of cards.slice(0, 15)) {
        try {
          const title = await card.$eval('h3, .title', (el) => el.textContent?.trim() || '').catch(() => '');
          const company = await card.$eval('.organisation-name, p', (el) => el.textContent?.trim() || '').catch(() => '');
          const link = await card.evaluate((el) => (el as HTMLAnchorElement).href || '');

          if (title && company && link) {
            jobs.push({
              source: this.source,
              title,
              company,
              location: 'India / Remote',
              description: `Unstop Opportunity: ${title} by ${company}. Apply directly.`,
              url: link,
              isRemote: true,
              experience: 'Freshers / 0-1 Yr',
            });
          }
        } catch {
          // ignore
        }
      }
    } catch (error) {
      logger.warn('[Unstop] Browser scrape failed: %s', (error as Error).message);
    } finally {
      await context.close().catch(() => {});
    }

    return jobs;
  }
}
