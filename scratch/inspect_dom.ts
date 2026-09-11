import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const sessionDir = path.resolve(process.cwd(), 'data', 'whatsapp_session');
  console.log('Inspecting WhatsApp Web DOM in headless mode...');
  
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });
  
  console.log('Waiting 15s for WhatsApp to settle...');
  await page.waitForTimeout(15000);

  const title = await page.title();
  const url = page.url();
  console.log('Page Title:', title, '| URL:', url);

  const elements = await page.evaluate(() => {
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => ({
      tagName: el.tagName,
      role: el.getAttribute('role'),
      dataTab: el.getAttribute('data-tab'),
      title: el.getAttribute('title'),
      ariaLabel: el.getAttribute('aria-label'),
      className: el.className,
      parentElementTag: el.parentElement?.tagName,
      parentElementId: el.parentElement?.id,
    }));

    const inputs = Array.from(document.querySelectorAll('input, button')).map(el => ({
      tagName: el.tagName,
      type: el.getAttribute('type'),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      dataTestId: el.getAttribute('data-testid'),
    })).filter(x => x.ariaLabel || x.title || x.dataTestId);

    return { editables, inputs: inputs.slice(0, 20) };
  });

  console.log('Found editables:\n', JSON.stringify(elements.editables, null, 2));
  console.log('Found inputs/buttons:\n', JSON.stringify(elements.inputs, null, 2));

  await context.close();
}

main().catch(console.error);
