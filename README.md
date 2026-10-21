# 🚀 Job Aggregation & Distribution System

A production-grade, automated Job Aggregation and Distribution System built with **Node.js, TypeScript, PostgreSQL (Prisma ORM), Playwright, DeepSeek AI, and WhatsApp Web automation**.

---

## 🎯 System Architecture

```
[Cron Scheduler / CLI]
         │
         ▼
[Playwright & API Scrapers] ──► (LinkedIn, Internshala, Wellfound, Careers)
         │
         ▼
    [jobs_raw] (Stores every raw job, never loses data)
         │
         ▼
[Deduplication Engine] (SHA-256 canonical hash on company + title + location)
         │
         ▼
[Classification Engine] (Rule Engine First ──► DeepSeek AI Fallback)
         │
         ▼
 [AI Scoring Engine] (DeepSeek AI 1-100: Reputation, Freshers, Remote, Growth)
         │
         ▼
     [jobs] (Normalized jobs with category, match score, skills, status)
         │
         ▼
[Message Formatter] (Rich WhatsApp Markdown with emojis & hashtags)
         │
         ▼
 [Publishing Queue] (Category batching & Score >= 70 filter)
         │
         ▼
[WhatsApp Publisher] (Playwright WhatsApp Web with persistent session)
         │
 ┌───────┴────────────────────────┬──────────────────────┐
 ▼                                ▼                      ▼
💻 Tech Jobs Group       🎓 Internships Group   🔥 Daily Digest Community
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime & Language** | Node.js + TypeScript (`tsx`, `ES2022`) | Modern, type-safe execution |
| **Database & ORM** | PostgreSQL + Prisma ORM | Schema management & queries |
| **Web Automation & Scraping** | Playwright (`chromium`), Cheerio, Axios | Headless scraping & WhatsApp Web |
| **AI Classification & Scoring** | DeepSeek API (`deepseek-chat`) | JSON categorization & 1-100 scoring |
| **Scheduling** | `node-cron` | 15-min scraping & scheduled publishing |
| **Logging** | Winston + Daily Rotate File | Structured file and colorized console logs |
| **CLI Management** | Commander.js | Interactive terminal commands |

---

## 📂 Project Structure

```
src/
├── config/
│   ├── env.ts          # Zod-validated environment config
│   └── logger.ts       # Winston logger setup
├── database/
│   └── prisma.ts       # Prisma Client singleton
├── types/
│   └── job.ts          # Interfaces and type definitions
├── scrapers/
│   ├── base.scraper.ts # Abstract scraper with retry & stealth browser
│   ├── linkedin/       # LinkedIn public guest search & scraper
│   ├── internshala/    # Internshala internships & jobs parser
│   ├── internships/    # Specialized internship & apprenticeship sources
│   ├── startups/       # YC, Cutshort, and curated startup job boards
│   ├── wellfound/      # Wellfound startup listings scraper
│   ├── careers/        # Greenhouse & Lever ATS direct career pages
│   └── index.ts        # Scraper registry & batch executor
├── jobs/
│   ├── deduplicate.ts  # SHA-256 hash deduplication engine
│   └── collector.ts    # Ingestion pipeline orchestrator
├── ai/
│   ├── client.ts       # DeepSeek API client (OpenAI SDK)
│   ├── classify.ts     # Rule engine first + DeepSeek AI fallback
│   ├── score.ts        # DeepSeek AI 1-100 scoring
│   └── formatter.ts    # Single message & Daily Digest formatter
├── publisher/
│   ├── whatsapp.ts     # Playwright WhatsApp Web automation
│   ├── queue.ts        # Batch publishing queue & daily digest
│   └── index.ts
├── scheduler/
│   └── cron.ts         # node-cron scheduled tasks
├── cli/
│   └── index.ts        # CLI tool
└── app.ts              # Daemon bootstrap & health monitor
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v24)
- **PostgreSQL** (local instance, cloud instance like Supabase/Neon, or Docker)

