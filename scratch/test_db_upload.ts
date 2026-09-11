import { prisma, connectDatabase, disconnectDatabase } from '../src/database/prisma.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const connected = await connectDatabase();
  console.log('Connected to DB:', connected);

  const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
  const tempTarPath = path.resolve(process.cwd(), 'scratch', 'test_archive.tar.gz');

  // Let's check session backup table
  const count = await prisma.sessionBackup.count();
  console.log('Current SessionBackup row count:', count);

  const existing = await prisma.sessionBackup.findUnique({
    where: { key: 'whatsapp_web_session' },
    select: { key: true, updatedAt: true },
  });
  console.log('Existing record metadata:', existing);

  await disconnectDatabase();
}

main().catch(console.error);
