import axios from 'axios';

async function main() {
  console.log('--- STREAMING LIVE RENDER LOGS ---');
  let lastSeenIndex = 0;
  const start = Date.now();

  while (Date.now() - start < 90000) {
    try {
      const res = await axios.get('https://job-automation-1-nhv4.onrender.com/logs', { timeout: 8000 });
      if (res.status === 200 && Array.isArray(res.data?.lines)) {
        const lines: string[] = res.data.lines;
        if (lines.length > lastSeenIndex) {
          for (let i = lastSeenIndex; i < lines.length; i++) {
            try {
              const obj = JSON.parse(lines[i]);
              console.log(`[${obj.timestamp}] ${obj.level.toUpperCase()}: ${obj.message}`);
            } catch {
              console.log(lines[i]);
            }
          }
          lastSeenIndex = lines.length;
        }
      }
    } catch (err) {
      console.log(`[Waiting for logs...] ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

main().catch(console.error);
