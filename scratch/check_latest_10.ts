import { prisma } from '../src/database/prisma.js';

async function main() {
  const logs = await prisma.publishLog.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 10,
  });

  console.log('--- 10 MOST RECENT PUBLISH LOGS ---');
  for (const log of logs) {
    console.log(`[${log.publishedAt.toISOString()}] (${log.publishedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}) Group: "${log.groupName}" | Status: ${log.status} | Error: ${log.error ? log.error.slice(0, 100) : 'None'}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
