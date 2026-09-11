import { prisma } from '../src/database/prisma.js';

async function main() {
  console.log('Checking latest PublishLog after Render trigger...');
  for (let i = 0; i < 6; i++) {
    const latest = await prisma.publishLog.findFirst({
      orderBy: { publishedAt: 'desc' },
      include: { job: true },
    });

    if (latest) {
      console.log(`[Attempt ${i + 1}] ID: ${latest.id} | Status: ${latest.status} | Group: ${latest.groupName} | PublishedAt: ${latest.publishedAt.toISOString()} | Error: ${latest.error || 'NONE'}`);
      if (latest.publishedAt.getTime() > Date.now() - 60000) {
        console.log('🎉 FOUND RECENT LOG CREATED JUST NOW:');
        console.log('Status:', latest.status);
        console.log('Job Title:', latest.job?.title);
        console.log('Error (if any):', latest.error);
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  await prisma.$disconnect();
}

main().catch(console.error);
