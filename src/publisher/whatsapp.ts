import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export class WhatsAppPublisher {
  private sessionDir: string;

  constructor() {
    this.sessionDir = path.resolve(process.cwd(), env.WHATSAPP_SESSION_PATH);
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  /**
   * Interactive Login Tool: Opens headed Chromium for the user to scan WhatsApp QR code once.
   */
  public async interactiveAuth(): Promise<void> {
    logger.info('📱 Launching WhatsApp Web for session authentication...');
    logger.info('👉 Please scan the QR code on your phone when browser opens.');

    const context = await chromium.launchPersistentContext(this.sessionDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

    logger.info('⏳ Waiting for WhatsApp Web session pairing (up to 2 minutes)...');

    try {
      // Wait for either search bar or chat list indicating user is logged in
      await page.waitForSelector('div[contenteditable="true"][data-tab="3"], #side, [aria-label="Chat list"]', {
        timeout: 120000,
      });
      logger.info('🎉 WhatsApp Web authenticated successfully! Session saved to: %s', this.sessionDir);
    } catch (error) {
      logger.error('❌ WhatsApp Web authentication timed out or failed: %s', (error as Error).message);
    } finally {
      await page.waitForTimeout(3000);
      await context.close();
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

    logger.info('📤 Sending WhatsApp message to group: "%s"', groupName);
    let context: BrowserContext | null = null;

    try {
      context = await chromium.launchPersistentContext(this.sessionDir, {
        headless: env.WHATSAPP_HEADLESS,
        viewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      });

      const page = context.pages()[0] || (await context.newPage());
      page.setDefaultTimeout(45000);

      await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

      // 1. Wait for WhatsApp main interface
      const searchBoxSelector = 'div[contenteditable="true"][data-tab="3"], div[title="Search input textbox"]';
      await page.waitForSelector(searchBoxSelector, { timeout: 45000 });
      await page.waitForTimeout(2000);

      // 2. Click Search Box and Type Group Name
      const searchInput = await page.$(searchBoxSelector);
      if (!searchInput) {
        throw new Error('Could not find search input box on WhatsApp Web');
      }

      await searchInput.click();
      await page.waitForTimeout(500);
      await searchInput.fill('');
      await searchInput.type(groupName, { delay: 60 });
      await page.waitForTimeout(2000);

      // 3. Find and click the target group from search results
      // Match element containing exact group name or closest match
      const groupChatSelector = `span[title="${groupName}"], span[title*="${groupName.replace(/[^\w\s]/gi, '').trim()}"]`;
      const groupElement = await page.waitForSelector(groupChatSelector, { timeout: 15000 }).catch(() => null);

      if (!groupElement) {
        // Try selecting top search result
        const topResult = await page.$('#pane-side div[role="listitem"]');
        if (topResult) {
          await topResult.click();
        } else {
          throw new Error(`Group "${groupName}" not found in WhatsApp chat list or search results.`);
        }
      } else {
        await groupElement.click();
      }

      await page.waitForTimeout(1500);

      // 4. Locate message composition box
      const messageBoxSelector = 'footer div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]';
      const messageBox = await page.waitForSelector(messageBoxSelector, { timeout: 15000 });

      if (!messageBox) {
        throw new Error('Message input box not found in active chat');
      }

      await messageBox.click();
      await page.waitForTimeout(500);

      // 5. Send multiline message using Shift+Enter for newlines
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

      await page.waitForTimeout(1000);

      // 6. Press Enter to send
      await page.keyboard.press('Enter');
      logger.info('🚀 Message sent to "%s"', groupName);

      // Pause to allow network delivery
      await page.waitForTimeout(env.WHATSAPP_MESSAGE_DELAY_MS || 3500);

      return { success: true };
    } catch (error) {
      const errMsg = (error as Error).message;
      logger.error('❌ Failed to send WhatsApp message to "%s": %s', groupName, errMsg);
      return { success: false, error: errMsg };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }
}

export const whatsAppPublisher = new WhatsAppPublisher();
