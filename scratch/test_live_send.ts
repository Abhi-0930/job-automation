import { whatsAppPublisher } from '../src/publisher/whatsapp.js';
import { connectDatabase, disconnectDatabase } from '../src/database/prisma.js';
import { env } from '../src/config/env.js';

async function main() {
  await connectDatabase();

  const groupName = env.WHATSAPP_GROUP_TECH;
  const testMessage = `🧪 *Test Broadcast - Job Automation System*
📅 *Timestamp:* ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
✅ System connectivity and WhatsApp Web session verification successful.`;

  console.log(`Sending live test message to "${groupName}"...`);
  const result = await whatsAppPublisher.sendMessage(groupName, testMessage);
  console.log('Result:', result);

  await disconnectDatabase();
}

main().catch(console.error);
