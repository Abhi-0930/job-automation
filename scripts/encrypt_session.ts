import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const algorithm = 'aes-256-cbc';
const password = process.argv[2] || process.env.SESSION_PASSWORD;

if (!password) {
  console.error('❌ Please provide a password: npx tsx scripts/encrypt_session.ts <PASSWORD>');
  process.exit(1);
}

const inputFile = path.resolve('./data/session_bundle.tar.gz');
const outputFile = path.resolve('./data/session_bundle.enc');

if (!fs.existsSync(inputFile)) {
  console.error('❌ Input file not found:', inputFile);
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const iv = crypto.randomBytes(16);

const cipher = crypto.createCipheriv(algorithm, key, iv);
const input = fs.readFileSync(inputFile);
const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);

// Structure: [salt (16 bytes)][iv (16 bytes)][encrypted payload]
const finalBuffer = Buffer.concat([salt, iv, encrypted]);
fs.writeFileSync(outputFile, finalBuffer);

console.log('🔒 Encrypted session saved to:', outputFile);
console.log('Size:', Math.round(finalBuffer.length / 1024), 'KB');
