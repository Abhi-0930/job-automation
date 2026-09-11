import axios from 'axios';

async function main() {
  console.log('Waiting for new commit deployment with /logs endpoint...');
  const url = 'https://job-automation-1-nhv4.onrender.com/logs';
  const start = Date.now();
  
  while (Date.now() - start < 120000) {
    try {
      const res = await axios.get(url, { timeout: 8000 });
      if (res.status === 200 && Array.isArray(res.data?.lines)) {
        console.log('✅ New commit deployed! Latest Render logs count:', res.data.lines.length);
        console.log('Recent 10 log lines:');
        console.log(res.data.lines.slice(-10).join('\n'));
        return;
      }
    } catch (err) {
      console.log(`[${Math.round((Date.now() - start) / 1000)}s] Waiting for deployment... (${(err as Error).message})`);
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
  console.log('Timeout waiting for deployment.');
}

main().catch(console.error);
