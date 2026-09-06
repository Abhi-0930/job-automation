import { JobCategory, DailyDigestPayload } from '../types/job.js';

interface FormatJobParams {
  title: string;
  company: string;
  location: string;
  experience?: string;
  isRemote?: boolean;
  skills?: string[];
  url: string;
  category: JobCategory;
  score?: number;
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
  const { title, company, location, experience, isRemote, skills, url, category, score } = params;
  const emoji = CATEGORY_EMOJIS[category] || '🚀';
  const hashtags = CATEGORY_HASHTAGS[category] || '#JobAlert';

  const remoteTag = isRemote ? ' (🌐 Remote / WFH)' : '';
  const skillsLine = skills && skills.length > 0 ? `🎯 *Skills:* ${skills.join(', ')}\n` : '';
  const scoreLine = score && score >= 80 ? `⭐ *Match Score:* ${score}/100\n` : '';
  const expLine = experience || (category === 'INTERNSHIP' ? 'Students / Freshers' : '0-2 Years / Freshers');

  return (
    `${emoji} *${title.trim()}*\n` +
    `🏢 *Company:* ${company.trim()}\n` +
    `📍 *Location:* ${location.trim()}${remoteTag}\n` +
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
