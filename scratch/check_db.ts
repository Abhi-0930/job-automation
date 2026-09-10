import { prisma } from '../src/database/prisma.js';

async function main() {
  const session = await prisma.sessionBackup.findUnique({ where: { key: 'whatsapp_web_session' } });
  console.log('Session Backup in DB:', session ? `Present (${Math.round(session.data.length / 1024)} KB)` : 'MISSING');

  const statusCounts = await prisma.job.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  console.log('Job status counts:', statusCounts);

  const categoryCounts = await prisma.job.groupBy({
    by: ['category'],
    _count: { id: true },
  });
  console.log('Job category counts:', categoryCounts);

  const recentLogs = await prisma.publishLog.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 10,
  });
  console.log('Recent 10 Publish Logs:');
  console.table(
    recentLogs.map((l) => ({
      group: l.groupName,
      cat: l.category,
      status: l.status,
      error: l.error,
      publishedAt: l.publishedAt.toISOString(),
    }))
  );

  await prisma.$disconnect();
}

main().catch(console.error);
