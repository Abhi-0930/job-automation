import fs from 'fs';
import path from 'path';

const sessionDir = path.resolve(process.cwd(), './data/whatsapp_session');
console.log('Session dir path:', sessionDir);
console.log('Session dir exists:', fs.existsSync(sessionDir));
if (fs.existsSync(sessionDir)) {
  const files = fs.readdirSync(sessionDir);
  console.log('Files count in session dir:', files.length);
  console.log('Files list:', files.slice(0, 15));
}
