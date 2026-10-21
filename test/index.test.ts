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
    const seniorTechJob = await classifyJob('Senior Frontend Engineer (5+ Years)', 'Lead team building scalable web apps');
    assert(seniorTechJob.category === 'TECH', `Classified "Frontend Engineer" as TECH (got ${seniorTechJob.category})`);
    assert(seniorTechJob.isFresherEligible === false, 'Senior 5+ Years job correctly marked as isFresherEligible = false');

    const fresherTechJob = await classifyJob('Associate Software Engineer (0-1 Year / Freshers)', 'Looking for fresh graduates proficient in React');
    assert(fresherTechJob.category === 'TECH', 'Classified Associate as TECH');
    assert(fresherTechJob.isFresherEligible === true, 'Fresher job correctly marked as isFresherEligible = true');

    const internJob = await classifyJob('Software Engineering Intern', 'Summer 2026 internship for university students');
    assert(internJob.category === 'INTERNSHIP', `Classified "Software Engineering Intern" as INTERNSHIP (got ${internJob.category})`);
    assert(internJob.isFresherEligible === true, 'Internship marked as isFresherEligible = true');

    const nonTechJob = await classifyJob('Marketing Associate (Freshers)', 'Content creation and social media');
    assert(nonTechJob.category === 'NON_TECH', `Classified "Marketing Associate" as NON_TECH (got ${nonTechJob.category})`);

    const govtJob = await classifyJob('UPSC Assistant Engineer Recruitment', 'Official government notification for engineering post');
    assert(govtJob.category === 'GOVT', `Classified "UPSC" as GOVT (got ${govtJob.category})`);

    const cohortJob = await classifyJob('AI & Web3 Builder Bootcamp Cohort', '8-week intensive training program');
    assert(cohortJob.category === 'COHORT', `Classified "Bootcamp Cohort" as COHORT (got ${cohortJob.category})`);

    const referralJob = await classifyJob('Google SDE-2 Employee Referral Opening', 'Reach out for employee referral');
    assert(referralJob.category === 'REFERRAL', `Classified "Referral Opening" as REFERRAL (got ${referralJob.category})`);
  }

  // ----------------------------------------------------
  // TEST SUITE 3: Scoring & Fresher Filtering Engine
  // ----------------------------------------------------
  console.log('\n⭐ 3. Testing Scoring Engine & Fresher Disqualification:');
  {
    const seniorJobScore = await scoreJob({
      title: 'Principal Software Engineer (8+ Yrs)',
      company: 'Amazon',
      location: 'Hyderabad',
      description: 'Senior leadership role with 8+ years experience required.',
      isFresherEligible: false,
    });
    assert(seniorJobScore.score <= 40, `Senior job (>1 yr) disqualified with score <= 40 (got ${seniorJobScore.score})`);

    const fresherScore = await scoreJob({
      title: 'Junior Software Engineer (Freshers / 0-1 Yr)',
      company: 'Razorpay',
      location: 'Bengaluru',
      description: 'Entry level role for 2024/2025 graduates with React and Node.js skills.',
      isRemote: true,
      category: 'TECH',
      isFresherEligible: true,
    });

    assert(fresherScore.score >= 70, `Fresher job meets publishing threshold >= 70 (got ${fresherScore.score})`);
    assert(typeof fresherScore.reasoning === 'string' && fresherScore.reasoning.length > 0, 'Scoring contains explanatory reasoning');
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

    // Test Govt job format (omits match score and hashtags)
    const govtFormatted = formatWhatsAppJobMessage({
      title: 'Station Master',
      company: 'Railway Recruitment Control Board',
      location: 'India',
      experience: 'Freshers / 0-2 Years',
      url: 'https://rrcb.gov.in/job/1',
      category: 'GOVT',
      score: 95,
      qualification: 'Graduate',
      ageLimit: '18-33 Years',
      lastDate: '30/11/2026',
    });

    assert(govtFormatted.includes('🏛️ *Station Master*'), 'Govt alert has title');
    assert(!govtFormatted.includes('Match Score'), 'Govt alert omits match score');
    assert(!govtFormatted.includes('#GovtJobs') && !govtFormatted.includes('#SarkariNaukri'), 'Govt alert omits hashtags');
    assert(govtFormatted.includes('📚 *Qualification:* Graduate'), 'Govt alert includes qualification');
    assert(govtFormatted.includes('🎂 *Age Limit:* 18-33 Years'), 'Govt alert includes age limit');
    assert(govtFormatted.includes('⏳ *Last Date to Apply:* 30/11/2026'), 'Govt alert includes last date');

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
