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
      if (cells.length < 5) return;

      const postDate = cells.eq(0).text().trim();
      const rawAgency = cells.eq(1).text().trim();
      const rawPostName = cells.eq(2).text().trim();
      const qualification = cells.eq(3).text().trim();
      const lastDate = cells.eq(4).text().trim();
      const link = $(el).find('td a').last().attr('href') || $(el).find('a').first().attr('href') || '';

      if (!rawAgency || !rawPostName || !link) return;
      if (/^(post date|recruitment board|post name|qualification|last date)$/i.test(rawAgency)) return;
      if (/^(post date|recruitment board|post name|qualification|last date)$/i.test(rawPostName)) return;

      const absoluteLink = this.absoluteUrl(link, 'https://www.freejobalert.com/');
      if (!absoluteLink) return;

      const agency = rawAgency.replace(/\b(?:online\s*form|recruitment|posts?|vacanc(?:y|ies))\b.*$/i, '').trim() || rawAgency;
      let title = rawPostName;
      if (agency && !title.toLowerCase().includes(agency.toLowerCase())) {
        title = `${agency} ${rawPostName}`;
      }

      jobs.push({
        source: this.source,
        title,
        company: agency,
        location: 'India',
        description: `Government job listing discovered on FreeJobAlert. Qualification: ${qualification || 'Any Degree / Diploma / B.Tech'}. Last date: ${lastDate || 'See official notification'}. Posted: ${postDate}.`,
        url: absoluteLink,
        isRemote: false,
        experience: 'Freshers / 0-2 Years',
        metadata: { postDate, lastDate, qualification, ageLimit: 'As per Govt rules', agency, publisher: 'FreeJobAlert' },
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

/**
 * Enriches a Government & PSU job by fetching the article or notification page
 * to extract the exact Age Limit, Qualification, Last Date, and clean Post Name.
 */
export async function enrichGovtJob(job: RawScrapedJob): Promise<RawScrapedJob> {
  if (!job.url || !job.url.startsWith('http')) return job;

  try {
    const response = await axios.get(job.url, {
      headers: REQUEST_HEADERS,
      timeout: 8000,
    });

    const $ = cheerio.load(response.data);
    const meta = (job.metadata || {}) as Record<string, string>;

    let ageLimit = '';
    let qualification = '';
    let lastDate = '';
    let postName = '';
    let hiringOrg = '';

    // 1. Check HTML summary table (common in FreeJobAlert, SarkariResult, etc.)
    $('table tr').each((_, tr) => {
      const th = $(tr).find('th').text().trim().toLowerCase();
      const td = $(tr).find('td').text().trim();
      if ((th.includes('age limit') || th.includes('age criteria')) && !ageLimit) ageLimit = td;
      if ((th.includes('qualification') || th.includes('educational qualification') || th.includes('eligibility')) && !qualification) qualification = td;
      if ((th.includes('last date') || th.includes('application last date') || th.includes('closing date')) && !lastDate) lastDate = td;
      if (th.includes('post name') && !postName) postName = td;
      if ((th.includes('recruitment board') || th.includes('organization') || th.includes('agency')) && !hiringOrg) hiringOrg = td;
    });

    // 2. Check JSON-LD structured data (FAQPage or JobPosting)
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        if (data['@type'] === 'FAQPage' && Array.isArray(data.mainEntity)) {
          for (const item of data.mainEntity) {
            const q = (item.name || '').toLowerCase();
            const ans = item.acceptedAnswer?.text || '';
            if (q.includes('age limit') && !ageLimit) ageLimit = ans;
            if (q.includes('last date') && !lastDate) lastDate = ans;
            if (q.includes('qualification') && !qualification) qualification = ans;
            if (q.includes('post name') && !postName) postName = ans;
          }
        }
        if (data['@type'] === 'JobPosting') {
          if (data.hiringOrganization?.name && !hiringOrg) hiringOrg = data.hiringOrganization.name;
          if (data.validThrough && !lastDate) lastDate = data.validThrough.split('T')[0];
        }
      } catch {}
    });

    // 3. Fallback body regex
    if (!ageLimit) {
      const bodyText = $('body').text();
      const m = bodyText.match(/\b(?:age\s*limit|maximum\s*age|age)\s*[:\-–]?\s*([0-9]{1,2}\s*[-–to]+\s*[0-9]{1,2}\s*(?:years?|yrs?)?|(?:max(?:imum)?|upto|under)\s*[0-9]{1,2}\s*(?:years?|yrs?))/i);
      if (m) ageLimit = m[1].trim();
    }

    if (!lastDate) {
      const bodyText = $('body').text();
      const m = bodyText.match(/\b(?:last\s*date|apply\s*by|closing\s*date)\s*[:\-–]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+[0-9]{4})?)/i);
      if (m) lastDate = m[1].trim();
    }

    // Clean extracted values
    if (ageLimit) {
      const shortAge = ageLimit.match(/((?:maximum\s*age\s*limit\s*is\s*|max(?:imum)?\s*age\s*[:\-–]?\s*|[0-9]{1,2}\s*[-–to]+\s*)[0-9]{1,2}\s*(?:years?|yrs?)?)/i);
      if (shortAge) {
        ageLimit = shortAge[1].replace(/maximum\s*age\s*limit\s*is/i, 'Max').trim();
        if (!ageLimit.toLowerCase().includes('year')) ageLimit += ' Years';
      }
    }

    const updatedMeta = {
      ...meta,
      ageLimit: ageLimit || meta.ageLimit || 'As per Govt rules',
      qualification: qualification || meta.qualification || 'Any Degree / Diploma / B.Tech',
      lastDate: lastDate || meta.lastDate || 'See Official Notification',
    };

    let updatedCompany = hiringOrg || job.company;
    updatedCompany = updatedCompany.replace(/\b(?:online\s*form|recruitment|posts?|vacanc(?:y|ies))\b.*$/i, '').trim();

    let updatedTitle = job.title;
    if (postName) {
      updatedTitle = `${postName}`;
      if (updatedCompany && !updatedTitle.toLowerCase().includes(updatedCompany.toLowerCase())) {
        updatedTitle = `${updatedCompany} - ${updatedTitle}`;
      }
    } else {
      updatedTitle = updatedTitle.replace(/\s*\([^)]*(?:online\s*form|artisan|recruitment)[^)]*\)/gi, '').trim();
    }

    return {
      ...job,
      title: updatedTitle,
      company: updatedCompany || job.company,
      metadata: updatedMeta,
      description: `${job.description}. Age limit: ${updatedMeta.ageLimit}. Qualification: ${updatedMeta.qualification}. Last Date: ${updatedMeta.lastDate}.`,
    };
  } catch (err) {
    logger.warn('[GovtScraper] Could not enrich job "%s": %s', job.title, (err as Error).message);
    return job;
  }
}
