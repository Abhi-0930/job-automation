import { prisma } from '../src/database/prisma.js';

async function main() {
  const logs = await prisma.publishLog.findMany({
    where: {
      publishedAt: {
        gte: new Date(Date.now() - 3600 * 1000 * 24), // Last 24 hours
      }
    },
    orderBy: { publishedAt: 'desc' },
    take: 10,
  });

  console.log(`Found ${logs.length} logs in last 24h:`);
  for (const l of logs) {
    console.log(`[${l.publishedAt.toISOString()}] ID: ${l.id} | Group: "${l.groupName}" | Cat: ${l.category} | Status: ${l.status} | Error: ${l.error ? l.error.slice(0, 150) : 'None'}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
