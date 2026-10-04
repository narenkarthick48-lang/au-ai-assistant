// University integration layer: the ONLY file that knows about the source.
// Normalized shapes are documented in services.js validate(). Return null = not provided.
export class SourceUnavailable extends Error {}
export class VerificationFailed extends Error {}
export class VerificationRequired extends Error {} // upstream demands CAPTCHA/OTP etc.
export class InvalidResponse extends Error {}
export const SECTIONS = ['profile','results','timetable','exams','courses','attendance','fees','notifications'];

// ---------- DEVELOPMENT ONLY (AU_MODE != live): demo data, not real student data ----------
const sub = (code, name, i, e) => { const t = i + e; return { code, name, internal: i, external: e, total: t, grade: e < 20 ? 'RA' : t >= 75 ? 'A' : t >= 60 ? 'B' : 'C', result: e < 20 ? 'Fail' : 'Pass' }; };
const MOCK = {
  profile: { name: 'Demo Student', regNo: '410021001', rollNo: 'CSE21001', programme: 'B.E. Computer Science and Engineering', department: 'Computer Science and Engineering', faculty: 'Faculty of Engineering and Technology', academicYear: '2025-26', semester: 5 },
  results: [
    { semester: 3, status: 'Pass', subjects: [sub('CS301','Data Structures',22,58), sub('CS302','Discrete Mathematics',20,49), sub('CS303','Digital Logic',24,61)] },
    { semester: 4, status: 'Pass with arrears', subjects: [sub('CS401','Operating Systems',23,55), sub('CS402','Database Management Systems',21,43), sub('CS403','Computer Networks',12,19)] }],
  timetable: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].slice(0,5).flatMap((day, i) => [
    { day, time: '09:00-10:00', subject: ['Compiler Design','Software Engineering','Machine Learning','Cloud Computing','Compiler Design'][i], room: 'B-20' + i, faculty: 'Faculty ' + (i + 1) },
    { day, time: '10:00-11:00', subject: ['Machine Learning','Cloud Computing','Compiler Design','Software Engineering','Machine Learning'][i], room: 'B-20' + i, faculty: 'Faculty ' + (i + 2) }]),
  exams: [
    { date: '2026-09-12', subject: 'Internal Assessment 1', session: 'FN', semester: 5, type: 'Internal' },
    { date: '2026-11-10', subject: 'Compiler Design', session: 'FN', semester: 5, type: 'Semester' },
    { date: '2026-11-14', subject: 'Machine Learning', session: 'AN', semester: 5, type: 'Semester' }],
  courses: [
    { code: 'CS501', name: 'Compiler Design', credits: 4, semester: 5 }, { code: 'CS502', name: 'Machine Learning', credits: 4, semester: 5 },
    { code: 'CS503', name: 'Cloud Computing', credits: 3, semester: 5 }, { code: 'CS504', name: 'Software Engineering', credits: 3, semester: 5 }],
  attendance: [
    { subject: 'Compiler Design', present: 38, absent: 4, percentage: 90.5 }, { subject: 'Machine Learning', present: 33, absent: 9, percentage: 78.6 }],
  // fees intentionally absent -> exercises the "unavailable" state
  notifications: [
    { id: 'n1', title: 'Semester exam timetable released', date: '2026-10-01', body: 'November semester examination schedule is now available.' },
    { id: 'n2', title: 'Fee payment last date', date: '2026-09-28', body: 'Last date for tuition fee payment has been extended.' }]
};
class MockAdapter {
  mode = 'demo';
  async verify(id, p) { if (!['410021001', 'CSE21001'].includes(id.toUpperCase()) || p?.dob !== '2000-01-01') throw new VerificationFailed(); }
  async fetch(section) { await new Promise(r => setTimeout(r, 250)); return MOCK[section] ?? null; }
}

// ---------- PRODUCTION: authorized university API (credentials server-side only) ----------
// Never automate around CAPTCHA/OTP/login. If upstream needs it, respond 428 -> VerificationRequired.
class LiveAdapter {
  mode = 'live';
  constructor() {
    this.base = process.env.AU_API_BASE; this.key = process.env.AU_API_KEY;
    if (!this.base || !this.key) throw new SourceUnavailable('AU_API_BASE / AU_API_KEY not configured');
  }
  async #get(path, params) {
    let res;
    try { res = await fetch(`${this.base}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(10000) }); }
    catch { throw new SourceUnavailable('network/timeout'); }
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new VerificationFailed();
    if (res.status === 428) throw new VerificationRequired();
    if (!res.ok) throw new SourceUnavailable('upstream ' + res.status);
    try { return await res.json(); } catch { throw new InvalidResponse('bad json'); }
  }
  async verify(id, p) { await this.#get('/verify', { id, ...p }); }
  // Map the real payload to the normalized shape here (field names in one place).
  async fetch(section, id) { return this.#get('/' + section, { id }); }
}
export const getAdapter = () => (process.env.AU_MODE === 'live' ? new LiveAdapter() : new MockAdapter());
