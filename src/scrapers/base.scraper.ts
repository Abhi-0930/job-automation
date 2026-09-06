import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../config/logger.js';
import { RawScrapedJob } from '../types/job.js';

export interface ScraperOptions {
  headless?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export abstract class BaseScraper {
  public abstract readonly name: string;
  public abstract readonly source: string;

  protected options: ScraperOptions;
  private browser: Browser | null = null;

  constructor(options: ScraperOptions = {}) {
    this.options = {
      headless: true,
      timeoutMs: 30000,
      retries: 2,
      ...options,
    };
  }

  /**
   * Initializes browser instance if needed.
   */
  protected async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.options.headless ?? true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Creates a stealth browser context with realistic headers and user-agent.
   */
  protected async createBrowserContext(): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await this.getBrowser();
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    ];

    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    const context = await browser.newContext({
      userAgent: randomUA,
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata',
    });

    const page = await context.newPage();
    page.setDefaultTimeout(this.options.timeoutMs ?? 30000);

    return { context, page };
  }

  /**
   * Closes browser resources.
   */
  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Executes the scraper with retry and error handling.
   */
  public async execute(): Promise<RawScrapedJob[]> {
    const retries = this.options.retries ?? 2;
    let attempt = 0;

    while (attempt <= retries) {
      attempt++;
      try {
        logger.info('[%s] Starting scraping job (attempt %d/%d)...', this.name, attempt, retries + 1);
        const startTime = Date.now();
        const results = await this.scrape();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        logger.info(
          '[%s] Scraping finished successfully. Found %d jobs in %ss',
          this.name,
          results.length,
          duration
        );
        return results;
      } catch (error) {
        logger.warn(
          '[%s] Scraping failed on attempt %d: %s',
          this.name,
          attempt,
          (error as Error).message
        );
        if (attempt > retries) {
          logger.error('[%s] Scraping exhausted all retries. Returning empty list.', this.name);
          return [];
        }
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      } finally {
        await this.close().catch(() => {});
      }
    }

    return [];
  }

  /**
   * Scrape implementation to be provided by each source subclass.
   */
  protected abstract scrape(): Promise<RawScrapedJob[]>;
}
