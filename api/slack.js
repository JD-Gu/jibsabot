/**
 * [v16.0] 구대표집사봇(H&I) — 6대 시나리오 구현
 *
 * S1: 지시 전달 → 직원 회신 시 대표 자동 보고       ← send_message 강화
 * S2: 직원 DM → 간단 직답 / 대표 컨펌 → 전달        ← handleEmployee 신규
 * S3: 관심사 뉴스 검색 브리핑 (Gemini Google Search) ← search_news 신규
 * S4: 일정 요약 (Calendar + #noti-업무일정)          ← 기존 v15.7 유지
 * S5: 경영채널 재무 현황 요약                        ← 기존 유지
 * S6: 채널별 업무 맥락 요약 (채널 확장)              ← summarize_all_channels 신규
 *
 * ⚠️  Slack 앱 추가 구독 필요 (현재 미구독 시):
 *     message.im  — 직원 DM 수신 (S2)
 */

import crypto from 'crypto';

// ─── [1] HNI 마스터 데이터 ───────────────────────────────────────────

const HNI = {
  members: {
    '구자덕': { id: 'U02M1T5E1N3', email: '09jj@hni-gl.com',        dept: '경영진',   role: '대표이사' },
    '김다영': { id: 'U05CUH3GENN', email: 'kimdy@hni-gl.com',        dept: '상품관리', role: '프로' },
    '김민영': { id: 'U02MF3ANFF0', email: '10minyoung@hni-gl.com',   dept: '상품관리', role: '프로' },
    '김봉석': { id: 'U02M755FC0P', email: '24bong@hni-gl.com',       dept: '디바이스', role: '팀장' },
    '김인구': { id: 'U02M755LQHM', email: '05king@hni-gl.com',       dept: '서비스지원', role: '팀장' },
    '김찬영': { id: 'U02MMQVHM8T', email: '93cy@hni-gl.com',         dept: '디바이스', role: '프로' },
    '김훈지': { id: 'U02MMQV63RR', email: '73khj@hni-gl.com',        dept: '서비스지원', role: '프로' },
    '박인영': { id: 'U02MQ27A6CC', email: '54yy@hni-gl.com',         dept: '플랫폼',   role: '프로' },
    '이지민': { id: 'U02MMQ4B4M8', email: '95jimin@hni-gl.com',      dept: '상품관리', role: '팀장' },
    '이창현': { id: 'U04DX8YR8SC', email: 'lch9772@hni-gl.com',      dept: '디바이스', role: '프로' },
    '정명휘': { id: 'U02MMQ40LE6', email: '31jmh@hni-gl.com',        dept: '플랫폼',   role: '프로' },
    '정현수': { id: 'U02N0D92YE5', email: '25jhs@hni-gl.com',        dept: '플랫폼',   role: '팀장' },
    '지우현': { id: 'U02MJRGEP7F', email: '90jay@hni-gl.com',        dept: '플랫폼',   role: '프로' },
    '이종혁': { id: 'U02M86NGGM7', email: '99hyeoki@hni-gl.com',     dept: '제품본부', role: '본부장' }
  },

  knowledge: {
    companyName: '주식회사 에이치앤아이 (H&I)',
    botName: '구대표집사봇',
    coreTech: 'GNSS/RTK 초정밀 측위, HI-PPE v4.0 지능형 안전 장구, IoT 플랫폼, AI 비전 엣지, HI-RTK, U+ 초정밀측위 OEM',
    newsKeywords: ['GNSS', 'RTK', '초정밀측위', '스마트시티', '스마트건설'],

    /** §5.1 기존 3채널 — report_management_status tool enum과 동일 */
    management_channels: {
      finance:  { name: 'cmm-cxo',       id: 'C02M8BMJZG9' },
      sales:    { name: 'cmm-영업지원',   id: 'C06DRAHHAQZ' },
      calendar: { name: 'noti-업무일정',  id: 'C03R1QVMKC4' }
    },

    /** §5.1·5.2 전체 채널 — S6 summarize_all_channels용 */
    all_channels: {
      'cmm-cxo':        { name: 'cmm-cxo',        id: 'C02M8BMJZG9', category: 'management',  desc: 'CXO 경영보고' },
      'cmm-영업지원':    { name: 'cmm-영업지원',    id: 'C06DRAHHAQZ', category: 'sales',        desc: '영업지원' },
      'cmm-경영본부':    { name: 'cmm-경영본부',    id: 'C02MCB4UKFE', category: 'management',  desc: '경영본부 커뮤니케이션' },
      'dep-경영본부':    { name: 'dep-경영본부',    id: 'C03AKJHDB1S', category: 'department',  desc: '경영본부 업무' },
      'dep-제품본부':    { name: 'dep-제품본부',    id: 'C04DUNA7G4V', category: 'department',  desc: '제품본부 업무' },
      'dep-상품관리팀':  { name: 'dep-상품관리팀',  id: 'C039ZNCBU3X', category: 'department',  desc: '상품관리팀 업무' },
      'noti-업무일정':   { name: 'noti-업무일정',   id: 'C03R1QVMKC4', category: 'calendar',    desc: '업무일정 알림' },
      '기술팀':          { name: '기술팀',          id: 'C070CKJ4MB8', category: 'technical',   desc: 'GNSS·RTK 기술' },
      'dev-hi-ppe':      { name: 'dev-hi-ppe',      id: 'C036AMXRRKJ', category: 'technical',   desc: 'HI-PPE 개발' },
      'dev-hi-ccp':      { name: 'dev-hi-ccp',      id: 'C02MC1J5Q3Z', category: 'technical',   desc: 'HI-CCP 개발' },
      'ops-제품납품':    { name: 'ops-제품납품',    id: 'C065CMA6SUX', category: 'operations',  desc: '제품납품 현황' }
    },

    googleCalendarId: (process.env.GOOGLE_CALENDAR_ID || '09jj@hni-gl.com').trim()
  }
};

