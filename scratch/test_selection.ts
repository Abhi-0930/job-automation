import { prisma } from '../src/database/prisma.js';
import { verifyJobApplicationActive } from '../src/jobs/verifier.js';

async function main() {
  const category = 'TECH';
  const minScore = 70;
  const limit = 1;
  
  console.log('Testing candidate selection...');
  const rawCandidates = await prisma.job.findMany({
    where: {
      category,
      score: { gte: minScore },
      status: { notIn: ['PUBLISHED', 'ARCHIVED', 'FAILED'] },
    },
    orderBy: [
      { score: 'desc' },
      { createdAt: 'desc' },
    ],
    take: limit * 5,
  });

  console.log(`Found ${rawCandidates.length} raw candidate jobs:`);
  for (const job of rawCandidates) {
    console.log(`- Job ${job.id}: "${job.title}" at "${job.company}" | Score: ${job.score} | URL: ${job.url}`);
    const v = await verifyJobApplicationActive(job.url);
    console.log(`  -> Verification: isActive=${v.isActive} (${v.reason || 'OK'})`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
