import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
  console.log('Testing session sync wait on:', sessionDir);

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

  console.log('Waiting for WhatsApp Web to load...');

  // Poll state every 3 seconds for up to 2 minutes
  const startTime = Date.now();
  while (Date.now() - startTime < 120000) {
    const title = await page.title();
    const text = await page.evaluate(() => document.body.innerText.slice(0, 300));
    console.log(`[${Math.round((Date.now() - startTime)/1000)}s] Title: "${title}" | Snippet: "${text.replace(/\n+/g, ' ')}"`);

    const hasSearch = await page.$('#side div[contenteditable="true"], #side input, [aria-label="Search or start new chat"], [aria-label*="Search"], #side');
    if (hasSearch) {
      console.log('🎉 Found Search / Side Pane! WhatsApp Web is fully loaded!');
      break;
    }

    await page.waitForTimeout(4000);
  }

  // Keep open 10 seconds to let IndexedDB persist everything
  console.log('Waiting 10s to ensure IndexedDB syncs all chats to disk...');
  await page.waitForTimeout(10000);

  await context.close();
  console.log('Browser closed cleanly.');
}

main().catch(console.error);
