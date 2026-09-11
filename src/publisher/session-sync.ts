import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const SESSION_KEY = 'whatsapp_web_session';
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks to stay well within PgBouncer / Postgres query buffers

/**
 * Backs up local WhatsApp session folder into Neon database as compressed base64 chunks.
 */
export async function backupSessionToCloud(): Promise<boolean> {
  const sessionDir = path.resolve(process.cwd(), env.WHATSAPP_SESSION_PATH);

  if (!fs.existsSync(sessionDir) || fs.readdirSync(sessionDir).length === 0) {
    logger.warn('No local WhatsApp session found to backup at %s', sessionDir);
    return false;
  }

  const tempTarPath = path.resolve(process.cwd(), 'data', 'session_temp.tar.gz');

  try {
    logger.info('📦 Compressing WhatsApp session for cloud sync...');
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

    logger.info('☁️ Uploading session archive (%d KB, %d chunks) to Neon DB...', Math.round(buffer.length / 1024), chunkCount);

    // Upload chunks in concurrent batches of 4
    const concurrency = 4;
    for (let i = 0; i < chunkCount; i += concurrency) {
      const batch = [];
      for (let j = i; j < Math.min(i + concurrency, chunkCount); j++) {
        const chunkData = base64Data.slice(j * CHUNK_SIZE, (j + 1) * CHUNK_SIZE);
        const chunkKey = `${SESSION_KEY}_chunk_${j}`;
        batch.push(
          prisma.sessionBackup.upsert({
            where: { key: chunkKey },
            update: { data: chunkData },
            create: { key: chunkKey, data: chunkData },
          })
        );
      }
      await Promise.all(batch);
    }

    // Save session metadata
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

    logger.info('🎉 WhatsApp session successfully backed up to cloud database (%d chunks)!', chunkCount);
    return true;
  } catch (error) {
    logger.error('Failed to backup WhatsApp session to cloud: %s', (error as Error).message);
    return false;
  } finally {
    if (fs.existsSync(tempTarPath)) {
      fs.unlinkSync(tempTarPath);
    }
  }
}

/**
 * Restores WhatsApp session from Neon database if local session is missing or empty.
 */
export async function restoreSessionFromCloud(): Promise<boolean> {
  const sessionDir = path.resolve(process.cwd(), env.WHATSAPP_SESSION_PATH);

  // If already exists and has files, skip
  if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 2) {
    logger.debug('Local WhatsApp session exists. Skipping cloud restore.');
    return true;
  }

  try {
    logger.info('🔍 Checking cloud database for saved WhatsApp session...');
    
    // 1. Check for chunked metadata
    const metaRecord = await prisma.sessionBackup.findUnique({
      where: { key: `${SESSION_KEY}_meta` },
    });

    let base64Data = '';

    if (metaRecord && metaRecord.data) {
      const meta = JSON.parse(metaRecord.data);
      const chunkCount: number = meta.chunkCount;
      logger.info('📥 Fetching %d session chunks from database...', chunkCount);

      // Fetch all chunk records in one query
      const chunkRecords = await prisma.sessionBackup.findMany({
        where: {
          key: {
            startsWith: `${SESSION_KEY}_chunk_`,
          },
        },
      });

      const chunkMap = new Map<string, string>();
      for (const rec of chunkRecords) {
        chunkMap.set(rec.key, rec.data);
      }

      for (let i = 0; i < chunkCount; i++) {
        const chunk = chunkMap.get(`${SESSION_KEY}_chunk_${i}`);
        if (!chunk) {
          throw new Error(`Missing session chunk ${i} of ${chunkCount} in database`);
        }
        base64Data += chunk;
      }
    } else {
      // Fallback to legacy monolithic record if present
      const legacyRecord = await prisma.sessionBackup.findUnique({
        where: { key: SESSION_KEY },
      });

      if (!legacyRecord || !legacyRecord.data) {
        logger.info('ℹ️ No cloud WhatsApp session backup found in database.');
        return false;
      }
      base64Data = legacyRecord.data;
    }

    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const tempTarPath = path.resolve(dataDir, 'restore_temp.tar.gz');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempTarPath, buffer);

    logger.info('📥 Extracting cloud session archive (%d KB)...', Math.round(buffer.length / 1024));
    execSync(`tar -xzf "${tempTarPath}" -C "${dataDir}"`, { stdio: 'pipe' });

    logger.info('🎉 WhatsApp session restored successfully from cloud database!');
    return true;
  } catch (error) {
    logger.error('Failed to restore WhatsApp session from cloud: %s', (error as Error).message);
    return false;
  }
}
