import { prisma } from '../src/database/prisma.js';

async function main() {
  console.log('Waiting for Render background publish to finish (polling for 60s)...');
  const startTime = Date.now();
  
  while (Date.now() - startTime < 60000) {
    const latest = await prisma.publishLog.findFirst({
      orderBy: { publishedAt: 'desc' },
      include: { job: true },
    });

    if (latest && latest.publishedAt.getTime() > startTime - 120000) {
      console.log('🎉 PUBLISH EVENT LOGGED BY RENDER:');
      console.log('ID:', latest.id);
      console.log('Status:', latest.status);
      console.log('Category:', latest.category);
      console.log('Group:', latest.groupName);
      console.log('Job:', latest.job?.title, 'at', latest.job?.company);
      console.log('PublishedAt (UTC):', latest.publishedAt.toISOString());
      console.log('PublishedAt (IST):', latest.publishedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
      console.log('Error (if any):', latest.error || 'NONE (100% SUCCESS)');
      await prisma.$disconnect();
      return;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  console.log('Polling finished.');
  await prisma.$disconnect();
}

main().catch(console.error);
