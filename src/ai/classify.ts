import { JobCategory, ClassificationResult } from '../types/job.js';
import { deepSeekService } from './client.js';
import { logger } from '../config/logger.js';

interface RulePattern {
  category: JobCategory;
  regex: RegExp;
  weight: number;
}

const CLASSIFICATION_RULES: RulePattern[] = [
  // 1. Internship Rules (High Priority)
  {
    category: 'INTERNSHIP',
    regex: /\b(intern|internship|student trainee|apprentice|apprenticeship|graduate trainee|summer intern|fellow|fellowship)\b/i,
    weight: 10,
  },
  // 2. Government / PSU Rules
  {
    category: 'GOVT',
    regex: /\b(ssc|upsc|railway|rrb|ibps|sbi po|bank po|drdo|isro|psu|gate score|state psc|civil services|govt|government exam|recruitment board)\b/i,
    weight: 9,
  },
  // 3. Cohort / Upskilling / Hackathons
  {
    category: 'COHORT',
    regex: /\b(cohort|bootcamp|hackathon|webinar|workshop|accelerator|fellowship program|masterclass|training program)\b/i,
    weight: 8,
  },
  // 4. Referral / Internal Hiring
  {
    category: 'REFERRAL',
    regex: /\b(referral|refer me|internal opening|employee referral|referral drive)\b/i,
    weight: 8,
  },
  // 5. Tech Jobs
  {
    category: 'TECH',
    regex: /\b(software|developer|frontend|backend|fullstack|devops|sre|cloud|cybersecurity|data engineer|machine learning|ai engineer|qa engineer|test engineer|android|ios|react|reactjs|vue|angular|node|nodejs|python|java|c\+\+|golang|rust|typescript|javascript|database administrator|sql|aws|gcp|azure|sysadmin|security analyst|web developer|mobile app)\b/i,
    weight: 7,
  },
  // 6. Non-Tech / Business Jobs
  {
    category: 'NON_TECH',
    regex: /\b(marketing|sales|business development|operations|finance|accounting|accountant|human resources|hr executive|content writer|copywriter|graphic designer|ui\/ux|ux designer|customer support|customer success|product manager|program manager|analyst|executive assistant|legal|recruiter)\b/i,
    weight: 6,
  },
];

const SKILL_KEYWORDS = [
  'React', 'Node.js', 'TypeScript', 'JavaScript', 'Python', 'Java', 'C++', 'Golang',
  'AWS', 'Docker', 'Kubernetes', 'SQL', 'PostgreSQL', 'MongoDB', 'GraphQL', 'Next.js',
  'Figma', 'SEO', 'Salesforce', 'Excel', 'Tableau', 'Power BI', 'Git', 'Linux',
];

/**
 * Classifies a job using rules first, and falls back to DeepSeek AI if ambiguous.
 */
export async function classifyJob(title: string, description: string, location: string = ''): Promise<ClassificationResult> {
  const combinedText = `${title} ${description} ${location}`.toLowerCase();
  const expInfo = extractExperience(combinedText, 'UNKNOWN' as JobCategory);

  // 0. ABSOLUTE RULE: Any title mentioning intern/internship MUST be INTERNSHIP category
  if (/\b(intern|internship|summer intern|student trainee|apprentice|apprenticeship)\b/i.test(title)) {
    const specificExp = extractExperience(combinedText, 'INTERNSHIP');
    return {
      category: 'INTERNSHIP',
      isRemote: combinedText.includes('remote') || combinedText.includes('work from home'),
      experience: specificExp.label,
      batchLine: specificExp.batchLine,
      isFresherEligible: true,
      skills: extractSkills(combinedText),
      confidence: 1.0,
      source: 'RULE',
    };
  }
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.regex.test(title)) {
      // Title match has highest confidence
      const specificExp = extractExperience(combinedText, rule.category);
      return {
        category: rule.category,
        isRemote: combinedText.includes('remote') || combinedText.includes('work from home'),
        experience: specificExp.label,
        batchLine: specificExp.batchLine,
        isFresherEligible: specificExp.isFresherEligible,
        skills: extractSkills(combinedText),
        confidence: 0.95,
        source: 'RULE',
      };
    }
  }

  // Check description with rule engine
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.regex.test(description)) {
      const specificExp = extractExperience(combinedText, rule.category);
      return {
        category: rule.category,
        isRemote: combinedText.includes('remote') || combinedText.includes('work from home'),
        experience: specificExp.label,
        batchLine: specificExp.batchLine,
        isFresherEligible: specificExp.isFresherEligible,
        skills: extractSkills(combinedText),
        confidence: 0.8,
        source: 'RULE',
      };
    }
  }

  // 2. AI Fallback with DeepSeek
  if (deepSeekService.hasApiKey()) {
    try {
      const aiResult = await classifyWithDeepSeek(title, description);
      if (aiResult) {
        aiResult.batchLine = expInfo.batchLine;
        return aiResult;
      }
    } catch (err) {
      logger.warn('DeepSeek AI classification fallback failed: %s', (err as Error).message);
    }
  }

  // 3. Default Heuristic Fallback
  return {
    category: 'TECH', // Defaulting to Tech if unclassified
    isRemote: combinedText.includes('remote'),
    experience: expInfo.label,
    batchLine: expInfo.batchLine,
    isFresherEligible: expInfo.isFresherEligible,
    skills: extractSkills(combinedText),
    confidence: 0.5,
    source: 'RULE',
  };
}

