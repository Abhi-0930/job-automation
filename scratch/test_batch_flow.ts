import { prisma, connectDatabase, disconnectDatabase } from '../src/database/prisma.js';
import { publishingQueue } from '../src/publisher/queue.js';
import { env } from '../src/config/env.js';

async function main() {
  await connectDatabase();

  console.log('Testing publishCategoryBatch dry run...');
  const count = await publishingQueue.publishCategoryBatch('TECH', 1);
  console.log('Result count:', count);

  await disconnectDatabase();
}

main().catch(console.error);
