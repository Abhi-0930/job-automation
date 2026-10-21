import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

interface GovtFeed {
  url: string;
  publisher: string;
  kind: 'freejobalert' | 'official';
}

const GOVT_FEEDS: GovtFeed[] = [
  // Broad alert aggregator, retained as a discovery source.
  { url: 'https://www.freejobalert.com/government-jobs/', publisher: 'FreeJobAlert', kind: 'freejobalert' },
  { url: 'https://www.freejobalert.com/engineering-jobs/', publisher: 'FreeJobAlert', kind: 'freejobalert' },
  { url: 'https://www.freejobalert.com/bank-jobs/', publisher: 'FreeJobAlert', kind: 'freejobalert' },
  // Primary sources: verify vacancies and application details against the original notice.
  { url: 'https://employmentnews.gov.in/NewEmp/AllJobs.aspx?k=All', publisher: 'Employment News', kind: 'official' },
  { url: 'https://ncs.gov.in/latest-update', publisher: 'National Career Service', kind: 'official' },
  { url: 'https://upsc.gov.in/recruitment/recruitment-advertisements', publisher: 'UPSC', kind: 'official' },
  { url: 'https://ssc.gov.in/', publisher: 'SSC', kind: 'official' },
  { url: 'https://rrcb.gov.in/', publisher: 'Railway Recruitment Control Board', kind: 'official' },
];

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

export class GovtJobsScraper extends BaseScraper {
  public readonly name = 'Government & PSU Jobs Scraper';
  public readonly source = 'govt';

  protected async scrape(): Promise<RawScrapedJob[]> {
    const allJobs: RawScrapedJob[] = [];

    // Fetch sources independently so one site being unavailable does not block the others.
    for (const feed of GOVT_FEEDS) {
      try {
        const response = await axios.get(feed.url, { headers: REQUEST_HEADERS, timeout: 20000 });
        const $ = cheerio.load(response.data);
        const jobs = feed.kind === 'freejobalert'
          ? this.parseFreeJobAlert($)
          : this.parseOfficialListing($, feed);
        allJobs.push(...jobs);
        logger.info('[GovtScraper] %s returned %d listings', feed.publisher, jobs.length);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        logger.warn('[GovtScraper] Error scraping %s (%s): %s', feed.publisher, feed.url, (err as Error).message);
      }
    }

    // Remove duplicate rows discovered across overlapping feeds before DB-level deduplication.
    const seen = new Set<string>();
    return allJobs.filter((job) => {
      const key = job.title.toLowerCase().replace(/^government job:\s*/, '').replace(/\brecruitment\b|\bonline form\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private parseFreeJobAlert($: cheerio.CheerioAPI): RawScrapedJob[] {
    const jobs: RawScrapedJob[] = [];
    $('table.latjnstab tr, table tr').each((_, el) => {
      const cells = $(el).find('td');
      const postDate = cells.eq(0).text().trim();
      const agency = cells.eq(1).text().trim();
      const postName = cells.eq(2).text().trim();
      const qualification = cells.eq(3).text().trim();
      const lastDate = cells.eq(4).text().trim();
      const link = $(el).find('td a').last().attr('href') || $(el).find('a').first().attr('href') || '';

      if (!agency || !postName || !link) return;
      const absoluteLink = this.absoluteUrl(link, 'https://www.freejobalert.com/');
      if (!absoluteLink) return;

      const rowText = $(el).text();
      const ageMatch = rowText.match(/\b(?:age\s*limit|age)\s*[:\-–]?\s*([0-9]{1,2}\s*[-–to]+\s*[0-9]{1,2}\s*(?:years?|yrs?)?|(?:max(?:imum)?|upto|under)\s*[0-9]{1,2}\s*(?:years?|yrs?))/i);
      const ageLimit = ageMatch ? ageMatch[1].trim() : 'As per Govt rules';

      jobs.push({
        source: this.source,
        title: `${postName} Recruitment (${agency})`,
        company: agency,
        location: 'India',
        description: `Government job listing discovered on FreeJobAlert. Qualification: ${qualification || 'Any Degree / Diploma / B.Tech'}. Last date: ${lastDate || 'See official notification'}. Age limit: ${ageLimit}. Posted: ${postDate}.`,
        url: absoluteLink,
        isRemote: false,
        experience: 'Freshers / 0-2 Years',
        metadata: { postDate, lastDate, qualification, ageLimit, agency, publisher: 'FreeJobAlert' },
      });
    });
    return jobs;
  }

  private parseOfficialListing($: cheerio.CheerioAPI, feed: GovtFeed): RawScrapedJob[] {
    const jobs: RawScrapedJob[] = [];
    const seenUrls = new Set<string>();

    $('a[href]').each((_, el) => {
      const anchor = $(el);
      const title = anchor.text().replace(/\s+/g, ' ').trim();
      const href = anchor.attr('href') || '';
      if (title.length < 12 || title.length > 240 || !href || /^(javascript:|mailto:|#)/i.test(href)) return;

      const url = this.absoluteUrl(href, feed.url);
      if (!url || seenUrls.has(url)) return;

      // Keep vacancy/advertisement links and descriptive job notices; skip navigation and generic site links.
      const context = anchor.closest('tr, li, article').text().replace(/\s+/g, ' ').trim();
      const searchable = `${title} ${context} ${url}`;
      if (!/(recruit|vacan|job|post|advertisement|notification|application|employment|career|engagement|fellow|apprent|consultant|officer|assistant|engineer|scientist|constable|teacher|technician|director|manager)/i.test(searchable)) return;
      if (/^(home|about us|contact us|privacy policy|login|register|read more|view all)$/i.test(title)) return;

      seenUrls.add(url);
      const organization = feed.publisher;

      const qualMatch = context.match(/\b(?:qualification|eligibility|education)\s*[:\-–]?\s*([^.,\n;]+)/i);
      const ageMatch = context.match(/\b(?:age\s*limit|age)\s*[:\-–]?\s*([0-9]{1,2}\s*[-–to]+\s*[0-9]{1,2}\s*(?:years?|yrs?)?|(?:max(?:imum)?|upto|under)\s*[0-9]{1,2}\s*(?:years?|yrs?))/i);
      const dateMatch = context.match(/\b(?:last\s*date|deadline|closing\s*date|apply\s*by)\s*[:\-–]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+[0-9]{4})?)/i);

      const qualification = qualMatch ? qualMatch[1].trim() : 'Any Degree / B.Tech / Diploma';
      const ageLimit = ageMatch ? ageMatch[1].trim() : 'As per Govt rules';
      const lastDate = dateMatch ? dateMatch[1].trim() : 'Refer Notification';

      jobs.push({
        source: this.source,
        title: `Government Job: ${title}`,
        company: organization,
        location: 'India',
        description: `${feed.publisher} listing: ${context || title}. Qualification: ${qualification}. Age Limit: ${ageLimit}. Last Date: ${lastDate}.`,
        url,
        isRemote: false,
        experience: 'Freshers / 0-2 Years',
        metadata: { publisher: feed.publisher, listingPage: feed.url, qualification, ageLimit, lastDate },
      });
    });

    return jobs;
  }

  private absoluteUrl(href: string, baseUrl: string): string | null {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  }
}
