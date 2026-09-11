import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
  console.log('Testing local session at:', sessionDir);

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const title = await page.title();
  const text = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log('Page Title:', title);
  console.log('Page Text Sample:\n', text.replace(/\n+/g, ' '));

  const hasQr = text.includes('Scan to log in') || text.includes('Scan the QR code') || (await page.$('canvas'));
  console.log('Is QR / Login Screen Visible?', !!hasQr);

  const hasChatList = await page.$('#side, #pane-side, [aria-label="Chat list"], div[data-testid="chat-list"]');
  console.log('Is Chat List Visible?', !!hasChatList);

  await context.close();
}

main().catch(console.error);
