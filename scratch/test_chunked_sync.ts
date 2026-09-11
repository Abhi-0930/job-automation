import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma, connectDatabase, disconnectDatabase } from '../src/database/prisma.js';

const SESSION_KEY = 'whatsapp_web_session';
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks (well below PgBouncer limit)

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
  const totalLength = base64Data.length;
  const chunkCount = Math.ceil(totalLength / CHUNK_SIZE);

  console.log(`2. Archive: ${(buffer.length / 1024 / 1024).toFixed(2)} MB. Base64 length: ${totalLength}. Splitting into ${chunkCount} chunks of 1MB...`);

  const startTime = Date.now();

  // Upload chunks
  for (let i = 0; i < chunkCount; i++) {
    const chunkData = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const chunkKey = `${SESSION_KEY}_chunk_${i}`;
    await prisma.sessionBackup.upsert({
      where: { key: chunkKey },
      update: { data: chunkData },
      create: { key: chunkKey, data: chunkData },
    });
    console.log(`   Uploaded chunk ${i + 1}/${chunkCount} (${chunkData.length} chars)`);
  }

  // Update metadata key
  const metaData = JSON.stringify({
    chunkCount,
    totalBytes: buffer.length,
    updatedAt: new Date().toISOString(),
  });

  await prisma.sessionBackup.upsert({
    where: { key: `${SESSION_KEY}_meta` },
    update: { data: metaData },
    create: { key: `${SESSION_KEY}_meta`, data: metaData },
  });

  console.log(`3. Successfully uploaded all ${chunkCount} chunks in ${((Date.now() - startTime) / 1000).toFixed(1)}s!`);

  // Now test restoring/downloading back
  console.log('4. Testing restore from DB chunks...');
  const restoreStart = Date.now();
  const metaRecord = await prisma.sessionBackup.findUnique({
    where: { key: `${SESSION_KEY}_meta` },
  });

  if (!metaRecord) throw new Error('Meta record missing!');
  const parsedMeta = JSON.parse(metaRecord.data);
  console.log('   Found metadata:', parsedMeta);

  let reconstructedBase64 = '';
  for (let i = 0; i < parsedMeta.chunkCount; i++) {
    const chunkRecord = await prisma.sessionBackup.findUnique({
      where: { key: `${SESSION_KEY}_chunk_${i}` },
    });
    if (!chunkRecord) throw new Error(`Missing chunk ${i}!`);
    reconstructedBase64 += chunkRecord.data;
  }

  console.log(`   Reconstructed base64 length: ${reconstructedBase64.length} matches original: ${reconstructedBase64 === base64Data}`);
  const restoredBuffer = Buffer.from(reconstructedBase64, 'base64');
  console.log(`   Restored buffer size: ${(restoredBuffer.length / 1024 / 1024).toFixed(2)} MB in ${((Date.now() - restoreStart) / 1000).toFixed(1)}s`);

  fs.unlinkSync(tempTarPath);
  await disconnectDatabase();
}

main().catch(console.error);
