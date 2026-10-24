import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const algorithm = 'aes-256-cbc';
const password = process.argv[2] || process.env.SESSION_PASSWORD;

if (!password) {
  console.error('❌ FATAL: No SESSION_PASSWORD provided in environment! Please configure SESSION_PASSWORD in GitHub Secrets.');
  process.exit(1);
}

const encFile = path.resolve('./data/session_bundle.enc');
const tarFile = path.resolve('./data/session_bundle.tar.gz');

if (!fs.existsSync(encFile)) {
  console.error('❌ FATAL: No data/session_bundle.enc found to decrypt!');
  process.exit(1);
}

try {
  console.log('🔓 Decrypting session_bundle.enc...');
  const buffer = fs.readFileSync(encFile);
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 32);
  const encrypted = buffer.subarray(32);

  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  fs.writeFileSync(tarFile, decrypted);
  console.log('📦 Extracting session tarball to ./data...');
  const targetDir = path.resolve('./data/whatsapp_session');
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  execSync(`tar -xzf "${tarFile}" -C ./data`);
  fs.unlinkSync(tarFile);

  const defaultDir = path.resolve('./data/whatsapp_session/Default');
  if (!fs.existsSync(defaultDir)) {
    console.error('❌ FATAL: Extracted whatsapp_session does not contain Default directory!');
    process.exit(1);
  }

  console.log('🎉 WhatsApp session successfully restored in ./data/whatsapp_session!');
  console.log('✅ Session verified: Default profile directory exists with', fs.readdirSync(defaultDir).length, 'entries.');
} catch (error) {
  console.error('❌ Failed to decrypt session:', (error as Error).message);
  process.exit(1);
}
