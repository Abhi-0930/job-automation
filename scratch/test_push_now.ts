import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma, connectDatabase, disconnectDatabase } from '../src/database/prisma.js';

async function main() {
  await connectDatabase();

  const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
  const tempTarPath = path.resolve(process.cwd(), 'data', 'session_temp.tar.gz');

  console.log('1. Compressing WhatsApp session...');
  const parentDir = path.dirname(sessionDir);
  const baseDir = path.basename(sessionDir);

  const excludeFlags = [
    '--exclude="*/Cache/*"',
    '--exclude="*/Code Cache/*"',
    '--exclude="*/GPUCache/*"',
    '--exclude="*/DawnCache/*"',
    '--exclude="*/CacheStorage/*"',
    '--exclude="*/ScriptCache/*"',
    '--exclude="*/Crashpad/*"',
    '--exclude="*Singleton*"',
    '--exclude="*/chrome_debug.log"',
    '--exclude="*/History*"',
    '--exclude="*/Favicons*"',
  ].join(' ');

  execSync(`tar -czf "${tempTarPath}" ${excludeFlags} -C "${parentDir}" "${baseDir}"`, { stdio: 'pipe' });

  const buffer = fs.readFileSync(tempTarPath);
  const base64Data = buffer.toString('base64');
  console.log(`2. Archive size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB (${Math.round(buffer.length / 1024)} KB). Base64 length: ${base64Data.length}`);

  console.log('3. Uploading to Neon DB via Prisma...');
  const start = Date.now();
  await prisma.sessionBackup.upsert({
    where: { key: 'whatsapp_web_session' },
    update: { data: base64Data },
    create: { key: 'whatsapp_web_session', data: base64Data },
  });
  console.log(`4. Done in ${(Date.now() - start)/1000}s!`);

  fs.unlinkSync(tempTarPath);
  await disconnectDatabase();
}

main().catch(console.error);
