import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

export class GovtJobsScraper extends BaseScraper {
  public readonly name = 'Government & PSU Jobs Scraper';
  public readonly source = 'govt';

  private notificationFeeds = [
    'https://www.freejobalert.com/government-jobs/',
    'https://www.freejobalert.com/engineering-jobs/',
    'https://www.freejobalert.com/bank-jobs/',
  ];

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    for (const url of this.notificationFeeds) {
      try {
        const fetched = await this.scrapeFeed(url);
        jobs.push(...fetched);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (err) {
        logger.warn('[GovtScraper] Error scraping feed %s: %s', url, (err as Error).message);
      }
    }

    if (jobs.length === 0) {
      return this.scrapeWithBrowser();
    }

    return jobs;
  }

  private async scrapeFeed(url: string): Promise<RawScrapedJob[]> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const response = await axios.get(url, { headers, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const jobs: RawScrapedJob[] = [];

    $('table.latjnstab tr, table tr').each((_, el) => {
      const postDate = $(el).find('td').eq(0).text().trim();
      const recAgency = $(el).find('td').eq(1).text().trim();
      const postName = $(el).find('td').eq(2).text().trim();
      const qualification = $(el).find('td').eq(3).text().trim();
      const lastDate = $(el).find('td').eq(4).text().trim();
      const link = $(el).find('td a').last().attr('href') || $(el).find('a').attr('href') || '';

      // Only target entries that have valid post name and link
      if (recAgency && postName && link && link.startsWith('http')) {
        const isGraduateEligible =
          qualification.toLowerCase().includes('degree') ||
          qualification.toLowerCase().includes('graduate') ||
          qualification.toLowerCase().includes('b.e') ||
          qualification.toLowerCase().includes('b.tech') ||
          qualification.toLowerCase().includes('any degree') ||
          qualification.toLowerCase().includes('diploma') ||
          qualification.toLowerCase().includes('10th') ||
          qualification.toLowerCase().includes('12th');

        if (isGraduateEligible || qualification === '') {
          jobs.push({
            source: this.source,
            title: `${postName} Recruitment (${recAgency})`,
            company: recAgency,
            location: 'All India',
            description: `Official Notification: ${recAgency} invites applications for ${postName}. Qualification: ${
              qualification || 'Any Graduate / Degree'
            }. Last Date: ${lastDate || 'Check Notification'}. Posted: ${postDate}.`,
            url: link,
            isRemote: false,
            experience: 'Freshers / Graduates',
            metadata: { postDate, lastDate, qualification, agency: recAgency },
          });
        }
      }
    });

    return jobs;
  }

  private async scrapeWithBrowser(): Promise<RawScrapedJob[]> {
    const { context, page } = await this.createBrowserContext();
    const jobs: RawScrapedJob[] = [];

    try {
      await page.goto('https://www.freejobalert.com/government-jobs/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const rows = await page.$$('table.latjnstab tr');
      for (const row of rows.slice(1, 15)) {
        try {
          const cells = await row.$$('td');
          if (cells.length >= 5) {
            const agency = await cells[1].textContent().then((t) => t?.trim() || '');
            const post = await cells[2].textContent().then((t) => t?.trim() || '');
            const qual = await cells[3].textContent().then((t) => t?.trim() || '');
            const link = await row.$eval('a', (a) => (a as HTMLAnchorElement).href || '').catch(() => '');

            if (agency && post && link) {
              jobs.push({
                source: this.source,
                title: `${post} (${agency})`,
                company: agency,
                location: 'All India',
                description: `Govt Job: ${agency} is hiring for ${post}. Eligibility: ${qual}. Apply on official portal.`,
                url: link,
                isRemote: false,
                experience: 'Freshers / Graduates',
              });
            }
          }
        } catch {
          // ignore row
        }
      }
    } catch (error) {
      logger.warn('[GovtScraper] Browser fallback failed: %s', (error as Error).message);
    } finally {
      await context.close().catch(() => {});
    }

    return jobs;
  }
}
