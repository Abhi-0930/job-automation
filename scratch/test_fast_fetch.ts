import { prisma } from '../src/database/prisma.js';

async function main() {
  console.log('Testing fast chunk retrieval...');
  const t0 = Date.now();
  
  const metaRecord = await prisma.sessionBackup.findUnique({
    where: { key: 'whatsapp_web_session_meta' },
  });

  if (!metaRecord || !metaRecord.data) {
    console.log('No meta record found');
    return;
  }

  const meta = JSON.parse(metaRecord.data);
  const chunkCount = meta.chunkCount;
  console.log(`Found meta: ${chunkCount} chunks, totalBytes: ${meta.totalBytes}`);

  // Fetch in batches of 5
  const chunks: string[] = new Array(chunkCount);
  const batchSize = 5;
  
  for (let i = 0; i < chunkCount; i += batchSize) {
    const batchKeys: string[] = [];
    const max = Math.min(i + batchSize, chunkCount);
    for (let j = i; j < max; j++) {
      batchKeys.push(`whatsapp_web_session_chunk_${j}`);
    }

    const tBatch = Date.now();
    const records = await prisma.sessionBackup.findMany({
      where: { key: { in: batchKeys } },
      select: { key: true, data: true },
    });
    
    for (const rec of records) {
      const idx = parseInt(rec.key.replace('whatsapp_web_session_chunk_', ''), 10);
      chunks[idx] = rec.data;
    }
    console.log(`Fetched batch ${i}..${max - 1} (${records.length} records) in ${Date.now() - tBatch}ms`);
  }

  let fullBase64 = chunks.join('');
  console.log(`Done! Reassembled ${fullBase64.length} base64 chars in ${Date.now() - t0}ms`);

  await prisma.$disconnect();
}

main().catch(console.error);
