import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const algorithm = 'aes-256-cbc';
const password = process.argv[2] || process.env.SESSION_PASSWORD;

if (!password) {
  console.error('❌ Please provide a password: npm run session:encrypt <PASSWORD>');
  process.exit(1);
}

const sessionDir = path.resolve('./data/whatsapp_session');
const tarFile = path.resolve('./data/session_bundle.tar.gz');
const encFile = path.resolve('./data/session_bundle.enc');

if (!fs.existsSync(sessionDir) && !fs.existsSync(tarFile)) {
  console.error('❌ Neither data/whatsapp_session nor data/session_bundle.tar.gz exists.');
  process.exit(1);
}

// 1. Pack whatsapp_session if it exists
if (fs.existsSync(sessionDir)) {
  console.log('📦 Packaging whatsapp_session (excluding temporary browser caches, preserving Service Worker)...');
  try {
    execSync(
      'tar ' +
      '--exclude="whatsapp_session/Default/Cache" ' +
      '--exclude="whatsapp_session/Default/Code Cache" ' +
      '--exclude="whatsapp_session/Default/DawnGraphiteCache" ' +
      '--exclude="whatsapp_session/Default/DawnWebGPUCache" ' +
      '--exclude="whatsapp_session/Default/GPUCache" ' +
      '--exclude="whatsapp_session/GrShaderCache" ' +
      '--exclude="whatsapp_session/ShaderCache" ' +
      '--exclude="whatsapp_session/Crashpad" ' +
      '-czf ./data/session_bundle.tar.gz -C ./data whatsapp_session'
    );
    console.log('✅ Created optimized session archive.');
  } catch (err) {
    console.error('❌ Failed to create tarball:', (err as Error).message);
    process.exit(1);
  }
}

// 2. Encrypt session_bundle.tar.gz -> session_bundle.enc
console.log('🔒 Encrypting with AES-256...');
const salt = crypto.randomBytes(16);
const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const iv = crypto.randomBytes(16);

const cipher = crypto.createCipheriv(algorithm, key, iv);
const input = fs.readFileSync(tarFile);
const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);

// Structure: [salt (16 bytes)][iv (16 bytes)][encrypted payload]
const finalBuffer = Buffer.concat([salt, iv, encrypted]);
fs.writeFileSync(encFile, finalBuffer);

// 3. Remove raw tarball
if (fs.existsSync(tarFile)) {
  fs.unlinkSync(tarFile);
}

console.log('🎉 Encrypted session created successfully at:', encFile);
console.log('📊 Encrypted File Size:', (finalBuffer.length / (1024 * 1024)).toFixed(2), 'MB');
console.log('👉 Next: Commit data/session_bundle.enc to GitHub and set SESSION_PASSWORD in GitHub Secrets.');

