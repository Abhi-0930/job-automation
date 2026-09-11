import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const sessionDir = path.resolve(process.cwd(), 'data', 'whatsapp_session');
  console.log('Testing clean search and select in headless mode...');
  
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });
  
  const groupName = 'Tech Jobs';

  // 1. Wait for search input
  const searchInput = await page.waitForSelector('input[aria-label*="Search"], input[type="text"]', { timeout: 30000 });
  console.log('✅ Found search input:', !!searchInput);

  if (searchInput) {
    await searchInput.click();
    await searchInput.fill('');
    await page.keyboard.type(groupName, { delay: 50 });
    console.log(`Typed "${groupName}" into search input`);

    await page.waitForTimeout(2000);

    // Look for group in results
    const groupElement = await page.waitForSelector(`span[title="${groupName}"], span:has-text("${groupName}")`, { timeout: 10000 }).catch(() => null);
    console.log('Found group element in search results:', !!groupElement);
    if (groupElement) {
      await groupElement.click();
      console.log('Clicked group!');
      await page.waitForTimeout(2000);

      // Check if compose box appeared
      const composeBox = await page.waitForSelector('footer div[contenteditable="true"], div[data-tab="10"], div[data-tab="6"], div[role="textbox"]', { timeout: 10000 }).catch(() => null);
      console.log('✅ Found compose box:', !!composeBox);
    }
  }

  await context.close();
}

main().catch(console.error);
