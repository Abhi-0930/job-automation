import { prisma } from '../src/database/prisma.js';

async function main() {
  const latestLog = await prisma.publishLog.findFirst({
    orderBy: { publishedAt: 'desc' },
  });

  console.log('=== LATEST PUBLISH LOG DETAILS ===');
  console.log('ID:', latestLog?.id);
  console.log('PublishedAt:', latestLog?.publishedAt.toISOString());
  console.log('Group:', latestLog?.groupName);
  console.log('Category:', latestLog?.category);
  console.log('Status:', latestLog?.status);
  console.log('Error:\n', latestLog?.error);

  await prisma.$disconnect();
}

main().catch(console.error);
