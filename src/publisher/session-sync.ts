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

    // Delete any old or orphaned chunk records first
    await prisma.sessionBackup.deleteMany({
      where: { key: { startsWith: `${SESSION_KEY}_chunk_` } },
    });

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
 * Restores WhatsApp session from Neon database if local session is missing or cloud version is newer.
 */
export async function restoreSessionFromCloud(force: boolean = false): Promise<boolean> {
  const sessionDir = path.resolve(process.cwd(), env.WHATSAPP_SESSION_PATH);
  const metaFilePath = path.join(sessionDir, '.cloud_meta');

  try {
    logger.info('🔍 Checking cloud database for saved WhatsApp session...');
    
    // 1. Check for chunked metadata
    const metaRecord = await prisma.sessionBackup.findUnique({
      where: { key: `${SESSION_KEY}_meta` },
    });

    let base64Data = '';
    let cloudTimestamp = '';

    if (metaRecord && metaRecord.data) {
      const meta = JSON.parse(metaRecord.data);
      cloudTimestamp = meta.updatedAt || metaRecord.updatedAt.toISOString();
      const chunkCount: number = meta.chunkCount;

      // Check if local session already matches cloud timestamp
      if (!force && fs.existsSync(metaFilePath)) {
        try {
          const localMeta = JSON.parse(fs.readFileSync(metaFilePath, 'utf-8'));
          if (localMeta.updatedAt === cloudTimestamp && fs.readdirSync(sessionDir).length > 3) {
            logger.info('✅ Local WhatsApp session is up to date with cloud backup (%s). Skipping restore.', cloudTimestamp);
            return true;
          }
        } catch {
          // Re-restore if local meta is invalid
        }
      }

      logger.info('📥 Fetching %d session chunks from database (Cloud Version: %s)...', chunkCount, cloudTimestamp);

      // Fetch chunks in batches of 5 to avoid single large buffer latency
      const chunks: string[] = new Array(chunkCount);
      const batchSize = 5;
      for (let i = 0; i < chunkCount; i += batchSize) {
        const batchKeys: string[] = [];
        const max = Math.min(i + batchSize, chunkCount);
        for (let j = i; j < max; j++) {
          batchKeys.push(`${SESSION_KEY}_chunk_${j}`);
        }

        const records = await prisma.sessionBackup.findMany({
          where: { key: { in: batchKeys } },
          select: { key: true, data: true },
        });

        for (const rec of records) {
          const idx = parseInt(rec.key.replace(`${SESSION_KEY}_chunk_`, ''), 10);
          chunks[idx] = rec.data;
        }
      }

      for (let i = 0; i < chunkCount; i++) {
        if (!chunks[i]) {
          throw new Error(`Missing session chunk ${i} of ${chunkCount} in database`);
        }
        base64Data += chunks[i];
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
      cloudTimestamp = legacyRecord.updatedAt.toISOString();
      base64Data = legacyRecord.data;
    }

    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Clean old session folder before extracting fresh
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }

    const tempTarPath = path.resolve(dataDir, 'restore_temp.tar.gz');
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempTarPath, buffer);

    logger.info('📥 Extracting cloud session archive (%d KB)...', Math.round(buffer.length / 1024));
    execSync(`tar -xzf "${tempTarPath}" -C "${dataDir}"`, { stdio: 'pipe' });

    // Save cloud meta file locally
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(metaFilePath, JSON.stringify({ updatedAt: cloudTimestamp, restoredAt: new Date().toISOString() }));

    if (fs.existsSync(tempTarPath)) {
      fs.unlinkSync(tempTarPath);
    }

    logger.info('🎉 WhatsApp session restored successfully from cloud database!');
    return true;
  } catch (error) {
    logger.error('Failed to restore WhatsApp session from cloud: %s', (error as Error).message);
    return false;
  }
}
