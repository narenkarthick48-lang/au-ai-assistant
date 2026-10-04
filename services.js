// Service layer: validation + caching (studentService, resultService, ...) and aiService.
import { InvalidResponse, SECTIONS } from './au-adapter.js';
const TTL = 5 * 60e3;
const isObj = d => d && typeof d === 'object' && !Array.isArray(d);

function validate(name, d) {
  if (d == null) return null;
  if (name === 'profile' || name === 'fees') {
    if (!isObj(d) || (name === 'profile' && (!d.name || !d.regNo))) throw new InvalidResponse(name);
    return d;
  }
  if (!Array.isArray(d) || d.some(x => !isObj(x))) throw new InvalidResponse(name);
  if (name === 'results' && d.some(r => !Array.isArray(r.subjects) || r.semester == null)) throw new InvalidResponse(name);
  return d.length ? d : null;
}
export async function getSection(adapter, s, name, force = false) {
  if (!SECTIONS.includes(name)) throw new InvalidResponse(name);
  const c = s.cache[name];
  if (!force && c && Date.now() - c.at < TTL) return c.data;
  const data = validate(name, await adapter.fetch(name, s.student));
  s.cache[name] = { data, at: Date.now() };
  return data;
}
// Per-domain services (thin, so each can gain its own logic later)
export const studentService = (a, s, f) => getSection(a, s, 'profile', f);
export const resultService = (a, s, f) => getSection(a, s, 'results', f);
export const timetableService = (a, s, f) => getSection(a, s, 'timetable', f);
export const examService = (a, s, f) => getSection(a, s, 'exams', f);
export const courseService = (a, s, f) => getSection(a, s, 'courses', f);
export const attendanceService = (a, s, f) => getSection(a, s, 'attendance', f);
export const feeService = (a, s, f) => getSection(a, s, 'fees', f);
export const notificationService = (a, s, f) => getSection(a, s, 'notifications', f);

// ---------- aiService: intent + session context -> cards built only from returned data ----------
const na = v => v ?? '—';
const T = (title, head, rows, badge) => ({ kind: 'table', title, head, rows, badge });
const RULES = [['arrears', /fail|arrear|backlog/], ['passcount', /how many.*pass|passed/], ['results', /result|mark|grade|score/],
  ['timetable', /timetable|time table|schedule|classes/], ['exams', /exam/], ['courses', /subject|syllabus|credits/], ['attendance', /attend/],
  ['fees', /\bfees?\b|payment|dues?/], ['notifications', /notif|announce|news|circular/], ['department', /department|dept/],
  ['programme', /programme|program|course am i|studying|my course|about my course/], ['profile', /profile|detail|roll|register|who am i|my name/]];
const LABEL = { results: 'Result', timetable: 'Timetable', exams: 'Exam', courses: 'Course', attendance: 'Attendance', fees: 'Fee', notifications: 'Notification', profile: 'Profile', department: 'Profile', programme: 'Profile' };
export const intentOf = t => RULES.find(([, re]) => re.test(t.toLowerCase()))?.[0];

