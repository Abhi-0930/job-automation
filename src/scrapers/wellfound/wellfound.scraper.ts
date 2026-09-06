import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

export class WellfoundScraper extends BaseScraper {
  public readonly name = 'Wellfound Scraper';
  public readonly source = 'wellfound';

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    // Wellfound public discovery feeds & startup job aggregations
    const targets = [
      'https://wellfound.com/role/l/software-engineer/india',
      'https://wellfound.com/role/l/frontend-developer/remote',
      'https://wellfound.com/role/l/product-manager/india',
    ];

    for (const url of targets) {
      try {
        const fetched = await this.scrapePage(url);
        jobs.push(...fetched);
      } catch (err) {
        logger.warn('[Wellfound] Error fetching %s: %s', url, (err as Error).message);
      }
    }

    if (jobs.length === 0) {
      return this.scrapeWithBrowser();
    }

    return jobs;
  }

  private async scrapePage(url: string): Promise<RawScrapedJob[]> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const response = await axios.get(url, { headers, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const jobs: RawScrapedJob[] = [];

    $('[data-test="StartupResult"], .styles_component__2kL29, .styles_jobListing__3j9_A').each((_, el) => {
      const company = $(el).find('h2, .styles_startupName__Nal_v, .styles_name__2WJbv').text().trim();
      const title = $(el).find('h3, .styles_title__3tZ6y, .styles_jobTitle__2YxMv').text().trim();
      const location = $(el).find('.styles_location__1xH_x, .styles_tags__2Qj7i').text().trim() || 'Remote';
      const link = $(el).find('a[href*="/jobs/"], a[href*="/company/"]').attr('href') || '';
      const salary = $(el).find('.styles_compensation__2wU8j').text().trim();

      if (title && company && link) {
        const fullUrl = link.startsWith('http') ? link : `https://wellfound.com${link}`;
        const isRemote = location.toLowerCase().includes('remote') || title.toLowerCase().includes('remote');

        jobs.push({
          source: this.source,
          title,
          company,
          location: location || (isRemote ? 'Remote' : 'India'),
          description: `Startup job at ${company}: ${title}. Location: ${location}. Compensation: ${salary || 'Equity + Competitive Salary'}. Apply via Wellfound.`,
          url: fullUrl,
          salary,
          isRemote,
          metadata: { wellfoundUrl: fullUrl },
        });
      }
    });

    return jobs;
  }

  private async scrapeWithBrowser(): Promise<RawScrapedJob[]> {
    const { context, page } = await this.createBrowserContext();
    const jobs: RawScrapedJob[] = [];

    try {
      await page.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const items = await page.$$('[data-test="StartupResult"], div[class*="jobListing"]');
      for (const item of items.slice(0, 10)) {
        try {
          const company = await item.$eval('h2, a[href*="/company/"]', (el) => el.textContent?.trim() || '').catch(() => '');
          const title = await item.$eval('h3, a[href*="/jobs/"]', (el) => el.textContent?.trim() || '').catch(() => '');
          const link = await item.$eval('a[href*="/jobs/"]', (el) => (el as HTMLAnchorElement).href || '').catch(() => '');

          if (title && company && link) {
            jobs.push({
              source: this.source,
              title,
              company,
              location: 'Remote / India',
              description: `Startup Job: ${title} at ${company}. Apply on Wellfound.`,
              url: link,
              isRemote: true,
              experience: '1-3 Years',
            });
          }
        } catch {
          // ignore item error
        }
      }
    } catch (error) {
      logger.warn('[Wellfound] Browser fallback failed: %s', (error as Error).message);
    } finally {
      await context.close().catch(() => {});
    }

    return jobs;
  }
}