// ─── [2] Gemini 도구 선언 ────────────────────────────────────────────

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: 'report_management_status',
      description: '사내 CXO·경영보고(finance=#cmm-cxo), 영업지원(sales=#cmm-영업지원), 일정(calendar=구글캘린더+#noti-업무일정) 데이터를 조회·분석 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: 'finance|sales|calendar' },
          query: { type: 'STRING', description: 'calendar일 때: 오늘/내일/어제/모레 또는 YYYY-MM-DD' }
        },
        required: ['category']
      }
    },
    {
      name: 'send_message',
      description: '특정 직원에게 슬랙 DM을 즉시 보냅니다. 전달 후 직원의 회신은 자동으로 대표님께 보고됩니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name:    { type: 'STRING', description: '받는 사람 성함' },
          message: { type: 'STRING', description: '전달할 내용' }
        },
        required: ['name', 'message']
      }
    },
    {
      name: 'search_news',
      description: '회사 관심 분야(GNSS, RTK, IoT 안전장구, HI-RTK 등) 또는 지정 키워드로 최신 뉴스를 검색하여 브리핑합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          keywords: { type: 'STRING', description: '검색 키워드 (생략 시 회사 기본 관심 키워드 사용)' }
        },
        required: []
      }
    },
    {
      name: 'summarize_all_channels',
      description: '부서/운영/기술 등 전체(또는 지정 범위) 채널의 최근 업무 현황을 일괄 요약합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          scope: {
            type: 'STRING',
            enum: ['all', 'management', 'department', 'sales', 'operations', 'technical'],
            description: 'all=전체(기본), management=경영, department=부서, sales=영업, operations=운영, technical=기술'
          }
        },
        required: []
      }
    }
  ]
}];

// ─── [3] 보안 및 유틸리티 ────────────────────────────────────────────

function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp  = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  if (parseInt(timestamp) < Math.floor(Date.now() / 1000) - 300) return false;
  const hmac = crypto.createHmac('sha256', signingSecret)
                     .update(`v0:${timestamp}:${rawBody}`)
                     .digest('hex');
  return `v0=${hmac}` === signature;
}

async function slackApi(endpoint, body, token) {
  const isGet = endpoint.includes('.list') || endpoint.includes('.history') || endpoint.includes('.replies');
  let url = `https://slack.com/api/${endpoint}`;
  const headers = { Authorization: `Bearer ${token}` };
  let options;
  if (isGet) {
    if (body) url += '?' + new URLSearchParams(body).toString();
    options = { method: 'GET', headers };
  } else {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    options = { method: 'POST', headers, body: JSON.stringify(body) };
  }
  const r = await fetch(url, options);
  return r.json();
}

/** JSON 응답에서 마크다운 코드블록 제거 후 파싱 */
function parseGeminiJson(text) {
  if (!text) return null;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
    return null;
  }
}

function findMemberById(userId) {
  const entry = Object.entries(HNI.members).find(([, v]) => v.id === userId);
  return entry ? { name: entry[0], ...entry[1] } : null;
}

function resolveEmailsInText(text) {
  let t = text;
  for (const [name, { email }] of Object.entries(HNI.members)) {
    if (email) t = t.replace(new RegExp(email, 'gi'), name);
  }
  return t;
}

function memberNameFromEmail(email) {
  if (!email) return null;
  const lower = String(email).toLowerCase();
  const found = Object.entries(HNI.members).find(([, v]) => (v.email || '').toLowerCase() === lower);
  return found ? found[0] : null;
}

function formatCalendarEventTimeRange(ev) {
  const opts = { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false };
  if (ev.start?.date && !ev.start?.dateTime) {
    return `종일 (${ev.start.date})${ev.end?.date ? ` (종료일 ${ev.end.date})` : ''}`;
  }
  const s = ev.start?.dateTime;
  const e = ev.end?.dateTime;
  if (!s) return '시간 미정';
  const sStr = new Date(s).toLocaleString('ko-KR', opts);
  const eStr = e ? new Date(e).toLocaleString('ko-KR', opts) : '';
  return eStr ? `${sStr} ~ ${eStr}` : sStr;
}

function buildCalendarPeopleLine(ev) {
  const bits = [];
  if (ev.organizer?.email) {
    bits.push(`주최: ${memberNameFromEmail(ev.organizer.email) || ev.organizer.displayName || ev.organizer.email}`);
  }
  const others = (ev.attendees || [])
    .filter(a => a.responseStatus !== 'declined' && !a.organizer)
    .map(a => memberNameFromEmail(a.email) || a.displayName || a.email)
    .filter(Boolean);
  const unique = [...new Set(others)];
  if (unique.length) bits.push(`참석·게스트: ${unique.join(', ')}`);
  return bits.join(' | ');
}

function formatCalendarEventsAsMarkdown(events) {
  if (!events?.length) return '(해당일 Google Calendar API로 조회된 일정 없음 — Slack 알림만 참고하세요.)';
  return events.map((ev, i) => {
    const people = ev.peopleLine || '관련인원: API에 없음';
    const loc  = ev.location       ? `\n   • 장소: ${ev.location}`        : '';
    const note = ev.descriptionSnippet ? `\n   • 비고: ${ev.descriptionSnippet}` : '';
    return `${i + 1}. *${ev.title}*\n   • 시간: ${ev.time}${loc}\n   • ${people}${note}`;
  }).join('\n\n');
}

const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function messageMentionsKstDate(text, { y, m, d }) {
  if (!text) return false;
  const pad = n => String(n).padStart(2, '0');
  return [
    new RegExp(`${y}년\\s*${m}월\\s*${d}일`),
    new RegExp(`${y}[./]\\s*${pad(m)}[./]\\s*${pad(d)}\\b`),
    new RegExp(`\\b${MONTH_NAMES_EN[m - 1]}\\s+0?${d},\\s*${y}\\b`, 'i'),
    new RegExp(`(?:^|\\D)${m}월\\s*0?${d}일(?:\\D|$)`)
  ].some(r => r.test(text));
}

