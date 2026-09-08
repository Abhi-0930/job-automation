import axios from 'axios';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

interface GreenhouseJob {
  id: number;
  title: string;
  location?: { name: string };
  absolute_url: string;
  updated_at: string;
  departments?: Array<{ name: string }>;
  content?: string;
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: {
    location?: string;
    team?: string;
    commitment?: string;
  };
  descriptionPlain?: string;
}

export class CareersScraper extends BaseScraper {
  public readonly name = 'Company Career Pages Scraper';
  public readonly source = 'careers';

  // Notable tech companies & high-growth startups using Greenhouse ATS
  private greenhouseCompanies = [
    { name: 'Razorpay', boardToken: 'razorpay' },
    { name: 'Zepto', boardToken: 'zepto' },
    { name: 'Swiggy', boardToken: 'swiggy' },
    { name: 'Meesho', boardToken: 'meesho' },
    { name: 'Cred', boardToken: 'cred' },
    { name: 'Groww', boardToken: 'groww' },
    { name: 'Urban Company', boardToken: 'urbancompany' },
    { name: 'Nykaa', boardToken: 'nykaa' },
    { name: 'Figma', boardToken: 'figma' },
    { name: 'Stripe', boardToken: 'stripe' },
    { name: 'Postman', boardToken: 'postman' },
    { name: 'GitHub', boardToken: 'github' },
    { name: 'InMobi', boardToken: 'inmobi' },
    { name: 'BrowserStack', boardToken: 'browserstack' },
    { name: 'Hasura', boardToken: 'hasura' },
  ];

  // Notable tech companies & startups using Lever ATS
  private leverCompanies = [
    { name: 'Atlassian', site: 'atlassian' },
    { name: 'Palantir', site: 'palantir' },
    { name: 'Coinbase', site: 'coinbase' },
    { name: 'Clevertap', site: 'clevertap' },
    { name: 'Slice', site: 'slice' },
    { name: 'CoinSwitch', site: 'coinswitch' },
  ];

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    // 1. Fetch from Greenhouse boards
    for (const company of this.greenhouseCompanies) {
      try {
        const ghJobs = await this.fetchGreenhouse(company.name, company.boardToken);
        jobs.push(...ghJobs);
      } catch (err) {
        logger.debug('[Careers] Greenhouse fetch failed for %s: %s', company.name, (err as Error).message);
      }
    }

    // 2. Fetch from Lever boards
    for (const company of this.leverCompanies) {
      try {
        const leverJobs = await this.fetchLever(company.name, company.site);
        jobs.push(...leverJobs);
      } catch (err) {
        logger.debug('[Careers] Lever fetch failed for %s: %s', company.name, (err as Error).message);
      }
    }

    logger.info('[Careers] Collected total %d verified direct company career jobs', jobs.length);
    return jobs;
  }

  private async fetchGreenhouse(companyName: string, boardToken: string): Promise<RawScrapedJob[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`;
    const response = await axios.get<{ jobs: GreenhouseJob[] }>(url, { timeout: 10000 });

    const rawJobs = response.data?.jobs || [];
    const filtered: RawScrapedJob[] = [];

    for (const job of rawJobs) {
      const loc = job.location?.name || 'Remote';
      const isIndiaOrRemote =
        loc.toLowerCase().includes('india') ||
        loc.toLowerCase().includes('bangalore') ||
        loc.toLowerCase().includes('bengaluru') ||
        loc.toLowerCase().includes('hyderabad') ||
        loc.toLowerCase().includes('remote') ||
        loc.toLowerCase().includes('anywhere');

      // Focus on India & Global Remote positions
      if (isIndiaOrRemote) {
        const isRemote = loc.toLowerCase().includes('remote') || job.title.toLowerCase().includes('remote');

        filtered.push({
          source: this.source,
          externalId: String(job.id),
          title: job.title,
          company: companyName,
          location: loc,
          description: `Direct opening at ${companyName}: ${job.title} in ${loc}. Department: ${
            job.departments?.map((d) => d.name).join(', ') || 'Engineering'
          }. Apply directly on official career portal.`,
          url: job.absolute_url,
          isRemote,
          metadata: { ats: 'greenhouse', boardToken },
        });
      }
    }

    return filtered;
  }

  private async fetchLever(companyName: string, site: string): Promise<RawScrapedJob[]> {
    const url = `https://api.lever.co/v0/postings/${site}?mode=json`;
    const response = await axios.get<LeverJob[]>(url, { timeout: 10000 });

    const rawJobs = Array.isArray(response.data) ? response.data : [];
    const filtered: RawScrapedJob[] = [];

    for (const job of rawJobs) {
      const loc = job.categories?.location || 'Remote';
      const isIndiaOrRemote =
        loc.toLowerCase().includes('india') ||
        loc.toLowerCase().includes('bangalore') ||
        loc.toLowerCase().includes('hyderabad') ||
        loc.toLowerCase().includes('remote');

      if (isIndiaOrRemote) {
        const isRemote = loc.toLowerCase().includes('remote') || job.text.toLowerCase().includes('remote');

        filtered.push({
          source: this.source,
          externalId: job.id,
          title: job.text,
          company: companyName,
          location: loc,
          description: `Official job opening at ${companyName}: ${job.text} located in ${loc}. Commitment: ${
            job.categories?.commitment || 'Full-time'
          }. Apply on company portal.`,
          url: job.hostedUrl,
          isRemote,
          metadata: { ats: 'lever', site },
        });
      }
    }

    return filtered;
  }
}
