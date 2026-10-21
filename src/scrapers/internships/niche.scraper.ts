import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

interface OpportunitySource {
  name: string;
  url: string;
  kind: 'internship' | 'apprenticeship';
}

const OPPORTUNITY_SOURCES: OpportunitySource[] = [
  { name: 'India Science & Technology (ISTI)', url: 'https://www.indiascienceandtechnology.gov.in/listingpage/internships?language=en', kind: 'internship' },
  { name: 'DRDO', url: 'https://drdo.gov.in/drdo/en/search/node?keys=Internship', kind: 'internship' },
  { name: 'MoSPI', url: 'https://internship.mospi.gov.in/', kind: 'internship' },
  { name: 'Uptern', url: 'https://uptern.in/', kind: 'internship' },
  { name: 'YesIntern', url: 'https://www.yesintern.in/', kind: 'internship' },
  // This is an apprenticeship route, included as a distinct early-career option.
  { name: 'NATS', url: 'https://nats.education.gov.in/', kind: 'apprenticeship' },
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export class NicheInternshipScraper extends BaseScraper {
  public readonly name = 'Specialized Internship & Apprenticeship Sources';
  public readonly source = 'niche-internships';

  protected async scrape(): Promise<RawScrapedJob[]> {
    const results: RawScrapedJob[] = [];

    for (const source of OPPORTUNITY_SOURCES) {
      try {
        const response = await axios.get(source.url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          },
          timeout: 20000,
        });
        const $ = cheerio.load(typeof response.data === 'string' ? response.data : JSON.stringify(response.data));
        const found = this.extractListings($, source);
        results.push(...found);
        logger.info('[NicheInternships] %s returned %d listings', source.name, found.length);
      } catch (error) {
        logger.warn('[NicheInternships] Could not fetch %s: %s', source.name, (error as Error).message);
      }

      // Keep requests gentle and avoid one source's failure affecting the rest.
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    return results;
  }

  private extractListings($: cheerio.CheerioAPI, source: OpportunitySource): RawScrapedJob[] {
    const listings: RawScrapedJob[] = [];
    const seenUrls = new Set<string>();

    $('a[href]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;

      const url = this.toAbsoluteUrl(href, source.url);
      if (!url || seenUrls.has(url) || this.isNavigationUrl(url, source.url)) return;

      const card = anchor.closest('article, li, tr, .card, [class*="internship"], [class*="opportunit"], [class*="listing"], [class*="job"]');
      const context = (card.length ? card : anchor.parent()).text().replace(/\s+/g, ' ').trim();
      const heading = (card.length ? card : anchor.parent()).find('h1, h2, h3, h4, [class*="title"]')
        .first().text().replace(/\s+/g, ' ').trim();
      const title = heading || anchor.text().replace(/\s+/g, ' ').trim();
      const listingText = `${title} ${context} ${url}`;
      const isRelevant = source.kind === 'apprenticeship'
        ? /apprentice|apprenticeship/i.test(listingText)
        : /internship|\bintern\b/i.test(listingText);

      if (!isRelevant || title.length < 8 || title.length > 240) return;
      if (/^(apply now|read more|view details|learn more|click here|login|register)$/i.test(title)) return;
      if (/expired|applications closed|last date.{0,12}(over|passed)/i.test(context)) return;

      const company = this.extractOrganization($, card, source.name);
      const location = this.extractLocation(context);
      const stipend = context.match(/(?:₹|INR\s?)[\d,]+(?:\s*[-–]\s*(?:₹|INR\s?)?[\d,]+)?(?:\s*\/\s*(?:month|mo))?/i)?.[0];
      const normalizedTitle = /internship|\bintern\b|apprenticeship|apprentice/i.test(title)
        ? title
        : `${title} ${source.kind === 'apprenticeship' ? 'Apprenticeship' : 'Internship'}`;

      seenUrls.add(url);
      listings.push({
        source: this.source,
        title: normalizedTitle,
        company,
        location,
        description: `${source.kind === 'apprenticeship' ? 'Apprenticeship' : 'Internship'} listing from ${source.name}. ${context || title}${stipend ? ` Stipend shown: ${stipend}.` : ''} Check the source notice for eligibility, age or student-status requirements, dates, and application instructions.`,
        url,
        salary: stipend,
        isRemote: /remote|work from home|online/i.test(context),
        experience: 'Students / Early career',
        metadata: { publisher: source.name, listingPage: source.url, opportunityType: source.kind },
      });
    });

    return listings;
  }

  private extractOrganization($: cheerio.CheerioAPI, card: cheerio.Cheerio<any>, fallback: string): string {
    const organization = card.find('[class*="company"], [class*="organisation"], [class*="organization"], [class*="employer"]')
      .first().text().replace(/\s+/g, ' ').trim();
    return organization || fallback;
  }

  private extractLocation(context: string): string {
    const explicit = context.match(/(?:location|based in|city)\s*[:\-]\s*([^|•,;]{2,60})/i)?.[1]?.trim();
    if (explicit) return explicit;
    if (/remote|work from home|online/i.test(context)) return 'Remote / Online';
    return 'India (see listing)';
  }

  private toAbsoluteUrl(href: string, baseUrl: string): string | null {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  }

  private isNavigationUrl(url: string, sourceUrl: string): boolean {
    try {
      const parsed = new URL(url);
      const base = new URL(sourceUrl);
      if (parsed.origin !== base.origin) return true;
      return /\/(?:login|register|signup|privacy|terms|about|contact|search)(?:\/|$)/i.test(parsed.pathname);
    } catch {
      return true;
    }
  }
}