function messageMatchesCalendarDay(message, ymd) {
  const t = message?.text || '';
  if (messageMentionsKstDate(t, ymd)) return true;
  const ts = message?.ts;
  if (!ts) return false;
  const posted = getKstYmd(new Date(Math.floor(Number(ts) * 1000)));
  if (posted.y !== ymd.y || posted.m !== ymd.m || posted.d !== ymd.d) return false;
  if ((/\bToday\b|오늘의|오늘\s/i).test(t) && /calendar\s*:|캘린더\s*:|일정|Google|구글|\[외근\]|\[출장\]|\[회의\]/i.test(t)) return true;
  if (/Calendar\s*:|캘린더\s*:/i.test(t)) return true;
  return false;
}

function slackPlainForParse(t) {
  return (t || '').replace(/\*+/g, '').replace(/`/g, '').replace(/_{1,2}/g, '').trim();
}

function parseCalendarStructuredFromSlack(rawText) {
  const events = [];
  if (!rawText) return events;
  let currentCal = '';
  const calHeader = /^(?:Calendar|캘린더)\s*[:：]\s*`?([^`\n]+?)`?\s*$/i;
  for (const raw of rawText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const ch = line.match(calHeader);
    if (ch) { currentCal = ch[1].trim(); continue; }
    const timed = line.match(/^[\s*•◇▪︎\-\u2022]*((?:(?:오전|오후)\s*)?\d{1,2}:\d{2}(?:\s*(?:AM|PM))?(?:\s*[-–~]\s*(?:(?:오전|오후)\s*)?\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?)\s+(.+)$/);
    if (timed && timed[2]?.length > 2) {
      events.push({ calendar: currentCal || '—', time: timed[1].replace(/\s+/g, ' ').trim(), title: timed[2].trim() });
      continue;
    }
    if (/^\[(?:출장|외근|회의|연차|오후 반차)\]/.test(line) && line.length > 5) {
      events.push({ calendar: currentCal || '—', time: '종일·시각은 같은 메시지 참고', title: line.replace(/^[\s*•◇▪︎\-\u2022]+/, '').trim() });
    }
  }
  return events;
}

function dedupeParsedSlackEvents(list) {
  const seen = new Set();
  return list.filter(e => {
    const k = `${e.time}|${e.title}|${e.calendar}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function formatSlackParsedCalendarMarkdown(events) {
  if (!events.length) return '(해당일 #noti-업무일정 메시지에서 일정을 추출하지 못함 — 채널 원문 확인)';
  return events.map((e, i) => {
    const calNote = e.calendar && e.calendar !== '—' ? `\n   • 캘린더 구분: ${e.calendar}` : '';
    return `${i + 1}. *${e.title}*\n   • 시간: ${e.time}${calNote}`;
  }).join('\n\n');
}

function isApiCalendarShellEvent(ev) {
  const t = (ev.title || '').trim().replace(/\s+/g, ' ');
  return /^hnin$/i.test(t) || /^hni\s*출장$/i.test(t);
}

function apiEventsAreOnlyCalendarShells(events) {
  return !!events?.length && events.every(isApiCalendarShellEvent);
}

function getKstYmd(anchorDate = new Date()) {
  const s = anchorDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function addDaysToKstYmd({ y, m, d }, deltaDays) {
  const pad = n => String(n).padStart(2, '0');
  const noon = new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00+09:00`);
  noon.setTime(noon.getTime() + deltaDays * 86400000);
  return getKstYmd(noon);
}

function kstYmdToIsoRange({ y, m, d }) {
  const pad = n => String(n).padStart(2, '0');
  return {
    timeMin: new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+09:00`).toISOString(),
    timeMax: new Date(`${y}-${pad(m)}-${pad(d)}T23:59:59.999+09:00`).toISOString()
  };
}

function formatKstYmdLong({ y, m, d }) {
  const pad = n => String(n).padStart(2, '0');
  return new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00+09:00`)
    .toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

function resolveCalendarKstYmd(userText, toolQuery) {
  const q = `${userText || ''} ${toolQuery || ''}`.trim().toLowerCase();
  const iso = q.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
  }
  const base = getKstYmd();
  let delta = 0;
  if (/모레|글픈날|글피/.test(q)) delta = 2;
  else if (/내일|명일|tomorrow/.test(q)) delta = 1;
  else if (/어제|yesterday/.test(q)) delta = -1;
  return addDaysToKstYmd(base, delta);
}

// ─── [4] Google Calendar ─────────────────────────────────────────────

/**
 * Vercel 환경변수에서 PEM 개인키를 안전하게 파싱합니다.
 * Node 24 / OpenSSL 3.x 에서는 crypto.createPrivateKey()로 명시 파싱해야 합니다.
 */
function parsePrivateKey(raw) {
  if (!raw) return null;
  let key = raw
    .replace(/\\n/g, '\n')   // literal \n → 실제 개행
    .replace(/\\r/g, '')      // literal \r 제거
    .replace(/\r\n/g, '\n')  // Windows CRLF → LF
    .replace(/\r/g, '\n')    // 구형 Mac CR → LF
    .trim();

  // PEM 헤더/푸터 사이 본문에 개행이 없으면 64자 단위로 강제 삽입
  key = key.replace(
    /(-----BEGIN [^-]+-----)([\s\S]+?)(-----END [^-]+-----)/,
    (_, hdr, body, ftr) => {
      const b = body.replace(/\s+/g, '');
      const lines = b.match(/.{1,64}/g)?.join('\n') || b;
      return `${hdr}\n${lines}\n${ftr}`;
    }
  );
  return key;
}

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const rawKey      = process.env.GOOGLE_PRIVATE_KEY;
  const privateKey  = parsePrivateKey(rawKey);

  console.log('[CAL:AUTH] 시작');
  console.log(`[CAL:AUTH] GOOGLE_CLIENT_EMAIL: ${clientEmail ? `${clientEmail.slice(0, 12)}...` : '❌ 미설정'}`);
  console.log(`[CAL:AUTH] GOOGLE_PRIVATE_KEY: ${rawKey ? `설정됨 (원본 ${rawKey.length}자, 정제 후 ${privateKey?.length}자, 헤더=${privateKey?.includes('BEGIN') ? '있음' : '❌없음'})` : '❌ 미설정'}`);

  if (!clientEmail || !privateKey) {
    console.error('[CAL:AUTH] ❌ 환경변수 누락으로 인증 불가');
    return { error: '인증 환경변수 누락' };
  }

  try {
    const now    = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({
      iss: clientEmail, scope: 'https://www.googleapis.com/auth/calendar.readonly',
      aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
    })).toString('base64url');

    let sig;
    try {
      // Node 24 / OpenSSL 3.x: createPrivateKey()로 명시 파싱 후 서명
      const keyObject = crypto.createPrivateKey({ key: privateKey, format: 'pem' });
      sig = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(keyObject, 'base64url');
      console.log('[CAL:AUTH] ✅ JWT 서명 성공');
    } catch (signErr) {
      console.error(`[CAL:AUTH] ❌ JWT 서명 실패: ${signErr.message}`);
      console.error(`[CAL:AUTH] 키 첫 50자: ${privateKey.slice(0, 50)}`);
      console.error(`[CAL:AUTH] 키 마지막 50자: ${privateKey.slice(-50)}`);
      return { error: `JWT 서명 실패: ${signErr.message}` };
    }

    console.log('[CAL:AUTH] 토큰 요청 중 → oauth2.googleapis.com');
    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${sig}` })
    });
    const data = await res.json();

    if (data.error) {
      console.error(`[CAL:AUTH] ❌ 토큰 발급 실패: ${data.error} / ${data.error_description || ''}`);
      return { error: `JWT 인증 실패: ${data.error} — ${data.error_description || ''}` };
    }

    console.log(`[CAL:AUTH] ✅ 토큰 발급 성공 (만료: ${data.expires_in}초 후)`);
    return { token: data.access_token };
  } catch (e) {
    console.error(`[CAL:AUTH] ❌ 예외: ${e.message}`);
    return { error: e.message };
  }
}

async function getAccessibleCalendars(token) {
  try {
    console.log('[CAL:LIST] 접근 가능 캘린더 목록 조회 중...');
    const res  = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const ids  = data.items?.map(c => c.id) || [];
    console.log(`[CAL:LIST] 접근 가능 캘린더 ${ids.length}개: ${ids.join(', ') || '없음'}`);
    return ids;
  } catch (e) {
    console.error(`[CAL:LIST] ❌ 예외: ${e.message}`);
    return [];
  }
}

async function fetchCalendarEventsForKstDay(ymd) {
  const { y, m, d } = ymd;
  console.log(`[CAL:FETCH] 조회 시작 — KST ${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);

  const auth = await getGoogleAccessToken();
  if (auth.error) {
    console.error(`[CAL:FETCH] ❌ 인증 실패로 조회 중단: ${auth.error}`);
    return { error: auth.error };
  }

  const { timeMin, timeMax } = kstYmdToIsoRange(ymd);
  const calendarId = HNI.knowledge.googleCalendarId;
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

  console.log(`[CAL:FETCH] 캘린더 ID: ${calendarId}`);
  console.log(`[CAL:FETCH] timeMin: ${timeMin}`);
  console.log(`[CAL:FETCH] timeMax: ${timeMax}`);

  try {
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
    const data = await res.json();
    const apiErr = data?.error?.message || (typeof data?.error === 'string' ? data.error : '');

    console.log(`[CAL:FETCH] HTTP ${res.status}`);

    if (!res.ok) {
      console.error(`[CAL:FETCH] ❌ HTTP ${res.status}: ${apiErr}`);
      if (res.status === 404) {
        const list = await getAccessibleCalendars(auth.token);
        return { error: '404 Not Found', diagnostics: `접근 가능 목록: ${list.join(', ') || '없음'}`, detail: apiErr };
      }
      if (res.status === 403) {
        console.error('[CAL:FETCH] 403 원인: 서비스 계정에 캘린더 공유가 안 되어 있거나 Domain-Wide Delegation 미설정');
        return { error: `403 권한 없음: 서비스 계정(${calendarId})이 이 캘린더에 접근할 수 없습니다. 구글 캘린더 공유 설정을 확인하세요.` };
      }
      return { error: `API Error ${res.status}${apiErr ? `: ${apiErr}` : ''}` };
    }

    if (data.error) {
      console.error(`[CAL:FETCH] ❌ API 오류: ${apiErr}`);
      return { error: apiErr || JSON.stringify(data.error) };
    }

    const events = (data.items || []).map(ev => ({
      title: (ev.summary && String(ev.summary).trim()) || '(제목 없음)',
      time:  formatCalendarEventTimeRange(ev),
      location: ev.location ? String(ev.location).trim() : '',
      peopleLine: buildCalendarPeopleLine(ev),
      descriptionSnippet: ev.description ? String(ev.description).replace(/\s+/g, ' ').trim().slice(0, 280) : ''
    }));

    console.log(`[CAL:FETCH] ✅ 이벤트 ${events.length}건 조회 완료`);
    events.forEach((ev, i) => console.log(`[CAL:FETCH]   ${i+1}. "${ev.title}" / ${ev.time}`));

    return { events };
  } catch (e) {
    console.error(`[CAL:FETCH] ❌ 예외: ${e.message}`);
    return { error: e.message };
  }
}

// ─── [5] S3 뉴스 검색 (Gemini Google Search) ─────────────────────────

// 허용 언론사 도메인 (주요 국내외 신뢰 매체)
const TRUSTED_NEWS_DOMAINS = [
  // 국내 주요 일간지·경제지
  'chosun.com','joongang.co.kr','donga.com','hani.co.kr','khan.co.kr',
  'mk.co.kr','hankyung.com','etnews.com','zdnet.co.kr','bloter.net',
  'yna.co.kr','yonhapnews.co.kr','newsis.com','news1.kr','newspim.com',
  'edaily.co.kr','thebell.co.kr','sedaily.com','mt.co.kr','biz.chosun.com',
  // 전문지·산업지
  'electimes.com','koreabizwire.com','irobotnews.com','aitimes.com',
  'itbiznews.com','dt.co.kr','inews24.com','ddaily.co.kr','itworld.co.kr',
  'ciokorea.com','datanet.co.kr','g-enews.com','klnews.co.kr',
  // 국내 방송
  'news.kbs.co.kr','imnews.imbc.com','news.sbs.co.kr','ytn.co.kr',
  // 국제
  'reuters.com','bloomberg.com','techcrunch.com','gpsworld.com','insidegnss.com'
];

function isTrustedNewsUrl(uri) {
  if (!uri) return false;
  try {
    const host = new URL(uri).hostname.replace(/^www\./, '');
    return TRUSTED_NEWS_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

/** 키워드 하나에 대한 단일 검색 */
async function searchOneKeyword(keyword, today, geminiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text:
        `오늘 날짜: ${today}\n\n` +
        `"${keyword}" 관련 뉴스를 검색하여 최근 7일 이내 기사만 최대 2건 정리해 주세요.\n` +
        `⚠️ 반드시 연합뉴스, 조선일보, 중앙일보, 동아일보, 한국경제, 매일경제, 전자신문, ZDNet, 뉴시스, 뉴스1 등 ` +
        `신뢰할 수 있는 주요 언론사 기사만 사용하세요. 블로그, 커뮤니티, 성인·낚시성 사이트는 절대 포함하지 마세요.\n` +
        `7일 이상 지난 기사나 신뢰할 수 없는 출처는 제외합니다. 없으면 "최근 뉴스 없음"이라고만 써 주세요.\n\n` +
        `형식:\n[제목]\n요약: (2~3문장)\n출처: (언론사) | 날짜: (YYYY-MM-DD)\nH&I 관련성: (한 줄)`
      }] }],
      tools: [{ google_search: {} }]
    })
  });
  const data = await res.json();
  return {
    keyword,
    text:   data.candidates?.[0]?.content?.parts?.[0]?.text || '검색 실패',
    // 허용 도메인 링크만 통과
    chunks: (data.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
              .filter(c => isTrustedNewsUrl(c.web?.uri))
  };
}

