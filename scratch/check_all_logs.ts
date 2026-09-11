import { prisma } from '../src/database/prisma.js';

async function main() {
  const totalLogs = await prisma.publishLog.count();
  console.log(`Total PublishLogs in DB: ${totalLogs}`);

  const allLogs = await prisma.publishLog.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 10,
  });

  for (const l of allLogs) {
    console.log(`[${l.publishedAt.toISOString()}] (${l.publishedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}) Group: "${l.groupName}" | Cat: ${l.category} | Status: ${l.status}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
