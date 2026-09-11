import axios from 'axios';

async function main() {
  console.log('Waiting for Render deployment to become healthy...');
  const url = 'https://job-automation-1-nhv4.onrender.com/health';
  const start = Date.now();
  
  while (Date.now() - start < 120000) {
    try {
      const res = await axios.get(url, { timeout: 8000 });
      if (res.status === 200 && res.data?.status === 'ok') {
        console.log('✅ Render is LIVE & HEALTHY:', JSON.stringify(res.data));
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
