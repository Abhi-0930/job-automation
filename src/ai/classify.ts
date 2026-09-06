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

  // 1. Check Rule Engine
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.regex.test(title)) {
      // Title match has highest confidence
      return {
        category: rule.category,
        isRemote: combinedText.includes('remote') || combinedText.includes('work from home'),
        experience: extractExperience(combinedText, rule.category),
        skills: extractSkills(combinedText),
        confidence: 0.95,
        source: 'RULE',
      };
    }
  }

  // Check description with rule engine
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.regex.test(description)) {
      return {
        category: rule.category,
        isRemote: combinedText.includes('remote') || combinedText.includes('work from home'),
        experience: extractExperience(combinedText, rule.category),
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
    experience: extractExperience(combinedText, 'TECH'),
    skills: extractSkills(combinedText),
    confidence: 0.5,
    source: 'RULE',
  };
}

async function classifyWithDeepSeek(title: string, description: string): Promise<ClassificationResult | null> {
  const systemPrompt = `You are a precision job classification AI for a WhatsApp job distribution community.
Analyze the job title and description and output JSON only with this structure:
{
  "category": "TECH" | "NON_TECH" | "INTERNSHIP" | "GOVT" | "COHORT" | "REFERRAL",
  "subcategory": "Frontend" | "Backend" | "Marketing" | etc.,
  "isRemote": boolean,
  "experience": "Freshers" | "0-2 Years" | "2-5 Years" | "5+ Years",
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
      experience: data.experience || 'Freshers / 0-2 Years',
      skills: Array.isArray(data.skills) ? data.skills : [],
      confidence: 0.9,
      source: 'DEEPSEEK',
    };
  } catch {
    return null;
  }
}

function extractExperience(text: string, category: JobCategory): string {
  if (category === 'INTERNSHIP') return 'Students / Freshers';
  if (/\b(fresher|freshers|0\s*-\s*1\s*year|entry level|graduate)\b/i.test(text)) return 'Freshers / 0-1 Yr';
  if (/\b(1\s*-\s*3\s*years?|junior)\b/i.test(text)) return '1-3 Years';
  if (/\b(3\s*-\s*5\s*years?|mid)\b/i.test(text)) return '3-5 Years';
  if (/\b(5\+?\s*years?|senior|lead|principal)\b/i.test(text)) return '5+ Years (Senior)';
  return 'Freshers / 0-2 Years';
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
