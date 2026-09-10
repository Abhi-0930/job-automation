import cron from 'node-cron';
import { env } from '../src/config/env.js';
import { prisma } from '../src/database/prisma.js';

async function verifyAll() {
  console.log('====================================================');
  console.log('🔍 STRICT ENVIRONMENT & CONFIGURATION VERIFICATION');
  console.log('====================================================');

  let allPassed = true;

  // 1. Schema / Type Parsing
  console.log('\n[1] Environment Parsing:');
  console.log(`  NODE_ENV:                  ${env.NODE_ENV}`);
  console.log(`  PORT:                      ${env.PORT}`);
  console.log(`  LOG_LEVEL:                 ${env.LOG_LEVEL}`);
  console.log(`  DRY_RUN:                   ${env.DRY_RUN} (Expected: false)`);
  if (env.DRY_RUN !== false) {
    console.error('  ❌ DRY_RUN should be false for live publishing!');
    allPassed = false;
  } else {
    console.log('  ✅ PASS: DRY_RUN is false (live publishing enabled)');
  }

  // 2. Playwright Headless Configuration
  console.log('\n[2] Playwright Browser Settings:');
  console.log(`  WHATSAPP_SESSION_PATH:     ${env.WHATSAPP_SESSION_PATH}`);
  console.log(`  WHATSAPP_HEADLESS:         ${env.WHATSAPP_HEADLESS} (Expected: true)`);
  console.log(`  WHATSAPP_MESSAGE_DELAY_MS: ${env.WHATSAPP_MESSAGE_DELAY_MS}ms`);
  if (env.WHATSAPP_HEADLESS !== true) {
    console.error('  ❌ WHATSAPP_HEADLESS must be true on Linux container!');
    allPassed = false;
  } else {
    console.log('  ✅ PASS: WHATSAPP_HEADLESS is true');
  }

  // 3. WhatsApp Group Names
  console.log('\n[3] WhatsApp Group Names:');
  const groups = [
    { key: 'TECH', name: env.WHATSAPP_GROUP_TECH },
    { key: 'INTERNSHIP', name: env.WHATSAPP_GROUP_INTERNSHIP },
    { key: 'NON_TECH', name: env.WHATSAPP_GROUP_NON_TECH },
    { key: 'GOVT', name: env.WHATSAPP_GROUP_GOVT },
    { key: 'COHORT', name: env.WHATSAPP_GROUP_COHORT },
    { key: 'REFERRAL', name: env.WHATSAPP_GROUP_REFERRAL },
    { key: 'COMMUNITY', name: env.WHATSAPP_GROUP_COMMUNITY },
  ];
  for (const g of groups) {
    if (!g.name || g.name.trim().length === 0) {
      console.error(`  ❌ Group name for ${g.key} is empty!`);
      allPassed = false;
    } else {
      console.log(`  ✅ ${g.key.padEnd(12)}: "${g.name}"`);
    }
  }

  // 4. Publishing Rules
  console.log('\n[4] Publishing Thresholds:');
  console.log(`  MIN_SCORE_TO_PUBLISH:      ${env.MIN_SCORE_TO_PUBLISH}`);
  console.log(`  MAX_JOBS_PER_BATCH:        ${env.MAX_JOBS_PER_BATCH}`);
  if (env.MIN_SCORE_TO_PUBLISH < 70) {
    console.error('  ❌ MIN_SCORE_TO_PUBLISH is below 70!');
    allPassed = false;
  } else {
    console.log('  ✅ PASS: Score threshold >= 70');
  }

  // 5. Cron Schedules
  console.log('\n[5] Cron Schedules (Timezone: Asia/Kolkata):');
  const crons = [
    { label: 'Collection (Every 15m)', expr: env.CRON_COLLECTION },
    { label: 'Tech Jobs (9:00 PM IST)', expr: env.CRON_TECH, expected: '00 21 * * *' },
    { label: 'Internships (9:05 PM IST)', expr: env.CRON_INTERNSHIP, expected: '05 21 * * *' },
    { label: 'Non-Tech Jobs (9:10 PM IST)', expr: env.CRON_NON_TECH, expected: '10 21 * * *' },
    { label: 'Government Jobs (9:15 PM IST)', expr: env.CRON_GOVT, expected: '15 21 * * *' },
    { label: 'Referrals (9:20 PM IST)', expr: env.CRON_REFERRAL, expected: '20 21 * * *' },
    { label: 'Daily Highlights (9:25 PM IST)', expr: env.CRON_DIGEST, expected: '25 21 * * *' },
  ];

  for (const c of crons) {
    const isValid = cron.validate(c.expr);
    if (!isValid) {
      console.error(`  ❌ Cron expression "${c.expr}" for ${c.label} is INVALID!`);
      allPassed = false;
    } else if (c.expected && c.expr !== c.expected) {
      console.error(`  ❌ Cron expression "${c.expr}" does not match expected "${c.expected}"!`);
      allPassed = false;
    } else {
      console.log(`  ✅ ${c.label.padEnd(35)}: "${c.expr}" (Valid)`);
    }
  }

  // 6. Database Connection & Session Backup
  console.log('\n[6] Neon Database Connectivity & Session Backup:');
  try {
    const jobCount = await prisma.job.count();
    console.log(`  ✅ Connected to Neon DB! Total jobs stored: ${jobCount}`);

    const session = await prisma.sessionBackup.findUnique({ where: { key: 'whatsapp_web_session' } });
    if (!session || !session.data) {
      console.error('  ❌ WhatsApp Session Backup in DB is MISSING!');
      allPassed = false;
    } else {
      console.log(`  ✅ WhatsApp Session Backup in DB: Present (${Math.round(session.data.length / 1024)} KB)`);
    }
  } catch (err) {
    console.error('  ❌ Database connection error:', (err as Error).message);
    allPassed = false;
  }

  await prisma.$disconnect();

  console.log('\n====================================================');
  if (allPassed) {
    console.log('🎉 ALL ENVIRONMENT & CONFIGURATION CHECKS PASSED PERFECTLY!');
  } else {
    console.error('❌ SOME CHECKS FAILED! Please inspect errors above.');
    process.exit(1);
  }
  console.log('====================================================');
}

verifyAll().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
