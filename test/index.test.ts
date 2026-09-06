import { generateJobHash, normalizeText } from '../src/jobs/deduplicate.js';
import { classifyJob } from '../src/ai/classify.js';
import { scoreJob } from '../src/ai/score.js';
import { formatWhatsAppJobMessage, formatDailyDigestMessage } from '../src/ai/formatter.js';
import { CareersScraper } from '../src/scrapers/careers/careers.scraper.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n==================================================');
  console.log('🧪 RUNNING JOB AUTOMATION SYSTEM TEST SUITE');
  console.log('==================================================\n');

  // ----------------------------------------------------
  // TEST SUITE 1: Deduplication & Hashing
  // ----------------------------------------------------
  console.log('📦 1. Testing Deduplication & Hash Generator:');
  {
    const h1 = generateJobHash('Microsoft', 'Software Engineer', 'Hyderabad');
    const h2 = generateJobHash(' microsoft  ', 'software  engineer ', 'HYDERABAD');
    const h3 = generateJobHash('Google', 'Software Engineer', 'Hyderabad');

    assert(h1 === h2, 'Normalized identical company+title+location produce identical SHA-256 hash');
    assert(h1 !== h3, 'Different company produces different hash');
    assert(h1.length === 64, 'SHA-256 hash length is exactly 64 hex characters');

    const normalized = normalizeText('  Senior React.js & Node.js Developer!!  ');
    assert(normalized === 'senior react js node js developer', 'Text normalization strips extra punctuation and spaces');
  }

  // ----------------------------------------------------
  // TEST SUITE 2: Rule Classification Engine
  // ----------------------------------------------------
  console.log('\n🧠 2. Testing Classification Engine:');
  {
    const techJob = await classifyJob('Senior Frontend Engineer (React/TypeScript)', 'Building scalable web applications');
    assert(techJob.category === 'TECH', `Classified "Frontend Engineer" as TECH (got ${techJob.category})`);

    const internJob = await classifyJob('Software Engineering Intern', 'Summer 2026 internship for university students');
    assert(internJob.category === 'INTERNSHIP', `Classified "Software Engineering Intern" as INTERNSHIP (got ${internJob.category})`);

    const nonTechJob = await classifyJob('Growth Marketing Manager', 'Driving customer acquisition and paid campaigns');
    assert(nonTechJob.category === 'NON_TECH', `Classified "Growth Marketing Manager" as NON_TECH (got ${nonTechJob.category})`);

    const govtJob = await classifyJob('UPSC Assistant Engineer Recruitment', 'Official government notification for engineering post');
    assert(govtJob.category === 'GOVT', `Classified "UPSC" as GOVT (got ${govtJob.category})`);

    const cohortJob = await classifyJob('AI & Web3 Builder Bootcamp Cohort', '8-week intensive training program');
    assert(cohortJob.category === 'COHORT', `Classified "Bootcamp Cohort" as COHORT (got ${cohortJob.category})`);

    const referralJob = await classifyJob('Google SDE-2 Employee Referral Opening', 'Reach out for employee referral');
    assert(referralJob.category === 'REFERRAL', `Classified "Referral Opening" as REFERRAL (got ${referralJob.category})`);
  }

  // ----------------------------------------------------
  // TEST SUITE 3: Scoring Engine
  // ----------------------------------------------------
  console.log('\n⭐ 3. Testing Scoring Engine:');
  {
    const topTierScore = await scoreJob({
      title: 'Backend Software Engineer',
      company: 'Microsoft',
      location: 'Hyderabad',
      description: 'Building cloud infrastructure on Azure with Go and Kubernetes. Remote friendly.',
      isRemote: true,
      category: 'TECH',
    });

    assert(topTierScore.score >= 70, `Top Tier company with remote score is >= 70 (got ${topTierScore.score})`);
    assert(typeof topTierScore.reasoning === 'string' && topTierScore.reasoning.length > 0, 'Scoring contains explanatory reasoning');
  }

  // ----------------------------------------------------
  // TEST SUITE 4: WhatsApp Message Formatter
  // ----------------------------------------------------
  console.log('\n💬 4. Testing WhatsApp Message Formatter:');
  {
    const formatted = formatWhatsAppJobMessage({
      title: 'Software Engineer (Backend)',
      company: 'Microsoft',
      location: 'Hyderabad',
      experience: 'Freshers / 0-2 Years',
      isRemote: true,
      skills: ['Go', 'Kubernetes', 'Azure'],
      url: 'https://careers.microsoft.com/job/12345',
      category: 'TECH',
      score: 88,
    });

    assert(formatted.includes('💻 *Software Engineer (Backend)*'), 'Contains emoji and bold title');
    assert(formatted.includes('🏢 *Company:* Microsoft'), 'Contains company name');
    assert(formatted.includes('📍 *Location:* Hyderabad'), 'Contains location');
    assert(formatted.includes('⭐ *Match Score:* 88/100'), 'Contains match score');
    assert(formatted.includes('https://careers.microsoft.com/job/12345'), 'Contains application URL');
    assert(formatted.includes('#TechJobs'), 'Contains relevant category hashtag');

    // Test Daily Digest
    const digest = formatDailyDigestMessage({
      date: '06 Sep 2026',
      techJobs: [
        { title: 'Full Stack Dev', company: 'Razorpay', location: 'Bangalore', url: 'https://razorpay.com/job/1', score: 92 },
      ],
      internships: [
        { title: 'Frontend Intern', company: 'Swiggy', location: 'Remote', url: 'https://swiggy.com/job/2', score: 85 },
      ],
      nonTechJobs: [
        { title: 'Product Specialist', company: 'Zepto', location: 'Mumbai', url: 'https://zepto.com/job/3', score: 78 },
      ],
      totalCount: 3,
    });

    assert(digest.includes("🔥 *TODAY'S BEST OPPORTUNITIES DIGEST* 🔥"), 'Digest has proper header');
    assert(digest.includes('💻 *TOP TECH JOBS:*'), 'Digest contains Tech section');
    assert(digest.includes('🎓 *TOP INTERNSHIPS:*'), 'Digest contains Internships section');
    assert(digest.includes('🏢 *TOP NON-TECH & BUSINESS ROLES:*'), 'Digest contains Non-Tech section');
  }

  // ----------------------------------------------------
  // TEST SUITE 5: Live Careers Scraper Test (Greenhouse / Lever ATS)
  // ----------------------------------------------------
  console.log('\n🌐 5. Testing Careers Scraper (Direct ATS API):');
  {
    try {
      const careersScraper = new CareersScraper();
      const jobs = await careersScraper.execute();
      assert(Array.isArray(jobs), 'Careers scraper returns an array');
      console.log(`     -> Live scraped ${jobs.length} direct company career jobs!`);
      if (jobs.length > 0) {
        console.log(`     -> Sample Job: "${jobs[0].title}" at ${jobs[0].company} (${jobs[0].location})`);
        assert(jobs[0].url.startsWith('http'), 'Job URL is valid absolute URL');
      }
    } catch (err) {
      console.warn('     -> Careers scraper skipped network test or encountered timeout: %s', (err as Error).message);
    }
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n==================================================');
  console.log(`🏁 TEST RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