/** 키워드 배열 또는 단일 문자열을 받아 키워드별 병렬 검색 후 합산 */
async function fetchNewsWithSearch(keywords, geminiKey) {
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

  // 사용자가 키워드를 직접 지정한 경우: 쉼표/공백으로 분리
  let keywordList;
  if (keywords && keywords.trim()) {
    keywordList = keywords.split(/[,，\s]+/).map(k => k.trim()).filter(Boolean);
  } else {
    keywordList = HNI.knowledge.newsKeywords; // 기본 배열
  }

  try {
    const results = await Promise.all(keywordList.map(kw => searchOneKeyword(kw, today, geminiKey)));
    const allChunks = results.flatMap(r => r.chunks);
    const combinedText = results
      .map(r => `🔍 *[${r.keyword}]*\n${r.text}`)
      .join('\n\n');
    return { text: combinedText, chunks: allChunks };
  } catch (e) { return { text: `뉴스 검색 오류: ${e.message}`, chunks: [] }; }
}

/** Gemini 뉴스 결과 + grounding 링크 → Slack 가독성 포맷 */
function formatNewsSlackMessage(text, chunks) {
  // 본문: 번호별 블록을 이모지로 꾸밈
  const body = text
    .replace(/^\[?(\d+)\]?\.\s+/gm, (_, n) => `\n${'─'.repeat(36)}\n*${['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'][+n-1] || `${n}.`} `)
    .replace(/^요약:/gm, '   📝 요약:')
    .replace(/^출처:/gm, '   📌 출처:')
    .replace(/^H&I 관련성:/gm, '   🏢 관련성:')
    .trim();

  // grounding 링크 (중복 제거)
  const seen = new Set();
  const links = chunks
    .filter(c => c.web?.uri && c.web?.title)
    .filter(c => { if (seen.has(c.web.uri)) return false; seen.add(c.web.uri); return true; })
    .slice(0, 8)
    .map((c, i) => `${i + 1}. <${c.web.uri}|${c.web.title}>`)
    .join('\n');

  const linkBlock = links ? `\n\n${'─'.repeat(36)}\n🔗 *기사 링크*\n${links}` : '';
  return `📰 *뉴스 브리핑*  _(${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })})_\n${body}${linkBlock}`;
}

