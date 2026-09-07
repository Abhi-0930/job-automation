import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { backupSessionToCloud, restoreSessionFromCloud } from './session-sync.js';

const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export class WhatsAppPublisher {
  private sessionDir: string;

  constructor() {
    this.sessionDir = path.resolve(process.cwd(), env.WHATSAPP_SESSION_PATH);
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /**
   * Cleans stale singleton lock files that might prevent Chromium from starting.
   */
  private cleanStaleLocks(): void {
    try {
      const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
      for (const file of lockFiles) {
        const lockPath = path.join(this.sessionDir, file);
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
          logger.debug('Removed stale lock: %s', lockPath);
        }
      }
    } catch {
      // ignore lock cleanup errors
    }
  }

  /**
   * Interactive Login Tool: Opens headed Chromium for the user to scan WhatsApp QR code once.
   */
  public async interactiveAuth(): Promise<void> {
    this.cleanStaleLocks();
    logger.info('📱 Launching WhatsApp Web for session authentication...');
    logger.info('👉 Please scan the QR code on your phone when the browser window opens.');

    const context = await chromium.launchPersistentContext(this.sessionDir, {
      headless: false,
      userAgent: REALISTIC_USER_AGENT,
      viewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(60000);

    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });
    logger.info('⏳ Waiting for WhatsApp Web pairing (up to 2 minutes)...');

    try {
      await page.waitForSelector(
        '#side, #pane-side, input[data-tab="3"], input[aria-label*="Search"], [aria-label="Chat list"]',
        { timeout: 120000 }
      );
      await page.waitForTimeout(4000);

      logger.info('🎉 WhatsApp Web authenticated successfully! Session saved to: %s', this.sessionDir);

      // Auto-sync session to cloud database for Render / VPS deployments
      await backupSessionToCloud();
    } catch (error) {
      logger.error('❌ WhatsApp Web authentication timed out or failed: %s', (error as Error).message);
    } finally {
      await page.waitForTimeout(2000);
      await context.close().catch(() => {});
    }
  }

  /**
   * Sends a message to a specific WhatsApp group by name.
   */
  public async sendMessage(groupName: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (env.DRY_RUN) {
      logger.info('🧪 [DRY_RUN] Simulating WhatsApp post to "%s":\n%s', groupName, message);
      return { success: true };
    }

    this.cleanStaleLocks();

    // Auto-restore session from cloud if running in clean container
    await restoreSessionFromCloud();

    logger.info('📤 Sending WhatsApp message to group: "%s"', groupName);
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await chromium.launchPersistentContext(this.sessionDir, {
        headless: env.WHATSAPP_HEADLESS,
        userAgent: REALISTIC_USER_AGENT,
        viewport: { width: 1280, height: 800 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      page = context.pages()[0] || (await context.newPage());
      page.setDefaultTimeout(60000);

      await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

      // 1. Check if QR code is shown (session expired)
      const qrSelector = 'canvas[aria-label="Scan this QR code to link a device"], div[data-ref], [data-testid="qrcode"]';
      const isQrVisible = await page.waitForSelector(qrSelector, { timeout: 6000 }).catch(() => null);

      if (isQrVisible) {
        throw new Error(
          'WhatsApp session has expired or is not logged in. Please run `npm run auth:whatsapp` to rescan QR code.'
        );
      }

      // 2. Wait for WhatsApp main interface to be ready
      logger.info('⏳ Waiting for WhatsApp Web interface to load...');
      const mainInterfaceSelectors = [
        '#side',
        '#pane-side',
        'div[data-tab="3"]',
        'input[data-tab="3"]',
        'div[role="textbox"]',
        'input[role="textbox"]',
        'div[role="dialog"]',
      ];
      await page.waitForSelector(mainInterfaceSelectors.join(', '), { timeout: 45000 });
      await page.waitForTimeout(2000);

      // 2b. Auto-dismiss any "What's new" or introductory modal dialogs
      try {
        const modalBtn = await page.$(
          'div[role="dialog"] button:has-text("Continue"), div[role="dialog"] button:has-text("OK"), div[role="dialog"] button:has-text("Dismiss"), div[role="dialog"] [data-icon="x"], div[role="dialog"] [aria-label="Close"]'
        );
        if (modalBtn) {
          logger.info('👋 Dismissing WhatsApp Web modal dialog...');
          await modalBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1000);
        }
      } catch {
        // Modal check is non-blocking
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);

      // 3. Locate Search Box using broad multi-selector
      const searchBoxSelectors = [
        '#side div[role="textbox"]',
        '#side input[role="textbox"]',
        'div[contenteditable="true"][data-tab="3"]',
        'input[data-tab="3"]',
        'div[title="Search input textbox"]',
        'div[data-testid="chat-list-search"]',
        'input[aria-label*="Search"]',
        'div[aria-label*="Search"]',
        '[aria-label*="Search or start a new chat"]',
        '[aria-label*="Search"]',
        '#side input',
      ];

      const searchInput = await page.waitForSelector(searchBoxSelectors.join(', '), { timeout: 25000 }).catch(() => null);

      if (!searchInput) {
        throw new Error('Could not find search input box on WhatsApp Web.');
      }

      // 4. Click Search Box and Type Group Name
      await searchInput.click({ force: true });
      await page.waitForTimeout(400);
      try {
        await searchInput.fill('');
      } catch {
        // Fallback for contenteditable divs
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
      }
      await page.keyboard.type(groupName, { delay: 50 });
      await page.waitForTimeout(2500);

      // 5. Locate and click target group from search results
      const sanitizedName = groupName.replace(/[^\w\s]/gi, '').trim();
      let clickedGroup = false;

      // Strategy A: Exact title match in span
      const exactTitleElement = await page.waitForSelector(`span[title="${groupName}"]`, { timeout: 4000 }).catch(() => null);
      if (exactTitleElement) {
        await exactTitleElement.click({ force: true });
        clickedGroup = true;
      }

      // Strategy B: Listitem containing group name
      if (!clickedGroup) {
        const itemLocator = page.locator(`div[role="listitem"]:has-text("${groupName}"), div[data-testid="cell-frame-container"]:has-text("${groupName}")`).first();
        if (await itemLocator.isVisible({ timeout: 3000 }).catch(() => false)) {
          await itemLocator.click({ force: true });
          clickedGroup = true;
        }
      }

      // Strategy C: Partial name match
      if (!clickedGroup && sanitizedName.length > 0) {
        const partialLocator = page.locator(`span[title*="${sanitizedName}"], span:has-text("${sanitizedName}")`).first();
        if (await partialLocator.isVisible({ timeout: 3000 }).catch(() => false)) {
          await partialLocator.click({ force: true });
          clickedGroup = true;
        }
      }

      // Strategy D: Enter key on active search input (WhatsApp Web auto-opens first search match on Enter)
      if (!clickedGroup) {
        logger.info('Pressing Enter to select first search result for "%s"...', groupName);
        await page.keyboard.press('Enter');
        clickedGroup = true;
      }

      await page.waitForTimeout(2000);

      // 6. Locate Message Composition Box
      const messageBoxSelectors = [
        'footer div[contenteditable="true"]',
        'footer div[role="textbox"]',
        'footer div[data-tab="10"]',
        'footer div[data-tab="6"]',
        'div[data-testid="conversation-compose-box-input"]',
        'footer [aria-label*="Type a message"]',
        'footer [aria-placeholder*="Type a message"]',
        'div[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"]',
      ];

      const messageBox = await page.waitForSelector(messageBoxSelectors.join(', '), { timeout: 15000 }).catch(() => null);

      if (!messageBox) {
        throw new Error(`Message input box not found for group "${groupName}". Make sure you are a member of this group.`);
      }

      await messageBox.click({ force: true });
      await page.waitForTimeout(400);

      // 7. Insert message lines preserving formatting (Shift+Enter for line breaks)
      const lines = message.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 0) {
          await page.keyboard.insertText(line);
        }
        if (i < lines.length - 1) {
          await page.keyboard.down('Shift');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Shift');
        }
      }

      await page.waitForTimeout(800);

      // 8. Send message via Enter key and fallback Send button
      await page.keyboard.press('Enter');

      const sendBtn = await page.waitForSelector('button[data-testid="compose-btn-send"], span[data-icon="send"], button[aria-label="Send"]', { timeout: 1500 }).catch(() => null);
      if (sendBtn) {
        await sendBtn.click({ force: true }).catch(() => {});
      }

      logger.info('🚀 Message successfully posted to "%s"!', groupName);

      // Pause to ensure WhatsApp server receives the message before closing browser
      await page.waitForTimeout(env.WHATSAPP_MESSAGE_DELAY_MS || 3500);

      return { success: true };
    } catch (error) {
      const errMsg = (error as Error).message;
      logger.error('❌ Failed to send WhatsApp message to "%s": %s', groupName, errMsg);

      if (page) {
        await page.screenshot({ path: './data/wa_error.png' }).catch(() => {});
        logger.info('📸 Saved error screenshot to ./data/wa_error.png');
      }

      return { success: false, error: errMsg };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }
}

export const whatsAppPublisher = new WhatsAppPublisher();
