import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

export class NaukriScraper extends BaseScraper {
  public readonly name = 'Naukri.com Fresher Scraper';
  public readonly source = 'naukri';

  private targetUrls = [
    { url: 'https://www.naukri.com/fresher-jobs', category: 'ALL' },
    { url: 'https://www.naukri.com/it-jobs?experience=0', category: 'TECH' },
    { url: 'https://www.naukri.com/software-engineer-fresher-jobs', category: 'TECH' },
    { url: 'https://www.naukri.com/marketing-fresher-jobs', category: 'NON_TECH' },
  ];

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    for (const target of this.targetUrls) {
      try {
        const fetched = await this.scrapeNaukriUrl(target.url);
        jobs.push(...fetched);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (err) {
        logger.warn('[Naukri] Failed to scrape %s: %s', target.url, (err as Error).message);
      }
    }

    if (jobs.length === 0) {
      return this.scrapeWithBrowser();
    }

    return jobs;
  }

  private async scrapeNaukriUrl(url: string): Promise<RawScrapedJob[]> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const response = await axios.get(url, { headers, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const jobs: RawScrapedJob[] = [];

    $('.srp-jobtuple-wrapper, .jobTuple, article.jobTuple').each((_, el) => {
      const title = $(el).find('a.title, .title').text().trim();
      const company = $(el).find('a.comp-name, .comp-name, .subTitle').text().trim();
      const exp = $(el).find('.exp-wrap .ni-job-tuple-icon-experience, .exp, .experience').text().trim();
      const salary = $(el).find('.sal-wrap, .salary, .ni-job-tuple-icon-salary').text().trim();
      const location = $(el).find('.loc-wrap, .location, .ni-job-tuple-icon-location').text().trim() || 'India';
      const jobUrl = $(el).find('a.title').attr('href') || '';
      const desc = $(el).find('.job-desc, .jobDescription').text().trim();

      if (title && company && jobUrl) {
        const isRemote = location.toLowerCase().includes('remote') || location.toLowerCase().includes('wfh');

        jobs.push({
          source: this.source,
          title,
          company,
          location: isRemote ? 'Remote / Work From Home' : location,
          description: `${title} at ${company}. Location: ${location}. Experience: ${exp || '0-1 Yrs (Freshers)'}. Salary: ${salary || 'Disclosed on application'}. ${desc}`,
          url: jobUrl.startsWith('http') ? jobUrl : `https://www.naukri.com${jobUrl}`,
          salary: salary || undefined,
          isRemote,
          experience: 'Freshers / 0-1 Yr',
          metadata: { portal: 'naukri', exp, salary },
        });
      }
    });

    return jobs;
  }

  private async scrapeWithBrowser(): Promise<RawScrapedJob[]> {
    const { context, page } = await this.createBrowserContext();
    const jobs: RawScrapedJob[] = [];

    try {
      await page.goto('https://www.naukri.com/fresher-jobs', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const items = await page.$$('.srp-jobtuple-wrapper, .jobTuple');
      for (const item of items.slice(0, 15)) {
        try {
          const title = await item.$eval('a.title, .title', (el) => el.textContent?.trim() || '').catch(() => '');
          const company = await item.$eval('a.comp-name, .subTitle', (el) => el.textContent?.trim() || '').catch(() => '');
          const location = await item.$eval('.loc-wrap, .location', (el) => el.textContent?.trim() || '').catch(() => 'India');
          const link = await item.$eval('a.title', (el) => (el as HTMLAnchorElement).href || '').catch(() => '');
          const salary = await item.$eval('.sal-wrap, .salary', (el) => el.textContent?.trim() || '').catch(() => '');

          if (title && company && link) {
            jobs.push({
              source: this.source,
              title,
              company,
              location,
              description: `Fresher Job: ${title} at ${company}. Location: ${location}. Salary: ${salary}. Apply on Naukri.`,
              url: link,
              isRemote: location.toLowerCase().includes('remote'),
              experience: 'Freshers / 0-1 Yr',
              salary: salary || undefined,
            });
          }
        } catch {
          // ignore card error
        }
      }
    } catch (error) {
      logger.warn('[Naukri] Browser fallback failed: %s', (error as Error).message);
    } finally {
      await context.close().catch(() => {});
    }

    return jobs;
  }
}
