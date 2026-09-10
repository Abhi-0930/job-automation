import { prisma } from '../src/database/prisma.js';

async function main() {
  const logs = await prisma.publishLog.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 15,
  });
  console.log('--- RECENT PUBLISH LOGS ---');
  for (const log of logs) {
    console.log(`[${log.publishedAt.toISOString()}] Group: ${log.groupName} | Cat: ${log.category} | Status: ${log.status} | Error: ${log.error || 'None'}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
