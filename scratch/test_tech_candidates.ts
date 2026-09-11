import { prisma } from '../src/database/prisma.js';
import { verifyJobApplicationActive } from '../src/jobs/verifier.js';

async function main() {
  const jobs = await prisma.job.findMany({
    where: {
      category: 'TECH',
      score: { gte: 70 },
      status: { notIn: ['PUBLISHED', 'ARCHIVED', 'FAILED'] },
    },
    orderBy: [
      { score: 'desc' },
      { createdAt: 'desc' },
    ],
    take: 5,
  });

  console.log(`Found ${jobs.length} top TECH candidate jobs:`);
  for (const job of jobs) {
    console.log(`\nChecking Job [${job.id}]: "${job.title}" at "${job.company}"`);
    console.log(`URL: ${job.url}`);
    console.log(`Score: ${job.score}`);
    try {
      const v = await verifyJobApplicationActive(job.url);
      console.log(`Verification result: isActive=${v.isActive}, reason=${v.reason || 'None'}`);
    } catch (e) {
      console.log(`Verification error: ${(e as Error).message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
