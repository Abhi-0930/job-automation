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

      // Also clean any LevelDB LOCK files recursively
      const cleanLocksRecursively = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            cleanLocksRecursively(fullPath);
          } else if (entry.name === 'LOCK' || entry.name.endsWith('.lock')) {
            try { fs.unlinkSync(fullPath); } catch { }
          }
        }
      };
      cleanLocksRecursively(this.sessionDir);
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
      await backupSessionToCloud().catch(() => { });
    }
  }

  /**
   * Sends a single message to a specific WhatsApp group by name.
   */
  public async sendMessage(groupName: string, message: string): Promise<{ success: boolean; error?: string }> {
    const res = await this.sendBatchMessages(groupName, [message]);
    return { success: res.success, error: res.error };
  }

  /**
   * Sends multiple messages sequentially within a single browser session to a WhatsApp group.
   */
  public async sendBatchMessages(
    groupName: string,
    messages: string[]
  ): Promise<{ success: boolean; sent: number; total: number; error?: string }> {
    if (!messages || messages.length === 0) {
      return { success: true, sent: 0, total: 0 };
    }

    if (env.DRY_RUN) {
      logger.info('🧪 [DRY_RUN] Simulating WhatsApp batch (%d messages) to "%s"', messages.length, groupName);
      messages.forEach((msg, idx) => {
        logger.info('--- Preview Message %d/%d ---\n%s\n', idx + 1, messages.length, msg);
      });
      return { success: true, sent: messages.length, total: messages.length };
    }

    this.cleanStaleLocks();
    await restoreSessionFromCloud();

    logger.info('📤 Starting WhatsApp batch dispatch of %d message(s) to group: "%s"', messages.length, groupName);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let sentCount = 0;

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

      // 1. Wait until WhatsApp Web clears splash and loads #side, or catches logout/QR
      logger.info('⏳ Waiting for WhatsApp Web chat panel (#side) to initialize...');
      const readySelector = await Promise.race([
        page.waitForSelector('#side, #pane-side', { timeout: 60000 }).then(() => 'ready'),
        page.waitForSelector('canvas[aria-label*="Scan"], div[data-ref]', { timeout: 60000 }).then(() => 'qr'),
        page.waitForURL((url) => url.href.includes('post_logout=1'), { timeout: 60000 }).then(() => 'logged_out'),
      ]).catch(() => 'timeout');

      if (readySelector === 'logged_out' || page.url().includes('post_logout=1')) {
        throw new Error(
          'WhatsApp session was logged out (?post_logout=1). Please re-authenticate locally using `npm run auth:whatsapp`.'
        );
      }

      if (readySelector === 'qr') {
        throw new Error(
          'WhatsApp session expired or requires QR scan. Please re-authenticate locally using `npm run auth:whatsapp`.'
        );
      }

      if (readySelector === 'timeout') {
        throw new Error('Timeout waiting for WhatsApp Web to load #side panel.');
      }

      await page.waitForTimeout(2000);

      // 1c. Bypass any promo dialogs
      try {
        const modalBtn = await page.$(
          'div[role="dialog"] button:has-text("Continue"), div[role="dialog"] button:has-text("OK"), div[role="dialog"] button:has-text("Dismiss"), button:has-text("Use Here")'
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

      // 2. Open Target Chat
      logger.info('🔍 Finding and opening target chat "%s"...', groupName);

      // Strategy A: Check if target chat is directly visible in recent chat list
      const chatSpan = page.locator('#pane-side span[title]').filter({ hasText: groupName }).first();
      const isDirectlyVisible = await chatSpan.isVisible({ timeout: 2000 }).catch(() => false);

      if (isDirectlyVisible) {
        logger.info('   Found "%s" in recent chats. Clicking to open conversation...', groupName);
        await chatSpan.click({ force: true });
      } else {
        // Strategy B: Search for target chat in search bar
        logger.info('   Searching for "%s" in chat search bar...', groupName);
        const searchInput = page.locator(
          'div[contenteditable="true"][data-tab="3"], #side div[contenteditable="true"], input[aria-label*="Search"]'
        ).first();

        await searchInput.click({ force: true });
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(groupName, { delay: 40 });
        await page.waitForTimeout(2000);

        const searchMatch = page.locator('#pane-side span[title]').filter({ hasText: groupName }).first();
        if (await searchMatch.isVisible({ timeout: 4000 }).catch(() => false)) {
          await searchMatch.click({ force: true });
        } else {
          // Fallback: press Enter on active search input
          await page.keyboard.press('Enter');
        }
      }

      // 3. Confirm Conversation Header is Active
      await page.waitForSelector('#main header', { timeout: 15000 });
      const openHeaderTitle = await page.evaluate(() => {
        return document.querySelector('#main header span[title]')?.getAttribute('title') || 'Active Chat';
      });
      logger.info('✅ Confirmed conversation view is active: "%s"', openHeaderTitle);

      // 4. Send each message inside #main footer
      for (let idx = 0; idx < messages.length; idx++) {
        const message = messages[idx];
        logger.info('📨 [Alert %d/%d] Composing message for "%s"...', idx + 1, messages.length, groupName);

        const messageBox = await page.waitForSelector(
          '#main footer div[contenteditable="true"], #main footer div[role="textbox"]',
          { timeout: 15000 }
        );

        if (!messageBox) {
          throw new Error(`Message composition box not found in conversation for "${groupName}".`);
        }

        await messageBox.click({ force: true });
        await page.waitForTimeout(300);

        // Insert message lines preserving formatting
        const lines = message.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length > 0) {
            await page.keyboard.insertText(lines[i]);
          }
          if (i < lines.length - 1) {
            await page.keyboard.down('Shift');
            await page.keyboard.press('Enter');
            await page.keyboard.up('Shift');
          }
        }

        // Wait for WhatsApp link preview generation if URL is present
        if (message.includes('http://') || message.includes('https://')) {
          await page.waitForTimeout(1500);
        } else {
          await page.waitForTimeout(500);
        }

        // Send via Enter key
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        // Fallback send button click
        const sendBtn = await page.$('#main button[data-testid="compose-btn-send"], #main span[data-icon="send"]');
        if (sendBtn) {
          await sendBtn.click({ force: true }).catch(() => { });
        }

        // 5. Wait for delivery confirmation: verify clock icon transitions to checkmark
        logger.info('⏳ Waiting for WhatsApp server delivery confirmation (clock 🕒 -> checkmark ✔️)...');
        const startConfirm = Date.now();
        let confirmedDelivery = false;

        while (Date.now() - startConfirm < 25000) {
          const status = await page.evaluate(() => {
            const main = document.querySelector('#main');
            if (!main) return { pending: 1, checks: 0, error: 0 };
            const pendingIcons = main.querySelectorAll(
              'span[data-icon="msg-time"], span[data-icon="status-time"], span[data-icon="time"], span[aria-label*="Pending"], span[aria-label*="pending"]'
            );
            const checkIcons = main.querySelectorAll(
              'span[data-icon="msg-check"], span[data-icon="msg-dblcheck"], span[data-icon="status-check"], span[data-icon="status-dblcheck"]'
            );
            const errorIcons = main.querySelectorAll(
              'span[data-icon="msg-error"], span[data-icon="alert-error"], [data-testid="fail-container"], [aria-label*="Something went wrong"]'
            );
            return {
              pending: pendingIcons.length,
              checks: checkIcons.length,
              error: errorIcons.length,
            };
          });

          // If there's an error icon, click it and trigger Retry in modal
          if (status.error > 0) {
            const failBtn = await page.$(
              '[data-testid="fail-container"] div[role="button"], span[data-icon="msg-error"], span[data-icon="alert-error"], [data-testid="fail-container"]'
            );
            if (failBtn) {
              logger.warn('⚠️ Detected message error icon, clicking to retry...');
              await failBtn.click({ force: true }).catch(() => { });
              await page.waitForTimeout(1000);
              const tryAgainBtn = await page.$(
                'div[role="dialog"] button:has-text("Try again"), div[role="dialog"] [role="button"]:has-text("Try again")'
              );
              if (tryAgainBtn) {
                await tryAgainBtn.click({ force: true }).catch(() => { });
              }
            }
          }

          if (status.checks > 0 && status.pending === 0 && status.error === 0) {
            confirmedDelivery = true;
            logger.info('✅ Confirmed! WhatsApp server acknowledged message delivery (checkmark received).');
            break;
          }

          await page.waitForTimeout(1000);
        }

        if (!confirmedDelivery) {
          logger.error('❌ Message delivery was not confirmed by WhatsApp server (remained in pending or error state). Please ensure your phone is online and synced.');
        } else {
          sentCount++;
          logger.info('🚀 [Alert %d/%d] Successfully posted to WhatsApp!', idx + 1, messages.length);
        }

        // Pacing delay between batch messages to prevent WhatsApp anti-spam flags
        if (idx < messages.length - 1) {
          const pacingDelay = Math.max(env.WHATSAPP_MESSAGE_DELAY_MS || 3500, 3500);
          logger.info('⏳ Pacing delay (%dms) before next message...', pacingDelay);
          await page.waitForTimeout(pacingDelay);
        }
      }

      // Final safety buffer before closing browser context
      const finalDelay = Math.max(env.WHATSAPP_MESSAGE_DELAY_MS || 5000, 6000);
      logger.info('⏱️ Finalizing batch transmission buffer (%ds)...', Math.round(finalDelay / 1000));
      await page.waitForTimeout(finalDelay);

      logger.info('🎉 Successfully finished sending %d message(s) to "%s"!', sentCount, groupName);
      return { success: true, sent: sentCount, total: messages.length };
    } catch (error) {
      const errMsg = (error as Error).message;
      logger.error('❌ Failed to send WhatsApp message to "%s": %s', groupName, errMsg);

      if (page) {
        await page.screenshot({ path: './data/wa_error.png' }).catch(() => { });
        logger.info('📸 Saved error screenshot to ./data/wa_error.png');
      }

      return { success: false, sent: sentCount, total: messages.length, error: errMsg };
    } finally {
      if (context) {
        await context.close().catch(() => { });
      }
    }
  }
}

export const whatsAppPublisher = new WhatsAppPublisher();
