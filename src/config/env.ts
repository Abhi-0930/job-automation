import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),

  DATABASE_URL: z.string().default('postgresql://postgres:postgrespassword@localhost:5432/job_automation_db?schema=public'),

  // DeepSeek AI
  DEEPSEEK_API_KEY: z.string().optional().default(''),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),

  // WhatsApp Playwright
  WHATSAPP_SESSION_PATH: z.string().default('./data/whatsapp_session'),
  WHATSAPP_HEADLESS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  WHATSAPP_MESSAGE_DELAY_MS: z.coerce.number().default(3500),

  // WhatsApp Groups
  WHATSAPP_GROUP_TECH: z.string().default('💻 Tech Jobs'),
  WHATSAPP_GROUP_INTERNSHIP: z.string().default('🎓 Internships'),
  WHATSAPP_GROUP_NON_TECH: z.string().default('🏢 Non-Tech Jobs'),
  WHATSAPP_GROUP_GOVT: z.string().default('🏛️ Government Jobs'),
  WHATSAPP_GROUP_COHORT: z.string().default('📚 Cohorts & Upskilling'),
  WHATSAPP_GROUP_REFERRAL: z.string().default('🤝 Referrals & Networking'),
  WHATSAPP_GROUP_COMMUNITY: z.string().default("🔥 Today's Best Opportunities"),

  // Publishing
  MIN_SCORE_TO_PUBLISH: z.coerce.number().default(70),
  MAX_JOBS_PER_BATCH: z.coerce.number().default(5),

  // Crons
  CRON_COLLECTION: z.string().default('*/15 * * * *'),
  CRON_TECH: z.string().default('0 9 * * *'),
  CRON_GOVT: z.string().default('0 11 * * *'),
  CRON_INTERNSHIP: z.string().default('0 13 * * *'),
  CRON_NON_TECH: z.string().default('0 17 * * *'),
  CRON_REFERRAL: z.string().default('0 19 * * *'),
  CRON_DIGEST: z.string().default('0 20 * * *'),

  // Safety
  DRY_RUN: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
