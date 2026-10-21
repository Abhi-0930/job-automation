export type JobCategory =
  | 'TECH'
  | 'NON_TECH'
  | 'INTERNSHIP'
  | 'GOVT'
  | 'COHORT'
  | 'REFERRAL'
  | 'UNKNOWN';

export type JobStatus =
  | 'NEW'
  | 'CLASSIFIED'
  | 'SCORED'
  | 'QUEUED'
  | 'PUBLISHED'
  | 'FAILED'
  | 'ARCHIVED';

export type PublishStatus = 'SUCCESS' | 'FAILED' | 'SIMULATED';

export interface RawScrapedJob {
  source: 'linkedin' | 'internshala' | 'wellfound' | 'careers' | string;
  externalId?: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  salary?: string;
  experience?: string;
  isRemote?: boolean;
  skills?: string[];
  metadata?: Record<string, unknown>;
}

export interface ClassificationResult {
  category: JobCategory;
  subcategory?: string;
  isRemote?: boolean;
  experience?: string;
  batchLine?: string;
  isFresherEligible?: boolean;
  skills?: string[];
  confidence: number;
  source: 'RULE' | 'DEEPSEEK';
}

export interface ScoringResult {
  score: number;
  reasoning: string;
  companyReputationScore?: number;
  fresherFriendlyScore?: number;
  remoteScore?: number;
  careerGrowthScore?: number;
}

export interface FormattedJobMessage {
  jobId: string;
  category: JobCategory;
  groupName: string;
  text: string;
  targetUrl: string;
}

export interface DailyDigestPayload {
  date: string;
  techJobs: Array<{ title: string; company: string; location: string; url: string; score: number }>;
  internships: Array<{ title: string; company: string; location: string; url: string; score: number }>;
  nonTechJobs: Array<{ title: string; company: string; location: string; url: string; score: number }>;
  totalCount: number;
}
