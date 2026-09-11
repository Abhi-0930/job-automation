import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
const tempTarPath = path.resolve(process.cwd(), 'scratch', 'test_small.tar.gz');

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

console.log('Compressing session with optimized excludes...');
execSync(`tar -czf "${tempTarPath}" ${excludeFlags} -C "${parentDir}" "${baseDir}"`, { stdio: 'pipe' });

const stats = fs.statSync(tempTarPath);
console.log(`New Compressed Archive Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${Math.round(stats.size / 1024)} KB)`);

// Test extracting into a test folder to verify integrity
const testExtractDir = path.resolve(process.cwd(), 'scratch', 'test_extract');
if (fs.existsSync(testExtractDir)) {
  fs.rmSync(testExtractDir, { recursive: true, force: true });
}
fs.mkdirSync(testExtractDir, { recursive: true });

execSync(`tar -xzf "${tempTarPath}" -C "${testExtractDir}"`, { stdio: 'pipe' });
console.log('Successfully extracted archive into test folder!');
console.log('Extracted files:', fs.readdirSync(path.join(testExtractDir, 'whatsapp_session')));

fs.unlinkSync(tempTarPath);
fs.rmSync(testExtractDir, { recursive: true, force: true });
