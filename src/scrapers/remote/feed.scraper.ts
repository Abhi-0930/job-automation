import axios from 'axios';
import * as cheerio from 'cheerio';
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

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  tags?: string[];
}

export class PublicFeedsScraper extends BaseScraper {
  public readonly name = 'Developer & Tech Platforms (RemoteOK, Remotive, WWR, HN, Jobicy)';
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

    // 2. Fetch Remotive (Global Tech & Engineering)
    try {
      const remotiveJobs = await this.fetchRemotive();
      jobs.push(...remotiveJobs);
      logger.info('[PublicFeeds] Remotive returned %d opportunities across diverse companies', remotiveJobs.length);
    } catch (err) {
      logger.warn('[PublicFeeds] Remotive fetch failed: %s', (err as Error).message);
    }

    // 3. Fetch WeWorkRemotely (WWR Programming Jobs)
    try {
      const wwrJobs = await this.fetchWeWorkRemotely();
      jobs.push(...wwrJobs);
      logger.info('[PublicFeeds] WeWorkRemotely returned %d opportunities across diverse companies', wwrJobs.length);
    } catch (err) {
      logger.warn('[PublicFeeds] WeWorkRemotely fetch failed: %s', (err as Error).message);
    }

    // 4. Fetch Hacker News (Who is Hiring - Direct Founder & Engineering Team posts)
    try {
      const hnJobs = await this.fetchHackerNews();
      jobs.push(...hnJobs);
      logger.info('[PublicFeeds] Hacker News (Who is Hiring) returned %d opportunities across diverse companies', hnJobs.length);
    } catch (err) {
      logger.warn('[PublicFeeds] Hacker News fetch failed: %s', (err as Error).message);
    }

    // 5. Fetch Jobicy
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

  private async fetchRemotive(): Promise<RawScrapedJob[]> {
    const url = 'https://remotive.com/api/remote-jobs?category=software-dev&limit=40';
    const response = await axios.get<{ jobs?: RemotiveJob[] }>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      timeout: 12000,
    });

    const list = response.data?.jobs || [];
    const jobs: RawScrapedJob[] = [];

    for (const item of list) {
      if (!item.title || !item.company_name || !item.url) continue;

      const title = item.title.trim();
      if (this.isSeniorTitle(title)) continue;

      const company = item.company_name.trim();
      const location = item.candidate_required_location || 'Worldwide / Remote';
      const cleanDesc = (item.description || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 450);

      jobs.push({
        source: this.source,
        externalId: String(item.id),
        title,
        company,
        location: location.toLowerCase().includes('remote') ? location : `${location} (Remote)`,
        description: `Opportunity at ${company}: ${title}. Location: ${location}. Salary: ${item.salary || 'Competitive'}. ${cleanDesc}`,
        url: item.url,
        isRemote: true,
        experience: 'Freshers & 0-2 Years',
        metadata: { portal: 'remotive', salary: item.salary, tags: item.tags },
      });
    }

    return jobs;
  }

  private async fetchWeWorkRemotely(): Promise<RawScrapedJob[]> {
    const url = 'https://weworkremotely.com/categories/remote-programming-jobs.rss';
    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      timeout: 12000,
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const jobs: RawScrapedJob[] = [];

    $('item').each((_, el) => {
      const rawTitle = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim();
      const desc = $(el).find('description').text().replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);

      if (!rawTitle || !link) return;

      // WWR titles are usually formatted as "Company: Job Title"
      let company = 'Tech Startup';
      let title = rawTitle;
      if (rawTitle.includes(':')) {
        const parts = rawTitle.split(':');
        company = parts[0].trim();
        title = parts.slice(1).join(':').trim();
      }

      if (this.isSeniorTitle(title)) return;

      jobs.push({
        source: this.source,
        title,
        company,
        location: 'Remote (Worldwide / Flexible)',
        description: `WeWorkRemotely Developer Opening: ${title} at ${company}. ${desc}`,
        url: link,
        isRemote: true,
        experience: 'Freshers & 0-2 Years',
        metadata: { portal: 'weworkremotely' },
      });
    });

    return jobs;
  }

  private async fetchHackerNews(): Promise<RawScrapedJob[]> {
    const jobs: RawScrapedJob[] = [];

    // Find the latest "Ask HN: Who is hiring?" thread ID
    const searchUrl = 'https://hn.algolia.com/api/v1/search?tags=story,author_whoishiring&query=%22Ask%20HN:%20Who%20is%20hiring%22&hitsPerPage=1';
    const searchRes = await axios.get<{ hits?: Array<{ objectID: string; title: string }> }>(searchUrl, {
      timeout: 10000,
    });

    const story = searchRes.data?.hits?.[0];
    if (!story?.objectID) return jobs;

    // Fetch top hiring comments posted by engineering leads / founders
    const commentsUrl = `https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&hitsPerPage=40`;
    const commentsRes = await axios.get<{
      hits?: Array<{ objectID: string; author: string; comment_text?: string; created_at: string }>;
    }>(commentsUrl, { timeout: 10000 });

    const comments = commentsRes.data?.hits || [];

    for (const c of comments) {
      if (!c.comment_text) continue;
      const clean = c.comment_text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length < 50) continue;

      // Extract first line which typically has "Company | Title | Location | ..."
      const firstLine = clean.split('\n')[0] || clean.slice(0, 150);
      const segments = firstLine.split('|').map((s) => s.trim());

      let company = 'YC / HN Startup';
      let title = 'Software Engineer';
      let location = 'Remote / Hybrid';

      if (segments.length >= 2) {
        company = segments[0].slice(0, 60);
        title = segments[1].slice(0, 100);
        if (segments[2]) location = segments[2].slice(0, 60);
      } else {
        const compMatch = clean.match(/^([A-Za-z0-9\s.,]+?)\s+(?:is hiring|looking for|needs)\s+([A-Za-z0-9\s]+)/i);
        if (compMatch) {
          company = compMatch[1].trim();
          title = compMatch[2].trim();
        }
      }

      if (this.isSeniorTitle(title)) continue;

      // Extract url if present in comment text
      const urlMatch = clean.match(/https?:\/\/[^\s"'<>]+/i);
      const jobUrl = urlMatch ? urlMatch[0] : `https://news.ycombinator.com/item?id=${c.objectID}`;

      jobs.push({
        source: this.source,
        externalId: c.objectID,
        title,
        company,
        location,
        description: `Hacker News Direct-to-Founder / Engineering Lead post: ${clean.slice(0, 450)}`,
        url: jobUrl,
        isRemote: location.toLowerCase().includes('remote') || clean.toLowerCase().includes('remote'),
        experience: 'Freshers & 0-2 Years',
        metadata: { portal: 'hackernews', hnCommentId: c.objectID, author: c.author },
      });
    }

    return jobs;
  }

  private isSeniorTitle(title: string): boolean {
    return /\b(senior|sr\.?\b|lead\b|principal|staff|architect|manager|director|vp\b|head\s*of)\b/i.test(title);
  }
}
