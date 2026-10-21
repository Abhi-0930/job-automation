import { JobCategory, DailyDigestPayload } from '../types/job.js';

interface FormatJobParams {
  title: string;
  company: string;
  location: string;
  experience?: string;
  batchLine?: string;
  isRemote?: boolean;
  skills?: string[];
  url: string;
  category: JobCategory;
  score?: number;
  qualification?: string;
  ageLimit?: string;
  lastDate?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

const CATEGORY_EMOJIS: Record<JobCategory, string> = {
  TECH: '💻',
  NON_TECH: '🏢',
  INTERNSHIP: '🎓',
  GOVT: '🏛️',
  COHORT: '📚',
  REFERRAL: '🤝',
  UNKNOWN: '🚀',
};

const CATEGORY_HASHTAGS: Record<JobCategory, string> = {
  TECH: '#TechJobs #HiringAlert #Developers',
  NON_TECH: '#NonTechJobs #Careers #Hiring',
  INTERNSHIP: '#Internships #CollegeHiring #Freshers',
  GOVT: '#GovtJobs #SarkariNaukri #Notification',
  COHORT: '#Upskilling #Cohort #Webinars',
  REFERRAL: '#Referrals #Networking #Jobs',
  UNKNOWN: '#JobAlert #HiringNow',
};

/**
 * Formats a clean, high-converting WhatsApp message for an individual job posting.
 */
export function formatWhatsAppJobMessage(params: FormatJobParams): string {
  const { title, company, location, experience, batchLine, isRemote, skills, url, category, score } = params;
  const emoji = CATEGORY_EMOJIS[category] || '🚀';
  const hashtags = CATEGORY_HASHTAGS[category] || '#JobAlert';

  const remoteTag = isRemote ? ' (🌐 Remote / WFH)' : '';
  const skillsLine = skills && skills.length > 0 ? `🎯 *Skills:* ${skills.join(', ')}\n` : '';
  const scoreLine = score && score >= 80 ? `⭐ *Match Score:* ${score}/100\n` : '';
  const expLine = experience || (category === 'INTERNSHIP' ? 'Students / Interns' : 'Freshers / 0-2 Years');
  const eligibilityLine = batchLine
    ? `🎓 *Eligibility:* ${batchLine}\n`
    : `🎓 *Eligibility:* ${category === 'INTERNSHIP' ? 'Batches 2025, 2026, 2027, 2028, 2029, 2030 (College Students)' : 'Batches 2024, 2025, 2026 & 0-2 Yrs'}\n`;

  // Parse qualification, age limit, and last date (especially for Government & PSU vacancies)
  const meta = (params.metadata || {}) as Record<string, string>;
  let qual = params.qualification || meta.qualification || '';
  let age = params.ageLimit || meta.ageLimit || '';
  let expiry = params.lastDate || meta.lastDate || '';

  const fullDesc = `${params.description || ''} ${title}`;

  if (!qual && category === 'GOVT') {
    const qMatch = fullDesc.match(/\b(?:qualification|education|degree)\s*[:\-–]\s*([^.\n;]+)/i);
    if (qMatch) qual = qMatch[1].trim();
  }

  if (!age && category === 'GOVT') {
    const aMatch = fullDesc.match(/\b(?:age\s*limit|age)\s*[:\-–]\s*([0-9]{1,2}\s*[-–to]+\s*[0-9]{1,2}\s*(?:years?|yrs?)?|(?:max(?:imum)?|upto|under)\s*[0-9]{1,2}\s*(?:years?|yrs?))/i);
    if (aMatch) age = aMatch[1].trim();
  }

  if (!expiry) {
    const dMatch = fullDesc.match(/\b(?:last\s*date|deadline|closing\s*date|apply\s*by)\s*[:\-–]\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+[0-9]{4})?)/i);
    if (dMatch) expiry = dMatch[1].trim();
  }

  const qualLine = qual ? `📚 *Qualification:* ${qual}\n` : '';
  const ageLine = age ? `🎂 *Age Limit:* ${age}\n` : '';
  const expiryLine = expiry ? `⏳ *Last Date to Apply:* ${expiry}\n` : '';

  return (
    `${emoji} *${title.trim()}*\n` +
    `🏢 *${category === 'GOVT' ? 'Agency / PSU' : 'Company'}:* ${company.trim()}\n` +
    `📍 *Location:* ${location.trim()}${remoteTag}\n` +
    qualLine +
    ageLine +
    expiryLine +
    eligibilityLine +
    `💼 *Experience:* ${expLine}\n` +
    scoreLine +
    skillsLine +
    `\n🔗 *Apply Here:*\n${url.trim()}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${hashtags}`
  );
}

/**
 * Formats the 8:00 PM Daily Digest message summarizing top opportunities across all categories.
 */
export function formatDailyDigestMessage(payload: DailyDigestPayload): string {
  const { date, techJobs, internships, nonTechJobs, totalCount } = payload;

  let msg = `🔥 *TODAY'S BEST OPPORTUNITIES DIGEST* 🔥\n`;
  msg += `📅 *Date:* ${date}\n`;
  msg += `✨ *Total Curated Picks:* ${totalCount}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (techJobs.length > 0) {
    msg += `💻 *TOP TECH JOBS:*\n`;
    techJobs.forEach((job, idx) => {
      msg += `${idx + 1}. *${job.title}* at *${job.company}*\n`;
      msg += `   📍 ${job.location} | ⭐ ${job.score}/100\n`;
      msg += `   🔗 ${job.url}\n\n`;
    });
  }

  if (internships.length > 0) {
    msg += `🎓 *TOP INTERNSHIPS:*\n`;
    internships.forEach((job, idx) => {
      msg += `${idx + 1}. *${job.title}* at *${job.company}*\n`;
      msg += `   📍 ${job.location} | ⭐ ${job.score}/100\n`;
      msg += `   🔗 ${job.url}\n\n`;
    });
  }

  if (nonTechJobs.length > 0) {
    msg += `🏢 *TOP NON-TECH & BUSINESS ROLES:*\n`;
    nonTechJobs.forEach((job, idx) => {
      msg += `${idx + 1}. *${job.title}* at *${job.company}*\n`;
      msg += `   📍 ${job.location} | ⭐ ${job.score}/100\n`;
      msg += `   🔗 ${job.url}\n\n`;
    });
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👉 *Share with friends looking for jobs & internships!*\n`;
  msg += `#DailyDigest #JobAlerts #CareerGrowth`;

  return msg;
}