### 2. Install Dependencies & Browsers
```bash
npm install
npx playwright install chromium
```

### 3. Setup PostgreSQL Database
If using Docker:
```bash
docker compose up -d
```
Then initialize Prisma schema:
```bash
npm run prisma:push
# or: npm run prisma:migrate
```

### 4. Configure Environment Variables (`.env`)
Create/update your `.env` file:
```env
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/job_automation_db?schema=public"

# DeepSeek AI (https://platform.deepseek.com)
DEEPSEEK_API_KEY="your_deepseek_api_key_here"

# WhatsApp Automation
WHATSAPP_SESSION_PATH="./data/whatsapp_session"
WHATSAPP_HEADLESS=true
DRY_RUN=true # set to false for real WhatsApp posting
```

---

## 📱 WhatsApp Web Session Pairing

To scan the WhatsApp Web QR code once and save the persistent session:
```bash
npm run auth:whatsapp
```
1. A Chromium browser window will open displaying WhatsApp Web.
2. Open WhatsApp on your phone -> **Linked Devices** -> **Link a Device**.
3. Scan the QR code.
4. Once connected, the browser closes automatically and stores the credentials inside `./data/whatsapp_session/`.
5. All future automated publishing runs headlessly without needing QR scans!

---

## 🎮 CLI Commands

| Command | Description |
|---|---|
| `npm run auth:whatsapp` | Opens browser to scan WhatsApp QR code once |
| `npm run scrape` | Scrapes all registered sources and displays a preview table |
| `npm run cli scrape -s niche-internships` | Scrapes ISTI, DRDO, MoSPI, Uptern, YesIntern, and NATS listings |
| `npm run cli -- scrape -s startup-boards` | Scrapes YC, Cutshort, Indian Startup Jobs, and Andhra Startup Map |
| `npm run cli scrape -s careers` | Scrapes a specific registered source |
| `npm run cli collect` | Runs end-to-end collection, deduplication, classification, and scoring |
| `npm run cli process` | Processes all pending raw jobs in `jobs_raw` table |
| `npm run publish:tech` | Publishes top Tech jobs (score >= 70) |
| `npm run publish:internship` | Publishes top Internships (score >= 70) |
| `npm run publish:nontech` | Publishes top Non-Tech jobs (score >= 70) |
| `npm run publish:digest` | Compiles & sends 8:00 PM Daily Digest |
| `npm test` | Runs the automated 24-point test suite |
| `npm run dev` | Starts background daemon with cron schedules |

---

## ⏰ Automated Publishing Schedule

| Time | Action | Criteria | Target WhatsApp Group |
|---|---|---|---|
| **Every 15 mins** | Job Collection | Scrapes registered sources, deduplicates, classifies & scores | Database (`jobs_raw` & `jobs`) |
| **9:00 AM** | Tech Jobs Batch | Top 5 `TECH` jobs with `score >= 70` | `💻 Tech Jobs` |
| **1:00 PM** | Internships Batch | Top 5 `INTERNSHIP` jobs with `score >= 70` | `🎓 Internships` |
| **5:00 PM** | Non-Tech Jobs Batch | Top 5 `NON_TECH` jobs with `score >= 70` | `🏢 Non-Tech Jobs` |
| **8:00 PM** | Daily Digest | Top 3 Tech + Top 2 Internships + Top 2 Non-Tech | `🔥 Today's Best Opportunities` |

---

## 🧪 Testing

Run the automated test suite anytime:
```bash
npm test
```
Verifies:
- SHA-256 deduplication and whitespace normalization invariance
- Rule classification across 6 categories (TECH, NON_TECH, INTERNSHIP, GOVT, COHORT, REFERRAL)
- 1-100 Scoring rubric & reasoning
- WhatsApp single alert formatting with emojis, links & hashtags
- WhatsApp Daily Digest aggregation
- Live ATS Career board scraper execution
