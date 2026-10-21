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

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  department?: string;
  employmentType?: string;
  jobUrl: string;
  isRemote?: boolean;
  descriptionPlain?: string;
}

export class CareersScraper extends BaseScraper {
  public readonly name = 'Company Career Pages Scraper';
  public readonly source = 'careers';

  // Notable tech companies & high-growth startups using Greenhouse ATS
  private greenhouseCompanies = [
    { name: 'Figma', boardToken: 'figma' },
    { name: 'Stripe', boardToken: 'stripe' },
    { name: 'Groww', boardToken: 'groww' },
    { name: 'Postman', boardToken: 'postman' },
    { name: 'GitHub', boardToken: 'github' },
    { name: 'Cloudflare', boardToken: 'cloudflare' },
    { name: 'Datadog', boardToken: 'datadog' },
    { name: 'GitLab', boardToken: 'gitlab' },
    { name: 'Twilio', boardToken: 'twilio' },
    { name: 'Discord', boardToken: 'discord' },
    { name: 'Grammarly', boardToken: 'grammarly' },
    { name: 'BrowserStack', boardToken: 'browserstack' },
    { name: 'Hasura', boardToken: 'hasura' },
    { name: 'InMobi', boardToken: 'inmobi' },
    { name: 'Urban Company', boardToken: 'urbancompany' },
    { name: 'Pinterest', boardToken: 'pinterest' },
    { name: 'Elastic', boardToken: 'elastic' },
    { name: 'Thoughtworks', boardToken: 'thoughtworks' },
  ];

  // Modern tech companies & AI leaders using Ashby ATS
  private ashbyCompanies = [
    { name: 'Perplexity AI', boardName: 'perplexity' },
    { name: 'Vercel', boardName: 'vercel' },
    { name: 'Ramp', boardName: 'ramp' },
    { name: 'Retool', boardName: 'retool' },
    { name: 'Linear', boardName: 'linear' },
    { name: 'Notion', boardName: 'notion' },
    { name: 'Modal Labs', boardName: 'modal' },
    { name: 'ElevenLabs', boardName: 'elevenlabs' },
    { name: 'Replit', boardName: 'replit' },
    { name: 'Cursor (Anysphere)', boardName: 'anysphere' },
    { name: 'Quora', boardName: 'quora' },
  ];

  // Notable tech companies & startups using Lever ATS
  private leverCompanies = [
    { name: 'Atlassian', site: 'atlassian' },
    { name: 'Palantir', site: 'palantir' },
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

    // 2. Fetch from Ashby boards (Modern Tech & AI Leaders)
    for (const company of this.ashbyCompanies) {
      try {
        const ashbyJobs = await this.fetchAshby(company.name, company.boardName);
        jobs.push(...ashbyJobs);
      } catch (err) {
        logger.debug('[Careers] Ashby fetch failed for %s: %s', company.name, (err as Error).message);
      }
    }

    // 3. Fetch from Lever boards
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
      if (this.isSeniorTitle(job.title)) continue;
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
      if (this.isSeniorTitle(job.text)) continue;
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

  private async fetchAshby(companyName: string, boardName: string): Promise<RawScrapedJob[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${boardName}`;
    const response = await axios.get<{ jobs?: AshbyJob[] }>(url, { timeout: 10000 });

    const rawJobs = response.data?.jobs || [];
    const filtered: RawScrapedJob[] = [];

    for (const job of rawJobs) {
      if (this.isSeniorTitle(job.title)) continue;
      const loc = job.location || (job.isRemote ? 'Remote' : 'India / Remote');
      const isIndiaOrRemote =
        job.isRemote ||
        loc.toLowerCase().includes('remote') ||
        loc.toLowerCase().includes('india') ||
        loc.toLowerCase().includes('bangalore') ||
        loc.toLowerCase().includes('bengaluru') ||
        loc.toLowerCase().includes('hyderabad') ||
        loc.toLowerCase().includes('anywhere');

      if (isIndiaOrRemote) {
        const isRemote = !!job.isRemote || loc.toLowerCase().includes('remote') || job.title.toLowerCase().includes('remote');

        filtered.push({
          source: this.source,
          externalId: job.id,
          title: job.title,
          company: companyName,
          location: loc,
          description: `Direct opening at ${companyName}: ${job.title} in ${loc}. Department: ${
            job.department || 'Engineering'
          }. Apply directly on official career portal.`,
          url: job.jobUrl,
          isRemote,
          metadata: { ats: 'ashby', boardName },
        });
      }
    }

    return filtered;
  }

  private isSeniorTitle(title: string): boolean {
    return /\b(senior|sr\.?\b|lead\b|principal|staff|architect|manager|director|vp\b|head\s*of)\b/i.test(title);
  }
}
