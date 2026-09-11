import { backupSessionToCloud } from '../src/publisher/session-sync.js';
import { prisma } from '../src/database/prisma.js';

async function main() {
  console.log('Running clean session backup to Neon DB...');
  const success = await backupSessionToCloud();
  console.log('Backup result:', success);
  
  const count = await prisma.sessionBackup.count({
    where: { key: { startsWith: 'whatsapp_web_session_chunk_' } }
  });
  console.log('Total active chunk rows now in Neon DB:', count);
  
  await prisma.$disconnect();
}

main().catch(console.error);
