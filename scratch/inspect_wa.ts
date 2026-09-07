import { chromium } from 'playwright';
import path from 'path';

async function inspect() {
  const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com');
  await page.waitForTimeout(8000);

  // Find all editable elements and inputs
  const editables = await page.$$eval('[contenteditable="true"], [role="textbox"], input, button[aria-label]', (els) =>
    els.map((el) => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      title: el.getAttribute('title'),
      ariaLabel: el.getAttribute('aria-label'),
      dataTab: el.getAttribute('data-tab'),
      dataTestId: el.getAttribute('data-testid'),
      className: el.className,
      innerText: (el as HTMLElement).innerText?.slice(0, 30),
    }))
  );

  console.log('Found %d interactive elements:', editables.length);
  console.log(JSON.stringify(editables.slice(0, 15), null, 2));

  await page.screenshot({ path: './data/wa_debug.png' });
  console.log('Saved screenshot to ./data/wa_debug.png');

  await page.waitForTimeout(4000);
  await context.close();
}

inspect().catch(console.error);
