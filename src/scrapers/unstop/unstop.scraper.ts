import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

export class UnstopScraper extends BaseScraper {
  public readonly name = 'Unstop Early Career Scraper';
  public readonly source = 'unstop';

  private targetUrls = [
    'https://unstop.com/jobs/freshers',
    'https://unstop.com/jobs/software-engineer',
    'https://unstop.com/internships',
  ];

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    for (const url of this.targetUrls) {
      try {
        const fetched = await this.scrapeUnstopPage(url);
        jobs.push(...fetched);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (err) {
        logger.warn('[Unstop] Failed scraping %s: %s', url, (err as Error).message);
      }
    }

    if (jobs.length === 0) {
      return this.scrapeWithBrowser();
    }

    return jobs;
  }

  private async scrapeUnstopPage(url: string): Promise<RawScrapedJob[]> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const response = await axios.get(url, { headers, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const jobs: RawScrapedJob[] = [];

    $('.opportunity-card, .job-card, [data-v-card], .single-job-card').each((_, el) => {
      const title = $(el).find('h3, .title, .job-title').text().trim();
      const company = $(el).find('.organisation-name, .company-name, .sub-title').text().trim();
      const location = $(el).find('.location, .locations').text().trim() || 'India / Remote';
      const link = $(el).find('a').attr('href') || '';
      const salary = $(el).find('.salary, .stipend, .ctc').text().trim();

      if (title && company && link) {
        const fullUrl = link.startsWith('http') ? link : `https://unstop.com${link.startsWith('/') ? '' : '/'}${link}`;
        const isRemote = location.toLowerCase().includes('remote') || location.toLowerCase().includes('online');

        jobs.push({
          source: this.source,
          title,
          company,
          location: isRemote ? 'Remote / Online' : location,
          description: `Early Career Opening at ${company}: ${title}. Location: ${location}. Salary/CTC: ${
            salary || 'Competitive'
          }. Apply directly on Unstop.`,
          url: fullUrl,
          salary: salary || undefined,
          isRemote,
          experience: 'Students / Freshers (0-1 Yr)',
          metadata: { platform: 'unstop', ctc: salary },
        });
      }
    });

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
