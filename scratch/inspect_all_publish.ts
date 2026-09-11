import { prisma } from '../src/database/prisma.js';

async function main() {
  console.log('--- RECENT PUBLISHED JOBS ---');
  const publishedJobs = await prisma.job.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    take: 5,
  });
  console.log(`Found ${publishedJobs.length} published jobs:`);
  for (const job of publishedJobs) {
    console.log(`- "${job.title}" at "${job.company}" | Category: ${job.category} | PublishedAt: ${job.publishedAt?.toISOString()}`);
  }

  console.log('\n--- LATEST 10 PUBLISH LOGS ---');
  const logs = await prisma.publishLog.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 10,
    include: { job: { select: { title: true, company: true } } },
  });
  for (const l of logs) {
    console.log(`- [${l.publishedAt.toISOString()}] Status: ${l.status} | Group: "${l.groupName}" | Job: "${l.job?.title}" | Error: ${l.error || 'NONE'}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
