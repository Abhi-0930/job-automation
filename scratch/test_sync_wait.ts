import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
  console.log('Testing authenticated session with full sync wait...');

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

  console.log('Waiting for "Your messages are downloading" / progress bar to finish...');
  const syncSelector = 'progress, [role="progressbar"], div:has-text("Your messages are downloading"), div:has-text("Loading your chats"), div:has-text("Downloading messages")';
  
  await page.waitForSelector(syncSelector, { state: 'detached', timeout: 120000 }).catch((e) => {
    console.log('Sync wait note:', e.message);
  });

  await page.waitForTimeout(3000);

  const title = await page.title();
  const text = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log('Page Title:', title);
  console.log('Page Text Sample:\n', text.replace(/\n+/g, ' '));

  // Check search bar
  const searchBar = await page.$('#side div[contenteditable="true"], [aria-label*="Search"], div[data-testid="chat-list-search"]');
  console.log('Is Search Bar Found?:', !!searchBar);

  await context.close();
}

main().catch(console.error);
