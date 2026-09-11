import { restoreSessionFromCloud } from '../src/publisher/session-sync.js';
import { prisma } from '../src/database/prisma.js';

async function main() {
  console.log('Testing restoreSessionFromCloud...');
  const result = await restoreSessionFromCloud();
  console.log('Restore result:', result);
  await prisma.$disconnect();
}

main().catch(console.error);
