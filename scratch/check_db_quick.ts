import { prisma } from '../src/database/prisma.js';

async function main() {
  console.log('Testing raw connection...');
  const t0 = Date.now();
  const res = await prisma.$queryRaw`SELECT 1 as test`;
  console.log('Raw query succeeded in', Date.now() - t0, 'ms:', res);
  
  const chunksCount = await prisma.sessionBackup.count({
    where: { key: { startsWith: 'whatsapp_web_session' } }
  });
  console.log('Total sessionBackup rows count:', chunksCount);

  await prisma.$disconnect();
}

main().catch(console.error);
