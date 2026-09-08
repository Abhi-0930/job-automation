import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../config/logger.js';

const CLOSURE_PATTERNS = [
  /no longer accepting applications/i,
  /applications? (?:are|have been) closed/i,
  /this job is closed/i,
  /job (?:has )?expired/i,
  /position is no longer available/i,
  /this listing has expired/i,
  /job is no longer active/i,
  /role (?:you are looking for )?has been filled/i,
  /this posting is no longer available/i,
  /we are no longer accepting submissions/i,
  /application deadline has passed/i,
  /this opening has been closed/i,
  /this opportunity has expired/i,
  /not taking any more applications/i,
];

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface VerificationResult {
  isActive: boolean;
  reason?: string;
}

/**
 * Checks if a job application URL is live and actively accepting applications.
 */
export async function verifyJobApplicationActive(url: string): Promise<VerificationResult> {
  if (!url || !url.startsWith('http')) {
    return { isActive: false, reason: 'Invalid URL' };
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': REALISTIC_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 7000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // Handle 404/410 explicitly
    });

    if (response.status === 404 || response.status === 410) {
      return { isActive: false, reason: `HTTP ${response.status} Job Page Removed` };
    }

    if (typeof response.data !== 'string') {
      return { isActive: true };
    }

    const html = response.data;
    const $ = cheerio.load(html);

    // Strip script and style tags to avoid false positives in JS code
    $('script, style, noscript').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ');

    for (const pattern of CLOSURE_PATTERNS) {
      if (pattern.test(bodyText)) {
        return {
          isActive: false,
          reason: `Detected closure text: "${bodyText.match(pattern)?.[0] || 'Applications Closed'}"`,
        };
      }
    }

    // Specific check for Greenhouse ATS "Job no longer available"
    if (url.includes('greenhouse.io') && bodyText.includes('no longer available')) {
      return { isActive: false, reason: 'Greenhouse posting closed' };
    }

    // Specific check for Lever ATS "Job no longer available"
    if (url.includes('lever.co') && (bodyText.includes('no longer available') || bodyText.includes('closed'))) {
      return { isActive: false, reason: 'Lever posting closed' };
    }

    return { isActive: true };
  } catch (error) {
    const errMsg = (error as Error).message;
    // If request timed out or was blocked by anti-bot, we treat it as active rather than falsely discarding
    logger.debug('[Verifier] Error checking URL %s: %s', url, errMsg);
    return { isActive: true };
  }
}
