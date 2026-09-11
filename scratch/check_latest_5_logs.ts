import { prisma } from '../src/database/prisma.js';

async function main() {
  const logs = await prisma.publishLog.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 5,
  });

  console.log('=== LATEST 5 PUBLISH LOGS ===');
  for (const log of logs) {
    console.log(`\n-----------------------------------------`);
    console.log(`ID: ${log.id}`);
    console.log(`PublishedAt (UTC): ${log.publishedAt.toISOString()}`);
    console.log(`PublishedAt (IST): ${log.publishedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    console.log(`Group: "${log.groupName}" | Category: ${log.category} | Status: ${log.status}`);
    console.log(`Error: ${log.error || 'NONE'}`);
    console.log(`Message Preview: ${log.message?.slice(0, 100)}...`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
