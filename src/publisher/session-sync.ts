import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const SESSION_KEY = 'whatsapp_web_session';

/**
 * Backs up local WhatsApp session folder into Neon database as compressed base64.
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
    // Create lightweight tarball excluding cache, shader, and crash files
    const parentDir = path.dirname(sessionDir);
    const baseDir = path.basename(sessionDir);

    const excludeFlags = [
      '--exclude="*/Cache/*"',
      '--exclude="*/Code Cache/*"',
      '--exclude="*/GPUCache/*"',
      '--exclude="*/Crashpad/*"',
      '--exclude="*Singleton*"',
    ].join(' ');

    execSync(`tar -czf "${tempTarPath}" ${excludeFlags} -C "${parentDir}" "${baseDir}"`, { stdio: 'pipe' });

    const buffer = fs.readFileSync(tempTarPath);
    const base64Data = buffer.toString('base64');

    logger.info('☁️ Uploading session archive (%d KB) to Neon DB...', Math.round(buffer.length / 1024));

    await prisma.sessionBackup.upsert({
      where: { key: SESSION_KEY },
      update: { data: base64Data },
      create: { key: SESSION_KEY, data: base64Data },
    });

    logger.info('🎉 WhatsApp session successfully backed up to cloud database!');
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
    const record = await prisma.sessionBackup.findUnique({
      where: { key: SESSION_KEY },
    });

    if (!record || !record.data) {
      logger.info('ℹ️ No cloud WhatsApp session backup found in database.');
      return false;
    }

    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const tempTarPath = path.resolve(dataDir, 'restore_temp.tar.gz');
    const buffer = Buffer.from(record.data, 'base64');
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
