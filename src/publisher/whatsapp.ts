import { chromium, BrowserContext, Page, ElementHandle } from 'playwright';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { backupSessionToCloud, restoreSessionFromCloud } from './session-sync.js';

const getRealisticUserAgent = () => {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
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
      const isHeadless = env.WHATSAPP_HEADLESS;
      context = await chromium.launchPersistentContext(this.sessionDir, {
        headless: isHeadless,
        userAgent: getRealisticUserAgent(),
        viewport: { width: 1280, height: 800 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--disable-blink-features=AutomationControlled',
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
      const cleanGroupName = groupName.replace(/^["']+|["']+$/g, '').trim();
      logger.info('🔍 Finding and opening target chat "%s"...', cleanGroupName);

      // Helper function to find and click matching chat with exact title priority
      const findAndClickChat = async (): Promise<boolean> => {
        try {
          const matchIndex = await page.evaluate((target) => {
            const spans = Array.from(document.querySelectorAll('#pane-side span[title]'));
            const normalized = target.trim().toLowerCase();

            // Pass 1: Exact title match (e.g. "Tech Jobs" === "Tech Jobs")
            for (let i = 0; i < spans.length; i++) {
              const title = (spans[i].getAttribute('title') || '').trim().toLowerCase();
              if (title === normalized) return i;
            }

            // Pass 2: Clean substring match with strict "non-tech" exclusion
            for (let i = 0; i < spans.length; i++) {
              const title = (spans[i].getAttribute('title') || '').trim().toLowerCase();
              // Prevent "Tech Jobs" from ever matching "Non-Tech Jobs"
              if (title.includes('non-tech') && !normalized.includes('non-tech')) {
                continue;
              }
              if (title.includes(normalized)) return i;
            }
            return -1;
          }, cleanGroupName);

          if (matchIndex !== -1) {
            const matchedSpan = page.locator('#pane-side span[title]').nth(matchIndex);
            await matchedSpan.click({ force: true });
            return true;
          }
        } catch { }
        return false;
      };

      // Strategy A: Check if target chat is directly visible in recent chat list
      const openedDirectly = await findAndClickChat();

      if (openedDirectly) {
        logger.info('   Found exact match for "%s" in recent chats. Opened conversation.', cleanGroupName);
      } else {
        // Strategy B: Search for target chat in search bar
        logger.info('   Searching for "%s" in chat search bar...', cleanGroupName);
        const searchInput = page.locator(
          'div[contenteditable="true"][data-tab="3"], #side div[contenteditable="true"], input[aria-label*="Search"]'
        ).first();

        await searchInput.click({ force: true });
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(300);
        await page.keyboard.type(cleanGroupName, { delay: 40 });
        await page.waitForTimeout(2500);

        // Try clicking matched search result item
        const clickedResult = await findAndClickChat();
        if (clickedResult) {
          logger.info('   Clicked matching search result for "%s".', cleanGroupName);
        } else {
          // Keyboard fallback: ArrowDown selects first result from search list, then Enter opens it
          logger.info('   Selecting search result via ArrowDown + Enter...');
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(400);
          await page.keyboard.press('Enter');
        }
      }

      // 3. Confirm Conversation Header is Active
      try {
        await page.waitForSelector('#main header', { timeout: 20000 });
      } catch (err) {
        const visibleChats = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('#pane-side span[title]'))
            .map((el) => el.getAttribute('title'))
            .filter(Boolean);
        });
        logger.error('❌ Could not open chat "%s". Currently visible chats on WhatsApp: %s', cleanGroupName, JSON.stringify(visibleChats));
        throw err;
      }

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
        await page.waitForTimeout(800);

        // Fallback send button click if text still in box
        const checkText = await page.evaluate(() => {
          const box = document.querySelector('#main footer div[contenteditable="true"]');
          return (box?.textContent || '').trim();
        });

        if (checkText.length > 0) {
          logger.info('   Clicking send button explicitly...');
          const sendBtn = await page.$('#main button[data-testid="compose-btn-send"], #main span[data-icon="send"], #main button[aria-label="Send"]');
          if (sendBtn) {
            await sendBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(1000);
          }
        }

        // 5. Wait for delivery confirmation: verify clock icon transitions to checkmark on latest message
        logger.info('⏳ Waiting for WhatsApp server delivery confirmation (clock 🕒 -> checkmark ✔️)...');
        const startConfirm = Date.now();
        let confirmedDelivery = false;

        while (Date.now() - startConfirm < 30000) {
          const lastMsgState = await page.evaluate(() => {
            const outMsgs = document.querySelectorAll('#main div.message-out');
            const lastOut = outMsgs.length > 0 ? outMsgs[outMsgs.length - 1] : document.querySelector('#main div[role="row"]:last-child');
            if (!lastOut) return { hasCheck: false, isPending: true, hasError: false };

            const check = lastOut.querySelector('span[data-icon="msg-check"], span[data-icon="msg-dblcheck"], span[data-icon="status-check"], span[data-icon="status-dblcheck"]');
            const pending = lastOut.querySelector('span[data-icon="msg-time"], span[data-icon="status-time"], span[data-icon="time"]');
            const error = lastOut.querySelector('span[data-icon="msg-error"], span[data-icon="alert-error"], [data-testid="fail-container"]');

            return {
              hasCheck: !!check,
              isPending: !!pending,
              hasError: !!error,
            };
          });

          if (lastMsgState.hasCheck) {
            confirmedDelivery = true;
            logger.info('✅ Confirmed! WhatsApp server acknowledged message delivery (checkmark received).');
            break;
          }

          if (lastMsgState.hasError) {
            logger.warn('⚠️ Last message indicates an error state, attempting retry click...');
            const failBtn = await page.$('#main div.message-out:last-of-type [data-testid="fail-container"], #main div.message-out:last-of-type span[data-icon="msg-error"]');
            if (failBtn) {
              await failBtn.click({ force: true }).catch(() => { });
              await page.waitForTimeout(1000);
              const tryAgainBtn = await page.$('div[role="dialog"] button:has-text("Try again")');
              if (tryAgainBtn) await tryAgainBtn.click({ force: true }).catch(() => { });
            }
          }

          await page.waitForTimeout(1000);
        }

        // Check if compose box was cleared (message entered transmission queue)
        const isBoxCleared = await page.evaluate(() => {
          const box = document.querySelector('#main footer div[contenteditable="true"]');
          return !box || (box.textContent || '').trim() === '';
        });

        if (confirmedDelivery) {
          sentCount++;
          logger.info('🚀 [Alert %d/%d] Successfully posted to WhatsApp (verified checkmark ✔️)!', idx + 1, messages.length);
        } else if (isBoxCleared) {
          sentCount++;
          logger.info('🚀 [Alert %d/%d] Message submitted to WhatsApp pipeline (clock icon queued, syncing to phone)!', idx + 1, messages.length);
        } else {
          logger.error('❌ Message delivery failed: text was not submitted from composer.');
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