// ─── [6] S6 채널 일괄 요약 ───────────────────────────────────────────

async function fetchAndSummarizeChannels(scope, geminiKey, botToken) {
  const all = HNI.knowledge.all_channels;
  const categories = scope === 'all' ? null : [scope];
  const channelList = Object.values(all).filter(c => !categories || categories.includes(c.category));
  // Vercel 30초 제한을 고려해 최대 8채널
  const limited = channelList.slice(0, 8);

  const results = await Promise.all(limited.map(async ch => {
    try {
      const hist = await slackApi('conversations.history', { channel: ch.id, limit: 50 }, botToken);
      if (!hist.ok) return { name: ch.name, error: hist.error };
      const msgs = (hist.messages || []).reverse().map(m => {
        const sender = findMemberById(m.user)?.name || (m.bot_id ? '봇' : m.user || '?');
        return `[${sender}] ${resolveEmailsInText(m.text || '')}`;
      }).join('\n');
      return { name: ch.name, desc: ch.desc, content: msgs };
    } catch (e) { return { name: ch.name, error: e.message }; }
  }));

  const rawData = results.map(r =>
    r.error
      ? `[#${r.name}] 조회 실패: ${r.error}`
      : `[#${r.name} — ${r.desc}]\n${r.content || '(최근 메시지 없음)'}`
  ).join('\n\n---\n\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text:
          `다음 각 채널의 최근 대화를 분석하여 채널별 업무 현황을 요약해 주세요.\n` +
          `각 채널의 주요 이슈, 진행 중인 업무, 특이사항, 담당자를 명확히 정리하세요.\n\n${rawData}`
        }] }]
      })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '채널 요약을 생성하지 못했습니다.';
  } catch (e) { return `채널 요약 오류: ${e.message}`; }
}