export async function respond(adapter, s, msg) {
  const ctx = s.ctx;
  const semM = /sem(?:ester)?\s*(\d{1,2})/i.exec(msg) || /what about\s*(\d{1,2})/i.exec(msg);
  const intent = intentOf(msg) || (semM && ctx.intent);
  if (!intent) return { text: 'I can help with results, marks, arrears, timetable, exams, subjects, attendance, fees, notifications and your profile. What would you like to know?', cards: [] };
  ctx.intent = intent; if (semM) ctx.sem = +semM[1];
  const gone = { text: `${LABEL[intent]} information is currently unavailable.`, cards: [] };
  const sv = { results: resultService, arrears: resultService, passcount: resultService, timetable: timetableService, exams: examService, courses: courseService,
    attendance: attendanceService, fees: feeService, notifications: notificationService, profile: studentService, department: studentService, programme: studentService }[intent];
  const d = await sv(adapter, s);
  if (!d) return gone;
  switch (intent) {
    case 'results': case 'arrears': case 'passcount': {
      const sorted = [...d].sort((a, b) => a.semester - b.semester);
      const pick = ctx.sem != null ? sorted.filter(r => +r.semester === ctx.sem) : intent === 'arrears' ? sorted : [sorted.at(-1)];
      if (!pick.length) { const w = ctx.sem; ctx.sem = null; return { text: `No result is available for semester ${w}. Available: ${sorted.map(r => r.semester).join(', ')}.`, cards: [] }; }
      if (pick.length === 1) ctx.sem = +pick[0].semester;
      const where = pick.length === 1 ? `semester ${pick[0].semester}` : 'your available results';
      const fails = pick.flatMap(r => r.subjects.filter(x => x.result !== 'Pass').map(x => [r.semester, x.code, x.name, x.total, x.grade]));
      if (intent === 'arrears') return fails.length ? { text: `You have ${fails.length} failed subject${fails.length > 1 ? 's' : ''} in ${where}:`, cards: [T('Arrears', ['Sem', 'Code', 'Subject', 'Total', 'Grade'], fails)] } : { text: `No failed subjects in ${where}.`, cards: [] };
      if (intent === 'passcount') { const n = pick.flatMap(r => r.subjects); return { text: `You passed ${n.filter(x => x.result === 'Pass').length} of ${n.length} subjects in ${where}.`, cards: [] }; }
      return { text: `Here is your result for ${where}:`, cards: pick.map(r => T(`Semester ${r.semester}`, ['Code', 'Subject', 'Internal', 'External', 'Total', 'Grade', 'Result'], r.subjects.map(x => [x.code, x.name, x.internal, x.external, x.total, x.grade, x.result].map(na)), r.status)) };
    }
    case 'department': return { text: `Your department is ${na(d.department)}.`, cards: [] };
    case 'programme': return { text: `You are studying ${na(d.programme)}${d.semester ? `, currently in semester ${d.semester}` : ''}.`, cards: [] };
    case 'profile': return { text: 'Here are your details:', cards: [{ kind: 'profile', fields: [['Name', d.name], ['Register number', d.regNo], ['Roll number', d.rollNo], ['Programme', d.programme], ['Department', d.department], ['Faculty', d.faculty], ['Academic year', d.academicYear], ['Semester', d.semester]].filter(f => f[1] != null) }] };
    case 'timetable': return { text: 'Your timetable:', cards: [T('Timetable', ['Day', 'Time', 'Subject', 'Room', 'Faculty'], d.map(x => [x.day, x.time, x.subject, x.room, x.faculty].map(na)))] };
    case 'exams': {
      const today = new Date().toISOString().slice(0, 10), up = d.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const row = e => [e.date, e.subject, e.session, e.semester, e.date >= today ? 'Upcoming' : 'Completed'].map(na);
      if (/next|upcoming/i.test(msg)) return up.length ? { text: `Your next exam is ${up[0].subject} on ${up[0].date}.`, cards: [T('Next exam', ['Date', 'Subject', 'Session', 'Sem', 'Status'], [row(up[0])])] } : { text: 'No upcoming exams are listed.', cards: [] };
      return { text: 'Your exams:', cards: [T('Exams', ['Date', 'Subject', 'Session', 'Sem', 'Status'], d.map(row))] };
    }
    case 'courses': return { text: 'Your subjects:', cards: [T('Subjects', ['Code', 'Subject', 'Credits', 'Sem'], d.map(x => [x.code, x.name, x.credits, x.semester].map(na)))] };
    case 'attendance': return { text: 'Your attendance:', cards: [T('Attendance', ['Subject', 'Present', 'Absent', '%'], d.map(x => [x.subject, x.present, x.absent, x.percentage].map(na)))] };
    case 'fees': return { text: 'Your fee status:', cards: [{ kind: 'profile', fields: [['Status', d.status], ['Amount due', d.amountDue], ['Paid', d.paid], ['Due date', d.dueDate]].filter(f => f[1] != null) }] };
    case 'notifications': return { text: 'Latest notifications:', cards: [T('Notifications', ['Date', 'Title', 'Details'], d.map(x => [x.date, x.title, x.body].map(na)))] };
  }
}
