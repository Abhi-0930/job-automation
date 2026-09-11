import { prisma } from '../src/database/prisma.js';

async function main() {
  const categories = ['TECH', 'INTERNSHIP', 'NON_TECH', 'GOVT', 'REFERRAL'];
  console.log('--- PUBLISHABLE CANDIDATES PER CATEGORY (Score >= 70) ---');
  for (const cat of categories) {
    const count = await prisma.job.count({
      where: {
        category: cat as any,
        score: { gte: 70 },
        status: { notIn: ['PUBLISHED', 'ARCHIVED', 'FAILED'] },
      }
    });
    console.log(`  Category ${cat.padEnd(12)}: ${count} ready jobs`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