// ─── [7] S2 직원 DM 처리 ─────────────────────────────────────────────
// Slack 앱에서 message.im 구독 필요

async function handleEmployee(userId, text, channel, ts, env) {
  const member = findMemberById(userId);
  const memberName = member?.name || '직원';
  const memberDesc = member ? `${member.dept} ${member.role}` : '';

  console.log(`[EMPLOYEE] ${memberName}(${userId}): ${text.substring(0, 30)}`);

  // 대표 DM 채널 확보
  const bossImRes = await slackApi('conversations.open', { users: env.BOSS_ID }, env.BOT_TOKEN);
  const bossDmChannel = bossImRes.channel?.id;
  if (!bossDmChannel) {
    console.error('[EMPLOYEE] 대표 DM 채널 열기 실패');
    return;
  }

  // 최근 대화 확인 — [대표님 지시] 마커가 있으면 회신으로 처리 (S1)
  const histRes = await slackApi('conversations.history', { channel, limit: 20 }, env.BOT_TOKEN);
  const recentMsgs = histRes.messages || [];
  const instructionMsg = recentMsgs.find(m =>
    (m.bot_id || m.subtype === 'bot_message') && (m.text || '').includes('[대표님 지시]')
  );

  if (instructionMsg) {
    // S1 회신: 대표님께 포워딩
    const origInstruction = instructionMsg.text.replace('[대표님 지시] ', '').trim();
    await slackApi('chat.postMessage', {
      channel: bossDmChannel,
      text: `📬 *[${memberName}님 회신 보고]*\n\n📤 전달했던 지시:\n> ${origInstruction}\n\n📥 ${memberName}님 회신:\n> ${text}`
    }, env.BOT_TOKEN);
    await slackApi('chat.postMessage', {
      channel, thread_ts: ts,
      text: '✅ 말씀 감사합니다. 대표님께 전달하겠습니다.'
    }, env.BOT_TOKEN);
    return;
  }

  // S2 신규 문의 — Gemini로 분류
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  let parsed = null;
  try {
    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        system_instruction: { parts: [{ text:
          `당신은 H&I 구대표집사봇입니다. 현재 시각: ${now}.\n` +
          `직원 ${memberName}(${memberDesc})의 DM 문의를 분류하세요.\n\n` +
          `분류 기준:\n` +
          `- answer: 일정안내, 채널안내, 일반정보, 공지 확인 등 즉시 답변 가능\n` +
          `- confirm: 승인요청, 인사, 예산, 전략, 정책, 대외비 관련 → 대표님 컨펌 필요\n\n` +
          `JSON만 응답 (코드블록 없이):\n` +
          `{"action":"answer","reply":"직원에게 보낼 답변"}\n` +
          `또는\n` +
          `{"action":"confirm","summary":"대표님께 보낼 한 줄 요약"}`
        }] }
      })
    });
    const data = await res.json();
    parsed = parseGeminiJson(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
  } catch (e) { console.error('[EMPLOYEE] Gemini error:', e); }

  if (parsed?.action === 'answer' && parsed.reply) {
    // 직접 답변
    await slackApi('chat.postMessage', { channel, thread_ts: ts, text: parsed.reply }, env.BOT_TOKEN);
    // 대표님께 처리 보고
    await slackApi('chat.postMessage', {
      channel: bossDmChannel,
      text: `📋 *[직원 문의 — 직접 처리]*\n직원: ${memberName} (${memberDesc})\n문의: "${text}"\n처리: 직접 답변 완료`
    }, env.BOT_TOKEN);

  } else {
    // 컨펌 요청 (기본값) — 대표님 DM에 스레드 추적용 마커 포함
    await slackApi('chat.postMessage', {
      channel: bossDmChannel,
      text: `🔔 *[컨펌 요청]* \`[컨펌요청:${userId}]\`\n\n*${memberName}* (${memberDesc}) 문의:\n"${text}"\n${parsed?.summary ? `\n요약: ${parsed.summary}\n` : ''}\n어떻게 회신할까요? *(이 메시지 스레드에 답변해 주세요)*`
    }, env.BOT_TOKEN);
    await slackApi('chat.postMessage', {
      channel, thread_ts: ts,
      text: '잠시만 기다려 주세요. 확인 후 답변드리겠습니다.'
    }, env.BOT_TOKEN);
  }
}

// ─── [8] S2 대표 스레드 답변 → 직원 전달 ────────────────────────────

