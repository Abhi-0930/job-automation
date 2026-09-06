import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

export class InternshalaScraper extends BaseScraper {
  public readonly name = 'Internshala Scraper';
  public readonly source = 'internshala';

  private targetEndpoints = [
    { url: 'https://internshala.com/internships/matching-preferences/', isInternship: true },
    { url: 'https://internshala.com/jobs/fresher-jobs/', isInternship: false },
    { url: 'https://internshala.com/internships/work-from-home-internships/', isInternship: true },
  ];

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    for (const target of this.targetEndpoints) {
      try {
        const results = await this.scrapeEndpoint(target.url, target.isInternship);
        jobs.push(...results);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      } catch (err) {
        logger.warn('[Internshala] Error scraping %s: %s', target.url, (err as Error).message);
      }
    }

    if (jobs.length === 0) {
      // Browser fallback
      return this.scrapeWithBrowser();
    }

    return jobs;
  }

  private async scrapeEndpoint(url: string, isInternship: boolean): Promise<RawScrapedJob[]> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const response = await axios.get(url, { headers, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const jobs: RawScrapedJob[] = [];

    $('.individual_internship').each((_, el) => {
      const title = $(el).find('.job-internship-name, .profile, h3.heading_4_5').text().trim();
      const company = $(el).find('.company-name, .link_display_like_text').text().trim();
      const location = $(el).find('.row-1-item.locations, .location_link, .locations span').text().trim() || 'Work From Home';
      const stipend = $(el).find('.stipend, .salary').text().trim();
      const relativeUrl = $(el).find('.job-title-href, .view_detail_button').attr('href') || '';
      
      const fullUrl = relativeUrl.startsWith('http')
        ? relativeUrl
        : `https://internshala.com${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`;

      if (title && company && relativeUrl) {
        const isRemote = location.toLowerCase().includes('work from home') || location.toLowerCase().includes('remote');

        jobs.push({
          source: this.source,
          title: isInternship && !title.toLowerCase().includes('intern') ? `${title} Intern` : title,
          company,
          location: isRemote ? 'Work From Home (Remote)' : location,
          description: `${isInternship ? 'Internship' : 'Job'} at ${company}: ${title}. Location: ${location}. Stipend/Salary: ${stipend || 'Competitive'}. Apply on Internshala.`,
          url: fullUrl,
          salary: stipend,
          isRemote,
          experience: isInternship ? 'Students / Freshers' : '0-2 Years',
          metadata: { isInternship, stipend },
        });
      }
    });

    return jobs;
  }

  private async scrapeWithBrowser(): Promise<RawScrapedJob[]> {
    const { context, page } = await this.createBrowserContext();
    const jobs: RawScrapedJob[] = [];

    try {
      await page.goto('https://internshala.com/internships', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.individual_internship', { timeout: 10000 }).catch(() => {});

      const cards = await page.$$('.individual_internship');
      for (const card of cards.slice(0, 10)) {
        try {
          const title = await card.$eval('.job-internship-name, .profile, h3', (el) => el.textContent?.trim() || '').catch(() => '');
          const company = await card.$eval('.company-name, .link_display_like_text', (el) => el.textContent?.trim() || '').catch(() => '');
          const location = await card.$eval('.row-1-item.locations, .locations span', (el) => el.textContent?.trim() || '').catch(() => 'Work From Home');
          const link = await card.$eval('.job-title-href, a.view_detail_button', (el) => (el as HTMLAnchorElement).href || '').catch(() => '');
          const stipend = await card.$eval('.stipend, .salary', (el) => el.textContent?.trim() || '').catch(() => '');

          if (title && company && link) {
            const isRemote = location.toLowerCase().includes('work from home') || location.toLowerCase().includes('remote');
            jobs.push({
              source: this.source,
              title: !title.toLowerCase().includes('intern') ? `${title} Intern` : title,
              company,
              location: isRemote ? 'Work From Home (Remote)' : location,
              description: `Internship at ${company}: ${title}. Stipend: ${stipend}. Apply on Internshala.`,
              url: link,
              salary: stipend,
              isRemote,
              experience: 'Freshers',
            });
          }
        } catch {
          // ignore single item parsing error
        }
      }
    } catch (error) {
      logger.warn('[Internshala] Browser scrape failed: %s', (error as Error).message);
    } finally {
      await context.close().catch(() => {});
    }

    return jobs;
  }
}
