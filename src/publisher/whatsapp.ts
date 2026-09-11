import { chromium, BrowserContext, Page, ElementHandle } from 'playwright';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { backupSessionToCloud, restoreSessionFromCloud } from './session-sync.js';

const getRealisticUserAgent = () => {
  if (process.platform === 'linux') {
    return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  }
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
};

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
      const lockFiles = [
        'SingletonLock',
        'SingletonCookie',
        'SingletonSocket',
        'lockfile',
      ];
      for (const file of lockFiles) {
        const filePath = path.join(this.sessionDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Ignore lock clean failures
    }
  }

  /**
   * Interactive Login Tool: Opens headed Chromium for the user to scan WhatsApp QR code once.
   */
  public async interactiveAuth(): Promise<void> {
    this.cleanStaleLocks();
    logger.info('📱 Launching browser for WhatsApp Web authentication...');
    logger.info('👉 Please scan the QR code on your phone when the browser window opens.');

    const context = await chromium.launchPersistentContext(this.sessionDir, {
      headless: false,
      userAgent: getRealisticUserAgent(),
      viewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(120000);

    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });
    logger.info('⏳ Waiting for WhatsApp Web pairing (up to 2 minutes)...');

    try {
      await page.waitForSelector(
        '#side, #pane-side, input[data-tab="3"], input[aria-label*="Search"], [aria-label="Chat list"]',
        { timeout: 120000 }
      );
      await page.waitForTimeout(4000);

      logger.info('🎉 WhatsApp Web authenticated successfully! Session saved to: %s', this.sessionDir);
    } catch (error) {
      logger.error('❌ WhatsApp Web authentication timed out or failed: %s', (error as Error).message);
    } finally {
      await page.waitForTimeout(2000);
      await context.close().catch(() => { });
      // Auto-sync session to cloud database after browser is closed and file locks are released
      await backupSessionToCloud().catch(() => { });
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
      const isHeadless = process.platform === 'linux' ? true : env.WHATSAPP_HEADLESS;
      context = await chromium.launchPersistentContext(this.sessionDir, {
        headless: isHeadless,
        userAgent: getRealisticUserAgent(),
        viewport: { width: 1280, height: 800 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-breakpad',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
          '--force-color-profile=srgb',
          '--metrics-recording-only',
          '--no-first-run',
          '--disable-blink-features=AutomationControlled',
          '--js-flags=--max-old-space-size=256',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });

      page = context.pages()[0] || (await context.newPage());
      page.setDefaultTimeout(90000);

      await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

      // 1. Wait for initial splash screen to clear
      logger.info('⏳ Waiting for WhatsApp Web interface initialization...');
      await page.waitForSelector('#app', { timeout: 45000 }).catch(() => { });

      // 1b. Check if logged out or QR code is shown (session expired)
      await page.waitForTimeout(3000);
      if (page.url().includes('post_logout=1')) {
        throw new Error(
          'WhatsApp session was logged out (?post_logout=1). Please re-authenticate locally using `npm run auth:whatsapp` and sync to cloud using `npm run session:push`.'
        );
      }

      const qrSelector = 'canvas[aria-label="Scan this QR code to link a device"], div[data-ref], [data-testid="qrcode"]';
      const isQrVisible = await page.waitForSelector(qrSelector, { timeout: 3000 }).catch(() => null);
      if (isQrVisible) {
        throw new Error(
          'WhatsApp session has expired or is not logged in. Please run `npm run auth:whatsapp` locally to rescan QR code, then `npm run session:push`.'
        );
      }

      // 1c. Bypass any "Download WhatsApp for Windows / Mac" promo screens or landing dialogs
      try {
        const promoBypassSelectors = [
          'a:has-text("Use WhatsApp Web")',
          'a:has-text("use WhatsApp in your browser")',
          'a:has-text("Continue on Web")',
          'a:has-text("Continue in browser")',
          'a:has-text("Use in browser")',
          'button:has-text("Use Here")',
          'button:has-text("Continue on this browser")',
          'div[role="button"]:has-text("Use Web")',
          'span:has-text("Use WhatsApp Web")',
        ];
        for (const selector of promoBypassSelectors) {
          const el = await page.$(selector);
          if (el && (await el.isVisible().catch(() => false))) {
            logger.info('👋 Bypassing WhatsApp promo banner via "%s"...', selector);
            await el.click({ force: true }).catch(() => { });
            await page.waitForTimeout(1500);
            break;
          }
        }
      } catch {
        // Non-blocking
      }

      // 2. Wait for chat synchronization screen to finish ("Loading your chats", "Connecting", progress bars)
      logger.info('⏳ Checking for WhatsApp chat synchronization progress...');
      const syncSelectors = [
        'progress',
        '[role="progressbar"]',
        'div:has-text("Loading your chats")',
        'span:has-text("Loading your chats")',
        'div:has-text("Connecting")',
        'div:has-text("Downloading messages")',
      ];

      const syncElement = await page.waitForSelector(syncSelectors.join(', '), { timeout: 8000 }).catch(() => null);
      if (syncElement) {
        logger.info('🔄 WhatsApp is synchronizing chats with your phone. Waiting for sync to complete (up to 3 min)...');
        await page.waitForSelector(syncSelectors.join(', '), { state: 'detached', timeout: 180000 }).catch(() => {
          logger.warn('⚠️ Sync indicator took long, continuing with UI detection...');
        });
        await page.waitForTimeout(3000);
      }

      // 2b. Auto-dismiss modal dialogs / alerts
      try {
        const modalBtn = await page.$(
          'div[role="dialog"] button:has-text("Continue"), div[role="dialog"] button:has-text("OK"), div[role="dialog"] button:has-text("Dismiss"), div[role="dialog"] [data-icon="x"], div[role="dialog"] [aria-label="Close"], button:has-text("Use Here")'
        );
        if (modalBtn) {
          logger.info('👋 Dismissing WhatsApp Web modal dialog...');
          await modalBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(1000);
        }
      } catch {
        // Modal check non-blocking
      }
      await page.keyboard.press('Escape').catch(() => { });
      await page.waitForTimeout(500);

      // 3. Locate and activate Search Bar
      logger.info('⏳ Locating WhatsApp search bar for group "%s"...', groupName);

      const searchBoxSelectors = [
        'input[aria-label*="Search"]',
        'input[type="text"][aria-label*="Search"]',
        '#side input[type="text"]',
        '#side input',
        'input[data-tab="3"]',
        '#side div[contenteditable="true"]',
        '#side div[role="textbox"]',
        '#side input[role="textbox"]',
        'div[contenteditable="true"][data-tab="3"]',
        'div[title="Search input textbox"]',
        'div[data-testid="chat-list-search"]',
        'div[aria-label*="Search"]',
        '[aria-label*="Search or start new chat"]',
        '[aria-label*="Search or start a new chat"]',
        'div[role="textbox"][title*="Search"]',
        '#pane-side div[contenteditable="true"]',
      ];

      let searchInput: ElementHandle<SVGElement | HTMLElement> | null = null;
      for (let attempt = 1; attempt <= 15; attempt++) {
        searchInput = await page.waitForSelector(searchBoxSelectors.join(', '), { timeout: 4000 }).catch(() => null);
        if (searchInput) break;

        logger.info('   ...waiting for chat list search box (attempt %d/15)...', attempt);

        // Try clicking search button if search input isn't visible yet
        const searchBtn = await page.$('button[aria-label*="Search"], [data-icon="search"], div[data-testid="chat-list-search"]');
        if (searchBtn) {
          await searchBtn.click({ force: true }).catch(() => { });
        }
        await page.waitForTimeout(1000);
      }

      if (!searchInput) {
        const url = page.url();
        const title = await page.title().catch(() => 'unknown');
        const bodySnippet = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => 'unavailable');
        throw new Error(
          `Could not find search input box on WhatsApp Web (URL: "${url}", Title: "${title}", Visible Text: "${bodySnippet.replace(/\n+/g, ' ')}"). Chats may still be synchronizing.`
        );
      }

      // 4. Type Group Name into Search Box
      await searchInput.click({ force: true });
      await page.waitForTimeout(400);
      try {
        await searchInput.fill('');
      } catch {
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
      }
      await page.keyboard.type(groupName, { delay: 60 });
      await page.waitForTimeout(3000);

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
      await page.waitForTimeout(600);

      const sendBtn = await page.waitForSelector('button[data-testid="compose-btn-send"], span[data-icon="send"], button[aria-label="Send"]', { timeout: 2000 }).catch(() => null);
      if (sendBtn) {
        await sendBtn.click({ force: true }).catch(() => { });
      }

      // 9. Wait for WhatsApp to transition from Pending (clock icon) to Sent (checkmark)
      logger.info('⏳ Waiting for WhatsApp server delivery confirmation (clock 🕒 -> checkmark ✔️)...');
      const startTime = Date.now();
      const maxWaitMs = 30000;
      let confirmed = false;

      while (Date.now() - startTime < maxWaitMs) {
        // If send button is still visible, message may still be in input box, retry enter/click
        const lingeringSendBtn = await page.$('button[data-testid="compose-btn-send"], span[data-icon="send"]');
        if (lingeringSendBtn) {
          await lingeringSendBtn.click({ force: true }).catch(() => { });
          await page.keyboard.press('Enter').catch(() => { });
        }

        const deliveryStatus = await page.evaluate(() => {
          const checkIcons = document.querySelectorAll(
            'span[data-icon="msg-check"], span[data-icon="msg-dblcheck"], span[data-icon="msg-dblcheck-ack"], span[data-icon="status-check"], span[data-icon="status-dblcheck"]'
          );
          const pendingIcons = document.querySelectorAll(
            'span[data-icon="msg-time"], span[data-icon="status-time"], span[data-icon="time"], span[aria-label*="Pending"], span[aria-label*="pending"]'
          );

          return {
            hasChecks: checkIcons.length > 0,
            hasPending: pendingIcons.length > 0,
          };
        });

        if (deliveryStatus.hasChecks && !deliveryStatus.hasPending) {
          confirmed = true;
          logger.info('✅ Confirmed! WhatsApp server acknowledged message delivery (checkmark received).');
          break;
        }

        // If no pending clock icons remain after initial wait
        if (!deliveryStatus.hasPending && (Date.now() - startTime) > 4000) {
          confirmed = true;
          logger.info('✅ Message dispatched without pending status.');
          break;
        }

        await page.waitForTimeout(1000);
      }

      if (!confirmed) {
        logger.warn('⚠️ Pending clock icon took longer than usual. Allowing extra buffer for socket sync...');
      }

      // Safety buffer: keep the browser open long enough so WhatsApp Web WebSocket and IndexedDB flush completely
      const finalDelay = Math.max(env.WHATSAPP_MESSAGE_DELAY_MS || 5000, 6000);
      logger.info('⏱️ Finalizing message transmission buffer (%ds)...', Math.round(finalDelay / 1000));
      await page.waitForTimeout(finalDelay);

      logger.info('🚀 Message successfully posted to "%s"!', groupName);

      return { success: true };
    } catch (error) {
      const errMsg = (error as Error).message;
      logger.error('❌ Failed to send WhatsApp message to "%s": %s', groupName, errMsg);

      if (page) {
        await page.screenshot({ path: './data/wa_error.png' }).catch(() => { });
        logger.info('📸 Saved error screenshot to ./data/wa_error.png');
      }

      return { success: false, error: errMsg };
    } finally {
      if (context) {
        await context.close().catch(() => { });
      }
    }
  }
}

export const whatsAppPublisher = new WhatsAppPublisher();
