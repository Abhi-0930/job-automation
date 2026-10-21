import { ScoringResult } from '../types/job.js';
import { deepSeekService } from './client.js';
import { logger } from '../config/logger.js';

const TOP_TIER_COMPANIES = [
  'google', 'microsoft', 'amazon', 'apple', 'meta', 'netflix', 'uber', 'stripe',
  'razorpay', 'swiggy', 'zepto', 'zomato', 'atlassian', 'postman', 'cred',
  'flipkart', 'airbnb', 'oracle', 'salesforce', 'adobe', 'cisco', 'nvidia',
];

/**
 * Scores a job opportunity from 1 to 100 using DeepSeek AI or intelligent heuristics fallback.
 */
export async function scoreJob(params: {
  title: string;
  company: string;
  location: string;
  description: string;
  isRemote?: boolean;
  category?: string;
  experience?: string;
  isFresherEligible?: boolean;
}): Promise<ScoringResult> {
  const { title, company, location, description, isRemote, category, experience, isFresherEligible } = params;

  // STRICT FILTER: If job requires senior/experienced (>1 year), drop score below publishing threshold
  if (isFresherEligible === false) {
    return {
      score: 35,
      reasoning: 'Disqualified: Requires experienced candidate (>1 year). Community is focused on Freshers & 0-1 Yr graduates.',
      fresherFriendlyScore: 0,
    };
  }

  // 1. Try DeepSeek AI Scoring
  if (deepSeekService.hasApiKey()) {
    try {
      const aiScore = await scoreWithDeepSeek({
        title,
        company,
        location,
        description,
        category,
      });

      if (aiScore) {
        return aiScore;
      }
    } catch (err) {
      logger.warn('DeepSeek AI scoring failed, using heuristic scoring: %s', (err as Error).message);
    }
  }

  // 2. Intelligent Heuristic Scoring Fallback
  return calculateHeuristicScore({
    title,
    company,
    location,
    description,
    isRemote,
    category,
    isFresherEligible,
  });
}

async function scoreWithDeepSeek(job: {
  title: string;
  company: string;
  location: string;
  description: string;
  category?: string;
}): Promise<ScoringResult | null> {
  const systemPrompt = `You are an expert career advisor scoring job opportunities for a curated WhatsApp community.
Score the role using the available evidence. For government vacancies, assess recruiting-body credibility, eligibility and age-limit clarity, application deadline, and role relevance; do not penalize a government post for lacking remote work or private-sector compensation details. For private-sector roles, assess employer credibility, entry-level access, work arrangement, and career growth.
Use only information present in the title and description. Do not assume age limits or eligibility when they are not stated.

Output JSON only with this structure:
{
  "score": number, // integer from 1 to 100
  "reasoning": "1-2 concise sentences explaining why this job scored high or low",
  "companyReputationScore": number,
  "fresherFriendlyScore": number,
  "remoteScore": number,
  "careerGrowthScore": number
}`;

  const userPrompt = `Score this opportunity:
Company: ${job.company}
Category: ${job.category || 'Unknown'}
Title: ${job.title}
Location: ${job.location}
Description: ${job.description.slice(0, 1000)}`;

  const response = await deepSeekService.chatCompletion({
    systemPrompt,
    userPrompt,
    jsonResponse: true,
    temperature: 0.2,
  });

  if (!response) return null;

  try {
    const data = JSON.parse(response);
    const score = Math.min(100, Math.max(1, Math.round(data.score || 70)));

    return {
      score,
      reasoning: data.reasoning || 'High quality vetted opportunity.',
      companyReputationScore: data.companyReputationScore,
      fresherFriendlyScore: data.fresherFriendlyScore,
      remoteScore: data.remoteScore,
      careerGrowthScore: data.careerGrowthScore,
    };
  } catch {
    return null;
  }
}

function calculateHeuristicScore(job: {
  title: string;
  company: string;
  location: string;
  description: string;
  isRemote?: boolean;
  category?: string;
  isFresherEligible?: boolean;
}): ScoringResult {
  let score = 60; // Base score
  const companyLower = job.company.toLowerCase();
  const textLower = `${job.title} ${job.description} ${job.location}`.toLowerCase();

  // 1. Freshers / 0-1 Year accessibility (+20 bonus)
  if (
    job.isFresherEligible ||
    job.category === 'INTERNSHIP' ||
    textLower.includes('fresher') ||
    textLower.includes('intern') ||
    textLower.includes('0-1') ||
    textLower.includes('graduate trainee')
  ) {
    score += 20;
  }

  // 2. Company reputation (+5 to +10 - balanced to prevent single-company monopolies)
  if (TOP_TIER_COMPANIES.some((top) => companyLower.includes(top))) {
    score += 10;
  } else if (companyLower.length > 2) {
    score += 5;
  }

  // 3. Remote availability (+10)
  if (job.isRemote || textLower.includes('remote') || textLower.includes('work from home')) {
    score += 10;
  }

  // 4. High demand in-market skills (+10)
  if (/\b(react|typescript|python|golang|ai|devops|aws|sql|node|frontend|backend|fullstack|java|c\+\+)\b/i.test(textLower)) {
    score += 10;
  }

  // Cap between 40 and 98
  const finalScore = Math.min(98, Math.max(40, score));

  return {
    score: finalScore,
    reasoning: `High match for Freshers & 0-1 Year graduates: ${job.company} offering ${job.title} (${job.isRemote ? 'Remote' : job.location}).`,
  };
}