async function handleBossThreadReply(text, channel, threadTs, env) {
  // 부모 메시지 조회 (컨펌 요청 여부 확인)
  const histRes = await slackApi('conversations.history', {
    channel, latest: threadTs, oldest: threadTs, inclusive: 'true', limit: 5
  }, env.BOT_TOKEN);
  const parentMsg = (histRes.messages || []).find(m => m.ts === threadTs);

  if (!parentMsg) {
    // 부모 못 찾으면 일반 대표 메시지로 처리
    await handleBoss(text, channel, threadTs, env);
    return;
  }

  // [컨펌요청:USER_ID] 마커 확인
  const confirmMatch = (parentMsg.text || '').match(/\[컨펌요청:([A-Z0-9]+)\]/);
  if (!confirmMatch) {
    // 일반 스레드 답변
    await handleBoss(text, channel, threadTs, env);
    return;
  }

  const employeeId = confirmMatch[1];
  const empMember  = findMemberById(employeeId);
  const empName    = empMember?.name || '직원';

  // 직원 DM 열기
  const imRes = await slackApi('conversations.open', { users: employeeId }, env.BOT_TOKEN);
  const empChannel = imRes.channel?.id;

  if (empChannel) {
    await slackApi('chat.postMessage', {
      channel: empChannel,
      text: `안녕하세요 ${empName}님, 대표님 말씀으로는:\n\n"${text}"`
    }, env.BOT_TOKEN);
    await slackApi('chat.postMessage', {
      channel, thread_ts: threadTs,
      text: `✅ ${empName}님께 답변을 전달했습니다.`
    }, env.BOT_TOKEN);
  } else {
    await slackApi('chat.postMessage', {
      channel, thread_ts: threadTs,
      text: `⚠️ ${empName}님 DM 채널을 열지 못했습니다.`
    }, env.BOT_TOKEN);
  }
}

// ─── [9] handleBoss: 대표님 전용 통합 엔진 ──────────────────────────

async function handleBoss(text, channel, threadTs, env) {
  const nowKST = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  console.log(`[BOSS] "${text.substring(0, 40)}" at ${nowKST}`);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  const systemPrompt =
    `당신은 ${HNI.knowledge.companyName} 구자덕 대표님의 수석 비서 '${HNI.knowledge.botName}'입니다.\n` +
    `현재 시각: ${nowKST}\n` +
    `[도구 선택 기준]\n` +
    `1. 경영·CXO 보고 맥락 → report_management_status(category=finance)\n` +
    `2. 영업지원 맥락 → report_management_status(category=sales)\n` +
    `3. 일정 조회 → report_management_status(category=calendar, query=오늘/내일/날짜)\n` +
    `4. 뉴스·시장동향 → search_news(keywords=키워드)\n` +
    `5. 채널 업무현황 → summarize_all_channels(scope=all|management|department|...)\n` +
    `6. 특정 직원에게 전달 → send_message(name=이름, message=내용)`;

  try {
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: GEMINI_TOOLS
      })
    });
    const data  = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) {
        await slackApi('chat.postMessage', { channel, text: part.text, thread_ts: threadTs }, env.BOT_TOKEN);
      }

      if (part.functionCall) {
        const { name, args } = part.functionCall;
        console.log(`[BOSS] Tool: ${name}`, args);

        // ── S3 뉴스 검색 ──
        if (name === 'search_news') {
          const { text: newsText, chunks } = await fetchNewsWithSearch(args.keywords, env.GEMINI_KEY);
          const formatted = formatNewsSlackMessage(newsText, chunks);
          // 1️⃣ 대표님께 먼저 전달
          await slackApi('chat.postMessage', {
            channel, thread_ts: threadTs, text: formatted
          }, env.BOT_TOKEN);
          // 2️⃣ #news 채널 공유 (대표님 확인 후)
          await slackApi('chat.postMessage', {
            channel: 'C02MND8B0KE',
            text: `${formatted}\n\n_구대표님께 먼저 보고 후 공유되었습니다._`
          }, env.BOT_TOKEN);
          // 3️⃣ 대표님께 공유 완료 안내
          await slackApi('chat.postMessage', {
            channel, thread_ts: threadTs,
            text: '✅ #news 채널에도 공유했습니다.'
          }, env.BOT_TOKEN);

        // ── S6 채널 일괄 요약 ──
        } else if (name === 'summarize_all_channels') {
          await slackApi('chat.postMessage', {
            channel, thread_ts: threadTs,
            text: '📊 채널 현황을 수집 중입니다. 잠시만 기다려 주세요...'
          }, env.BOT_TOKEN);
          const summary = await fetchAndSummarizeChannels(args.scope || 'all', env.GEMINI_KEY, env.BOT_TOKEN);
          await slackApi('chat.postMessage', {
            channel, thread_ts: threadTs,
            text: `📊 *[채널별 업무 현황 요약]*\n\n${summary}`
          }, env.BOT_TOKEN);

        // ── S1 직원 메시지 전달 (회신 추적 마커 포함) ──
        } else if (name === 'send_message') {
          const target = Object.entries(HNI.members).find(([n]) => n.includes(args.name));
          if (target) {
            const [targetName, targetInfo] = target;
            // [대표님 지시] 마커 — 직원 회신 감지에 사용 (handleEmployee 참조)
            const markedMsg = `[대표님 지시] ${args.message}`;
            await slackApi('chat.postMessage', { channel: targetInfo.id, text: markedMsg }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', {
              channel, thread_ts: threadTs,
              text: `✅ *${targetName}*님께 지시사항을 전달했습니다. 회신이 오면 보고드리겠습니다.`
            }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', {
              channel, thread_ts: threadTs,
              text: `⚠️ '${args.name}' 멤버를 찾을 수 없습니다.`
            }, env.BOT_TOKEN);
          }

        // ── S4·S5 경영/일정/영업 보고 (기존 로직 유지) ──
        } else if (name === 'report_management_status') {
          const targetChannel = HNI.knowledge.management_channels[args.category];
          if (!targetChannel) {
            await slackApi('chat.postMessage', {
              channel, thread_ts: threadTs,
              text: `⚠️ 알 수 없는 분야: ${args.category}`
            }, env.BOT_TOKEN);
            continue;
          }

          let rawData = '';
          let reportContextDate = nowKST;
          let ymdCalendar = null;

          if (args.category === 'calendar') {
            ymdCalendar = resolveCalendarKstYmd(text, args.query);
            reportContextDate = formatKstYmdLong(ymdCalendar);
            console.log(`[BOSS] Calendar KST: ${reportContextDate}`);
          }

          const histLimit = args.category === 'calendar' ? 150 : 100;
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: histLimit }, env.BOT_TOKEN);

          let slackParsedBlock = '';
          if (args.category === 'calendar' && historyRes.ok && ymdCalendar) {
            const matched = (historyRes.messages || []).filter(m => messageMatchesCalendarDay(m, ymdCalendar));
            const parsedFlat = [];
            for (const m of matched) {
              parsedFlat.push(...parseCalendarStructuredFromSlack(slackPlainForParse(resolveEmailsInText(m.text || ''))));
            }
            const deduped = dedupeParsedSlackEvents(parsedFlat);
            slackParsedBlock = formatSlackParsedCalendarMarkdown(deduped);
            console.log(`[BOSS] Slack parsed events: ${deduped.length}`);
          }

          if (args.category === 'calendar') {
            const apiResult = await fetchCalendarEventsForKstDay(ymdCalendar);
            if (apiResult.error) {
              rawData = `[0. Slack #noti-업무일정 구조 파싱(최우선)]\n${slackParsedBlock}\n\n[⚠️ Google Calendar API]\n사유: ${apiResult.error}\n진단: ${apiResult.diagnostics || '없음'}${apiResult.detail ? `\n상세: ${apiResult.detail}` : ''}\n\n`;
            } else {
              const shellOnly = apiEventsAreOnlyCalendarShells(apiResult.events);
              const apiMd = shellOnly
                ? `※ API 응답이 캘린더 표시명(hnin·hni 출장) 위주입니다. 일정명·시간은 [0]과 채널 원문을 우선하세요.\n\n${formatCalendarEventsAsMarkdown(apiResult.events)}`
                : formatCalendarEventsAsMarkdown(apiResult.events);
              rawData = `[0. Slack #noti-업무일정 구조 파싱(최우선)]\n${slackParsedBlock}\n\n[1. Google Calendar API] 조회일(KST): ${reportContextDate}\n${apiMd}\n\n[JSON]\n${JSON.stringify(apiResult.events)}\n\n`;
            }
          }

          if (historyRes.ok) {
            const context = historyRes.messages.reverse().map(m =>
              `[발신:${findMemberById(m.user)?.name || m.user}] ${resolveEmailsInText(m.text || '')}`
            ).join('\n\n');
            rawData += `[#${targetChannel.name} 채널 원문]\n${context}`;
          } else {
            rawData += `[#${targetChannel.name}] 히스토리 조회 실패: ${historyRes.error || 'unknown'}`;
          }

          const calendarRules = args.category === 'calendar'
            ? `[일정 답변 규칙]\n- 제목·시간은 [0. Slack 구조 파싱]을 최우선으로 사용하세요.\n- "hnin", "hni 출장"은 캘린더 구분명이며 일정 제목이 아닙니다.\n- 원문 괄호·담당자·게스트 표기를 유지하세요.\n`
            : '';

          const summaryRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: `지시: ${text}\n날짜·맥락: ${reportContextDate}\n전체 데이터:\n${rawData}` }] },
                { role: 'user', parts: [{ text: calendarRules + (args.category === 'calendar' ? '위 규칙과 데이터를 따른 일정 브리핑을 작성하세요.' : '위 데이터를 분석하여 보고하세요.') }] }
              ]
            })
          });
          const sData  = await summaryRes.json();
          const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (sReply) {
            await slackApi('chat.postMessage', { channel, text: sReply, thread_ts: threadTs }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) { console.error('[BOSS] Error:', e); }
}

