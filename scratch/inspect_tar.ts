import { prisma } from '../src/database/prisma.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function main() {
  const record = await prisma.sessionBackup.findUnique({ where: { key: 'whatsapp_web_session' } });
  if (!record || !record.data) {
    console.log('No backup found');
    return;
  }
  const testTar = path.resolve(process.cwd(), 'scratch', 'test_backup.tar.gz');
  fs.writeFileSync(testTar, Buffer.from(record.data, 'base64'));

  console.log('Listing tar contents (first 20 entries):');
  const output = execSync(`tar -tf "${testTar}"`, { encoding: 'utf-8' });
  const lines = output.split('\n');
  console.log('Total files in archive:', lines.length);
  console.log('First 20 entries:\n', lines.slice(0, 20).join('\n'));

  fs.unlinkSync(testTar);
  await prisma.$disconnect();
}

main().catch(console.error);
