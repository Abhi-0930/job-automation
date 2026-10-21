import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

interface BoardSource {
  name: string;
  url: string;
}

const BOARD_SOURCES: BoardSource[] = [
  { name: 'Y Combinator Jobs', url: 'https://www.ycombinator.com/jobs/role/all/india' },
  { name: 'Cutshort', url: 'https://cutshort.io/jobs/startup-jobs' },
  { name: 'Indian Startup Jobs', url: 'https://indianstartups.work/' },
  { name: 'Andhra Startup Map', url: 'https://www.andhrastartupmap.in/jobs' },
];

export class CuratedStartupJobsScraper extends BaseScraper {
  public readonly name = 'Startup Job Boards Scraper';
  public readonly source = 'startup-boards';

  protected async scrape(): Promise<RawScrapedJob[]> {
    const results: RawScrapedJob[] = [];

    for (const board of BOARD_SOURCES) {
      try {
        const response = await axios.get(board.url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          },
          timeout: 20000,
        });
        const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const $ = cheerio.load(html);
        const jobs = this.extractJobs($, board);
        results.push(...jobs);
        logger.info('[StartupBoards] %s returned %d listings', board.name, jobs.length);
      } catch (error) {
        logger.warn('[StartupBoards] Could not fetch %s: %s', board.name, (error as Error).message);
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    return results;
  }

  private extractJobs($: cheerio.CheerioAPI, board: BoardSource): RawScrapedJob[] {
    const jobs: RawScrapedJob[] = [];
    const seenUrls = new Set<string>();

    $('a[href]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;

      const card = anchor.closest('article, li, tr, .card, [class*="job"], [class*="opening"], [class*="listing"], [data-testid*="job"]');
      const context = (card.length ? card : anchor.parent()).text().replace(/\s+/g, ' ').trim();
      const url = this.toAbsoluteUrl(href, board.url);
      if (!url || seenUrls.has(url) || !this.looksLikeJobLink(url, href)) return;

      const container = card.length ? card : anchor.parent();
      const title = container.find('h1, h2, h3, h4, [class*="title"]')
        .first().text().replace(/\s+/g, ' ').trim() || anchor.text().replace(/\s+/g, ' ').trim();
      if (title.length < 6 || title.length > 220 || /^(apply|apply now|read more|view job|learn more)$/i.test(title)) return;

      const company = container.find('[class*="company"], [class*="startup"], [class*="employer"], [class*="organization"]')
        .first().text().replace(/\s+/g, ' ').trim() || board.name;
      const location = this.readLocation(context);
      const isRemote = /remote|work from home|anywhere/i.test(context);
      const salary = context.match(/(?:₹|INR\s?)[\d,]+(?:\s*[-–]\s*(?:₹|INR\s?)?[\d,]+)?(?:\s*\/\s*(?:yr|year|month|mo))?/i)?.[0];

      seenUrls.add(url);
      jobs.push({
        source: this.source,
        title,
        company,
        location,
        description: `Startup opportunity listed on ${board.name}. ${context || title} Apply through the linked listing and verify the opening on the employer's site when available.`,
        url,
        salary,
        isRemote,
        experience: this.readExperience(context),
        metadata: { board: board.name, listingPage: board.url },
      });
    });

    return jobs;
  }

  private looksLikeJobLink(url: string, href: string): boolean {
    const pathAndHref = `${url} ${href}`.toLowerCase();
    return /\/jobs?\/|\/positions?\/|\/opportunit(?:y|ies)\/|job_id=|jobid=/i.test(pathAndHref);
  }

  private toAbsoluteUrl(href: string, baseUrl: string): string | null {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  }

  private readLocation(context: string): string {
    const match = context.match(/(?:remote|hybrid|onsite|on-site|bengaluru|bangalore|hyderabad|pune|mumbai|chennai|delhi|noida|gurgaon|india)/i);
    return match?.[0] || 'India (see listing)';
  }

  private readExperience(context: string): string | undefined {
    return context.match(/\b(?:0\s*[-–to]+\s*\d+\s*years?|fresher|entry[- ]level|intern(?:ship)?|new grad)\b/i)?.[0];
  }
}