// ─── [10] 메인 핸들러 ────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    const env = {
      BOT_TOKEN:      process.env.SLACK_BOT_TOKEN,
      BOSS_ID:        process.env.BOSS_USER_ID,
      GEMINI_KEY:     process.env.GEMINI_API_KEY,
      SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET
    };

    console.log(`[INBOUND] len=${rawBody.length}`);

    if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) {
      console.warn('[SECURITY] Invalid Signature');
      return res.status(200).send('bad signature');
    }

    // Slack 재시도 무시
    if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');

    let body;
    try { body = JSON.parse(rawBody); } catch { return res.status(200).end(); }

    // URL 검증
    if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });

    const event = body.event;
    if (!event || event.bot_id || !event.text) return res.status(200).end();

    const cleanText = event.text.replace(/<@U[A-Z0-9]+>/g, '').trim();
    if (!cleanText) return res.status(200).end();

    console.log(`[EVENT] user=${event.user} ch=${event.channel} type=${event.channel_type} thread=${!!event.thread_ts}`);

    // ── 라우팅 ──
    if (event.user === env.BOSS_ID) {
      // 대표님이 스레드에 답변 → 컨펌 라우팅 먼저 확인 (S2)
      const isThreadReply = event.thread_ts && event.thread_ts !== event.ts;
      if (isThreadReply) {
        await handleBossThreadReply(cleanText, event.channel, event.thread_ts, env);
      } else {
        await handleBoss(cleanText, event.channel, event.thread_ts || event.ts, env);
      }
    } else if (event.channel_type === 'im') {
      // 직원 DM (S1 회신 감지 + S2 신규 문의)
      await handleEmployee(event.user, cleanText, event.channel, event.ts, env);
    }
    // 그 외(일반 채널 멘션 없는 메시지 등): 무시

    return res.status(200).send('ok');
  } catch (e) {
    console.error('[HANDLER FATAL]:', e);
    return res.status(200).send('error handled');
  }
}

export const config = { api: { bodyParser: false } };
