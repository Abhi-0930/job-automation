import axios from 'axios';
import { BaseScraper } from '../base.scraper.js';
import { RawScrapedJob } from '../../types/job.js';
import { logger } from '../../config/logger.js';

interface RemoteOkJob {
  id?: string | number;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  url?: string;
  tags?: string[];
}

interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobGeo: string;
  jobExcerpt?: string;
  jobType?: string[];
}

export class PublicFeedsScraper extends BaseScraper {
  public readonly name = 'Public Feeds Scraper (RemoteOK & Jobicy)';
  public readonly source = 'public-feeds';

  protected async scrape(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    // 1. Fetch RemoteOK
    try {
      const remoteOkJobs = await this.fetchRemoteOk();
      jobs.push(...remoteOkJobs);
      logger.info('[PublicFeeds] RemoteOK returned %d opportunities across diverse companies', remoteOkJobs.length);
    } catch (err) {
      logger.warn('[PublicFeeds] RemoteOK fetch failed: %s', (err as Error).message);
    }

    // 2. Fetch Jobicy
    try {
      const jobicyJobs = await this.fetchJobicy();
      jobs.push(...jobicyJobs);
      logger.info('[PublicFeeds] Jobicy returned %d opportunities across diverse companies', jobicyJobs.length);
    } catch (err) {
      logger.warn('[PublicFeeds] Jobicy fetch failed: %s', (err as Error).message);
    }

    return jobs;
  }

  private async fetchRemoteOk(): Promise<RawScrapedJob[]> {
    const url = 'https://remoteok.com/api';
    const response = await axios.get<RemoteOkJob[]>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      timeout: 12000,
    });

    const rawList = Array.isArray(response.data) ? response.data.slice(1) : []; // first element is metadata
    const jobs: RawScrapedJob[] = [];

    for (const item of rawList.slice(0, 50)) {
      if (!item.position || !item.company || !item.url) continue;

      const title = item.position.trim();
      if (this.isSeniorTitle(title)) continue;

      const company = item.company.trim();
      const location = item.location?.trim() || 'Worldwide / Remote';
      const cleanDesc = (item.description || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

      jobs.push({
        source: this.source,
        externalId: item.id ? String(item.id) : undefined,
        title,
        company,
        location: location.toLowerCase().includes('remote') ? location : `${location} (Remote)`,
        description: `Opportunity at ${company}: ${title}. Location: ${location}. Skills: ${(item.tags || []).slice(0, 5).join(', ')}. ${cleanDesc}`,
        url: item.url.startsWith('http') ? item.url : `https://remoteok.com${item.url}`,
        isRemote: true,
        experience: 'Freshers & 0-2 Years',
        metadata: { portal: 'remoteok', tags: item.tags },
      });
    }

    return jobs;
  }

  private async fetchJobicy(): Promise<RawScrapedJob[]> {
    const url = 'https://jobicy.com/api/v2/remote-jobs?count=40';
    const response = await axios.get<{ jobs?: JobicyJob[] }>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      timeout: 12000,
    });

    const list = response.data?.jobs || [];
    const jobs: RawScrapedJob[] = [];

    for (const item of list) {
      if (!item.jobTitle || !item.companyName || !item.url) continue;

      const title = item.jobTitle.trim();
      if (this.isSeniorTitle(title)) continue;

      const company = item.companyName.trim();
      const location = item.jobGeo || 'Remote / Anywhere';
      const cleanExcerpt = (item.jobExcerpt || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();

      jobs.push({
        source: this.source,
        externalId: String(item.id),
        title,
        company,
        location: location.toLowerCase().includes('remote') ? location : `${location} (Remote)`,
        description: `Remote opening at ${company}: ${title}. Geographic availability: ${location}. ${cleanExcerpt}`,
        url: item.url,
        isRemote: true,
        experience: 'Freshers & 0-2 Years',
        metadata: { portal: 'jobicy', types: item.jobType },
      });
    }

    return jobs;
  }

  private isSeniorTitle(title: string): boolean {
    return /\b(senior|sr\.?\b|lead\b|principal|staff|architect|manager|director|vp\b|head\s*of)\b/i.test(title);
  }
}