async function classifyWithDeepSeek(title: string, description: string): Promise<ClassificationResult | null> {
  const systemPrompt = `You are a precision job classification AI for a WhatsApp job distribution community focused on Freshers and 0-1 year graduates.
Analyze the job title and description and output JSON only with this structure:
{
  "category": "TECH" | "NON_TECH" | "INTERNSHIP" | "GOVT" | "COHORT" | "REFERRAL",
  "subcategory": "Frontend" | "Backend" | "Marketing" | etc.,
  "isRemote": boolean,
  "experience": "Freshers" | "0-1 Years" | "2+ Years",
  "isFresherEligible": boolean,
  "skills": ["Skill1", "Skill2"]
}`;

  const userPrompt = `Classify this opportunity:
Title: ${title}
Description: ${description.slice(0, 800)}`;

  const response = await deepSeekService.chatCompletion({
    systemPrompt,
    userPrompt,
    jsonResponse: true,
    temperature: 0.1,
  });

  if (!response) return null;

  try {
    const data = JSON.parse(response);
    const validCategories: JobCategory[] = ['TECH', 'NON_TECH', 'INTERNSHIP', 'GOVT', 'COHORT', 'REFERRAL'];
    const category = validCategories.includes(data.category) ? (data.category as JobCategory) : 'TECH';

    return {
      category,
      subcategory: data.subcategory,
      isRemote: !!data.isRemote,
      experience: data.experience || 'Freshers / 0-1 Yr',
      isFresherEligible: data.isFresherEligible !== undefined ? !!data.isFresherEligible : true,
      skills: Array.isArray(data.skills) ? data.skills : [],
      confidence: 0.9,
      source: 'DEEPSEEK',
    };
  } catch {
    return null;
  }
}

export function extractExperience(text: string, category: JobCategory): { label: string; isFresherEligible: boolean; batchLine: string } {
  // 1. Definite senior / experienced patterns (>2 years, Senior, Lead, Staff, Principal, Manager, etc.)
  const isSenior = /\b(senior|sr\.?\b|lead\b|principal|architect|staff\s*engineer|director|vp\b|head\s*of|manager|3\+?\s*years?|4\+?\s*years?|5\+?\s*years?|6\+?\s*years?|7\+?\s*years?|8\+?\s*years?|3\s*-\s*5\s*years?|3\s*to\s*5\s*years?|4\s*-\s*6\s*years?)\b/i.test(text);

  if (isSenior) {
    return { label: '3+ Years (Experienced)', isFresherEligible: false, batchLine: 'Experienced Professionals' };
  }

  // 2. Detect specific mentioned batches (2024, 2025, 2026, 2027, 2028, 2029, 2030)
  const detectedBatches: string[] = [];
  const batchMatches = text.match(/\b(202[4-9]|2030|batch\s*(?:of\s*)?['’]?(?:2[4-9]|30))\b/gi);
  if (batchMatches) {
    for (const m of batchMatches) {
      const digits = m.replace(/[^0-9]/g, '');
      const fullYear = digits.length === 2 ? `20${digits}` : digits;
      if (!detectedBatches.includes(fullYear) && parseInt(fullYear, 10) >= 2024 && parseInt(fullYear, 10) <= 2030) {
        detectedBatches.push(fullYear);
      }
    }
  }

  // 3. Internship (College Students: 2025, 2026, 2027, 2028, 2029, 2030)
  if (category === 'INTERNSHIP' || /\b(intern|internship|summer intern|student trainee|apprentice|apprenticeship)\b/i.test(text)) {
    const batches = detectedBatches.length > 0
      ? detectedBatches.sort().join(', ')
      : '2025, 2026, 2027, 2028, 2029, 2030 (College Students)';
    return {
      label: 'College Students & Interns',
      isFresherEligible: true,
      batchLine: `Batches ${batches}`,
    };
  }

  // 4. Freshers & Early Career (0-2 Years: Batches 2024, 2025, 2026)
  const batches = detectedBatches.length > 0
    ? detectedBatches.sort().join(', ')
    : '2024, 2025, 2026 & 0-2 Years Exp';

  return {
    label: 'Freshers / 0-2 Years',
    isFresherEligible: true,
    batchLine: `Batches ${batches}`,
  };
}

function extractSkills(text: string): string[] {
  const found: string[] = [];
  for (const skill of SKILL_KEYWORDS) {
    const regex = new RegExp(`\\b${skill.replace(/[.+]/g, '\\$&')}\\b`, 'i');
    if (regex.test(text)) {
      found.push(skill);
      if (found.length >= 5) break;
    }
  }
  return found;
}
