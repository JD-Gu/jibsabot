/**
 * [v15.7] 구대표집사봇(H&I) — 기획서(기획서.md) §5·§7과 채널 ID·용어 정렬
 * - #noti-업무일정: Google→Slack 알림 형식(Calendar: 구분명 + 시간줄) 구조 파싱 후 최우선 반영
 */

import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 (H&I 마스터 데이터) ──────────────
const HNI = {
  members: {
    '구자덕': { id: 'U02M1T5E1N3', email: '09jj@hni-gl.com', dept: '경영진', role: '대표이사' },
    '김다영': { id: 'U05CUH3GENN', email: 'kimdy@hni-gl.com', dept: '상품관리', role: '프로' },
    '김민영': { id: 'U02MF3ANFF0', email: '10minyoung@hni-gl.com', dept: '상품관리', role: '프로' },
    '김봉석': { id: 'U02M755FC0P', email: '24bong@hni-gl.com', dept: '디바이스', role: '팀장' },
    '김인구': { id: 'U02M755LQHM', email: '05king@hni-gl.com', dept: '서비스지원', role: '팀장' },
    '김찬영': { id: 'U02MMQVHM8T', email: '93cy@hni-gl.com', dept: '디바이스', role: '프로' },
    '김훈지': { id: 'U02MMQV63RR', email: '73khj@hni-gl.com', dept: '서비스지원', role: '프로' },
    '박인영': { id: 'U02MQ27A6CC', email: '54yy@hni-gl.com', dept: '플랫폼', role: '프로' },
    '이지민': { id: 'U02MMQ4B4M8', email: '95jimin@hni-gl.com', dept: '상품관리', role: '팀장' },
    '이창현': { id: 'U04DX8YR8SC', email: 'lch9772@hni-gl.com', dept: '디바이스', role: '프로' },
    '정명휘': { id: 'U02MMQ40LE6', email: '31jmh@hni-gl.com', dept: '플랫폼', role: '프로' },
    '정현수': { id: 'U02N0D92YE5', email: '25jhs@hni-gl.com', dept: '플랫폼', role: '팀장' },
    '지우현': { id: 'U02MJRGEP7F', email: '90jay@hni-gl.com', dept: '플랫폼', role: '프로' },
    '이종혁': { id: 'U02M86NGGM7', email: '99hyeoki@hni-gl.com', dept: '제품본부', role: '본부장' }
  },
  knowledge: {
    companyName: "주식회사 에이치앤아이 (H&I)",
    botName: "구대표집사봇",
    coreTech: "GNSS/RTK 초정밀 측위, HI-PPE v4.0 지능형 안전 장구, IoT 플랫폼, AI 비전 엣지",
    /** 기획서 §5.1·코드 대응표 — 키는 Gemini tool enum과 동일 */
    management_channels: {
      finance: { name: "cmm-cxo", id: "C02M8BMJZG9" },
      sales: { name: "cmm-영업지원", id: "C06DRAHHAQZ" },
      calendar: { name: "noti-업무일정", id: "C03R1QVMKC4" }
    },
    googleCalendarId: (process.env.GOOGLE_CALENDAR_ID || '09jj@hni-gl.com').trim()
  }
};

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: 'report_management_status',
      description: '사내 CXO·경영보고(finance=#cmm-cxo), 영업지원(sales=#cmm-영업지원), 일정(calendar=구글캘린더+#noti-업무일정) 데이터를 조회·분석 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: 'finance|sales|calendar' },
          query: { type: 'STRING', description: 'calendar일 때: 오늘/내일/어제/모레 또는 YYYY-MM-DD. 일정 질문이면 대표 발화와 동일하게(예: 오늘 일정 → 오늘).' }
        },
        required: ['category']
      }
    },
    {
      name: 'send_message',
      description: '특정 직원에게 슬랙 메시지를 즉시 보냅니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '받는 사람 성함' },
          message: { type: 'STRING', description: '전달할 내용' }
        },
        required: ['name', 'message']
      }
    }
  ]
}];

// ─── [2] 유틸리티 및 보안 검증 엔진 (수정 완료) ─────────────────────

/**
 * 💡 슬랙에서 오는 요청이 위조되지 않았는지 검증하는 필수 함수
 */
function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  
  // 5분 이상 차이 나는 요청은 Replay Attack 방지를 위해 거절
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const hmac = crypto.createHmac('sha256', signingSecret)
                     .update(`v0:${timestamp}:${rawBody}`)
                     .digest('hex');
  return `v0=${hmac}` === signature;
}

async function slackApi(endpoint, body, token) {
  const method = (endpoint.includes('.list') || endpoint.includes('.history')) ? 'GET' : 'POST';
  let url = `https://slack.com/api/${endpoint}`;
  let options = { method, headers: { 'Authorization': `Bearer ${token}` } };
  if (method === 'GET' && body) url += '?' + new URLSearchParams(body).toString();
  else { options.headers['Content-Type'] = 'application/json; charset=utf-8'; options.body = JSON.stringify(body); }
  const r = await fetch(url, options);
  return await r.json();
}

function resolveEmailsInText(text) {
  let processedText = text;
  Object.keys(HNI.members).forEach(name => {
    const email = HNI.members[name].email;
    if (email) processedText = processedText.replace(new RegExp(email, 'gi'), name);
  });
  return processedText;
}

function memberNameFromEmail(email) {
  if (!email) return null;
  const lower = String(email).toLowerCase();
  const found = Object.entries(HNI.members).find(([, v]) => (v.email || '').toLowerCase() === lower);
  return found ? found[0] : null;
}

function formatCalendarEventTimeRange(ev) {
  const timeOpts = { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false };
  if (ev.start?.date && !ev.start?.dateTime) {
    const endNote = ev.end?.date ? ` (종료일 ${ev.end.date})` : '';
    return `종일 (${ev.start.date})${endNote}`;
  }
  const s = ev.start?.dateTime;
  const e = ev.end?.dateTime;
  if (!s) return '시간 미정';
  const sStr = new Date(s).toLocaleString('ko-KR', timeOpts);
  const eStr = e ? new Date(e).toLocaleString('ko-KR', timeOpts) : '';
  return eStr ? `${sStr} ~ ${eStr}` : sStr;
}

function buildCalendarPeopleLine(ev) {
  const bits = [];
  const orgEmail = ev.organizer?.email;
  if (orgEmail) {
    bits.push(`주최: ${memberNameFromEmail(orgEmail) || ev.organizer.displayName || orgEmail}`);
  }
  const others = (ev.attendees || [])
    .filter(a => a.responseStatus !== 'declined')
    .filter(a => !a.organizer)
    .map(a => memberNameFromEmail(a.email) || a.displayName || a.email)
    .filter(Boolean);
  const unique = [...new Set(others)];
  if (unique.length) bits.push(`참석·게스트: ${unique.join(', ')}`);
  return bits.length ? bits.join(' | ') : '';
}

/** Gemini/슬랙 답변용 — 일정명·시간·인원을 한눈에 */
function formatCalendarEventsAsMarkdown(events) {
  if (!events?.length) return '(해당일 Google Calendar API로 조회된 일정 없음 — Slack 알림만 참고하세요.)';
  return events.map((ev, i) => {
    const people = ev.peopleLine || '관련인원: API에 없음(제목·Slack #noti-업무일정 원문 확인)';
    const loc = ev.location ? `\n   • 장소: ${ev.location}` : '';
    const note = ev.descriptionSnippet ? `\n   • 비고: ${ev.descriptionSnippet}` : '';
    return `${i + 1}. *${ev.title}*\n   • 시간: ${ev.time}${loc}\n   • ${people}${note}`;
  }).join('\n\n');
}

const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function messageMentionsKstDate(text, ymd) {
  if (!text) return false;
  const { y, m, d } = ymd;
  const pad = (n) => String(n).padStart(2, '0');
  const tests = [
    new RegExp(`${y}년\\s*${m}월\\s*${d}일`),
    new RegExp(`${y}[./]\\s*${pad(m)}[./]\\s*${pad(d)}\\b`),
    new RegExp(`\\b${MONTH_NAMES_EN[m - 1]}\\s+0?${d},\\s*${y}\\b`, 'i'),
    new RegExp(`(?:^|\\D)${m}월\\s*0?${d}일(?:\\D|$)`)
  ];
  return tests.some((r) => r.test(text));
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

/** Slack에 게시된 Google Calendar 알림: "Calendar: hnin" 다음 줄들이 실제 일정 */
function parseCalendarStructuredFromSlack(rawText) {
  const events = [];
  if (!rawText) return events;
  let currentCal = '';
  const calHeader = /^(?:Calendar|캘린더)\s*[:：]\s*`?([^`\n]+?)`?\s*$/i;

  for (const raw of rawText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const ch = line.match(calHeader);
    if (ch) {
      currentCal = ch[1].trim();
      continue;
    }

    const timed = line.match(
      /^[\s*•◇▪︎\-\u2022]*((?:(?:오전|오후)\s*)?\d{1,2}:\d{2}(?:\s*(?:AM|PM))?(?:\s*[-–~]\s*(?:(?:오전|오후)\s*)?\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?)\s+(.+)$/
    );
    if (timed && timed[2] && timed[2].length > 2) {
      events.push({
        calendar: currentCal || '—',
        time: timed[1].replace(/\s+/g, ' ').trim(),
        title: timed[2].trim()
      });
      continue;
    }

    if (/^\[(?:출장|외근|회의|연차|오후 반차)\]/.test(line) && line.length > 5) {
      events.push({
        calendar: currentCal || '—',
        time: '종일·시각은 같은 메시지 When/상단 블록 참고',
        title: line.replace(/^[\s*•◇▪︎\-\u2022]+/, '').trim()
      });
    }
  }
  return events;
}

function dedupeParsedSlackEvents(list) {
  const seen = new Set();
  return list.filter((e) => {
    const k = `${e.time}|${e.title}|${e.calendar}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function formatSlackParsedCalendarMarkdown(events) {
  if (!events.length) {
    return '(해당일 조건의 #noti-업무일정 메시지에서 "시간 + 제목" 줄을 추출하지 못함 — 하단 원문 채널 로그 확인)';
  }
  return events
    .map((e, i) => {
      const calNote = e.calendar && e.calendar !== '—' ? `\n   • 캘린더 구분(일정 제목 아님): ${e.calendar}` : '';
      return `${i + 1}. *${e.title}*\n   • 시간: ${e.time}${calNote}`;
    })
    .join('\n\n');
}

function isApiCalendarShellEvent(ev) {
  const t = (ev.title || '').trim().replace(/\s+/g, ' ');
  if (!t || t === '(제목 없음)') return false;
  if (/^hnin$/i.test(t)) return true;
  if (/^hni\s*출장$/i.test(t)) return true;
  return false;
}

function apiEventsAreOnlyCalendarShells(events) {
  if (!events?.length) return false;
  return events.every((ev) => isApiCalendarShellEvent(ev));
}

/** Asia/Seoul 기준 달력 연·월·일 */
function getKstYmd(anchorDate = new Date()) {
  const s = anchorDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function addDaysToKstYmd({ y, m, d }, deltaDays) {
  const pad = (n) => String(n).padStart(2, '0');
  const noon = new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00+09:00`);
  noon.setTime(noon.getTime() + deltaDays * 86400000);
  return getKstYmd(noon);
}

function kstYmdToIsoRange({ y, m, d }) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    timeMin: new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+09:00`).toISOString(),
    timeMax: new Date(`${y}-${pad(m)}-${pad(d)}T23:59:59.999+09:00`).toISOString()
  };
}

function formatKstYmdLong({ y, m, d }) {
  const pad = (n) => String(n).padStart(2, '0');
  const dt = new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00+09:00`);
  return dt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

/** 대표 발화 + tool query로 캘린더 조회일(KST) 결정. 명시 없으면 오늘(KST). */
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
  else if (/오늘|금일|당일|today/.test(q)) delta = 0;
  return addDaysToKstYmd(base, delta);
}

// ─── [3] 구글 정식 인증 및 데이터 엔진 ────────────────────────

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (!clientEmail || !privateKey) {
    console.error("[AUTH] Missing Credentials");
    return { error: "인증 환경변수가 누락되었습니다." };
  }

  try {
    const header = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
    const now = Math.floor(Date.now() / 1000);
    const claimSet = JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    });

    const encodedHeader = Buffer.from(header).toString('base64url');
    const encodedClaimSet = Buffer.from(claimSet).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedClaimSet}`;
    const signature = crypto.createSign('RSA-SHA256').update(signatureInput).sign(privateKey, 'base64url');
    const jwt = `${signatureInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
    });

    const data = await res.json();
    if (data.error) return { error: `JWT 인증 실패: ${data.error}` };
    return { token: data.access_token };
  } catch (e) { return { error: `인증 엔진 구동 실패: ${e.message}` }; }
}

async function getAccessibleCalendars(token) {
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return data.items?.map(c => c.id) || [];
  } catch (e) { return []; }
}

async function fetchCalendarEventsForKstDay(ymd) {
  const auth = await getGoogleAccessToken();
  if (auth.error) return { error: auth.error };

  const calendarId = HNI.knowledge.googleCalendarId;
  const { timeMin, timeMax } = kstYmdToIsoRange(ymd);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${auth.token}` } });
    const data = await res.json();
    const apiErr = data?.error?.message || (typeof data?.error === 'string' ? data.error : '');
    if (!res.ok) {
      if (res.status === 404) {
        const list = await getAccessibleCalendars(auth.token);
        return { error: `404 Not Found`, diagnostics: `접근 가능 목록: ${list.join(', ') || '없음'}`, detail: apiErr };
      }
      return { error: `API Error ${res.status}${apiErr ? `: ${apiErr}` : ''}` };
    }
    if (data.error) return { error: apiErr || JSON.stringify(data.error) };
    const events = (data.items || []).map(ev => {
      const desc = ev.description ? String(ev.description).replace(/\s+/g, ' ').trim() : '';
      return {
        title: (ev.summary && String(ev.summary).trim()) || '(제목 없음)',
        time: formatCalendarEventTimeRange(ev),
        location: ev.location ? String(ev.location).trim() : '',
        peopleLine: buildCalendarPeopleLine(ev),
        descriptionSnippet: desc ? desc.slice(0, 280) : ''
      };
    });
    return { events };
  } catch (e) { return { error: e.message }; }
}

// ─── [4] handleBoss: 대표님 전용 통합 관리 엔진 ───────────────────

async function handleBoss(text, channel, threadTs, env) {
  const now = new Date();
  const optionsKST = { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const nowKST = now.toLocaleString('ko-KR', optionsKST);

  console.log(`[BOSS] Processing: "${text}" at ${nowKST}`);

  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구자덕 대표님의 수석 비서 '${HNI.knowledge.botName}'입니다.
  현재 시각: ${nowKST}
  [미션] 대표님 질의에 맞게 report_management_status 도구로 분야를 선택하세요.
  1. 경영·CXO 보고 맥락: Slack #cmm-cxo (도구 키 finance)
  2. 영업 지원 맥락: Slack #cmm-영업지원 (도구 키 sales)
  3. 업무 일정: Google Calendar(읽기) + Slack #noti-업무일정 히스토리 (도구 키 calendar). calendar 호출 시 반드시 query에 조회일을 넣으세요(오늘/내일/어제 또는 YYYY-MM-DD). "오늘 일정"이면 query=오늘.
  권장 명령 채널(기획): #jj-프롬프트 — 다른 채널·DM에서 멘션해도 동일하게 동작합니다.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: GEMINI_TOOLS
      })
    });
    
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) await slackApi('chat.postMessage', { channel, text: part.text, thread_ts: threadTs }, env.BOT_TOKEN);
      
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        console.log(`[BOSS] Tool Call: ${name}`, args);
        
        if (name === 'report_management_status') {
          let rawData = "";
          const targetChannel = HNI.knowledge.management_channels[args.category];
          if (!targetChannel) {
            console.warn('[BOSS] report_management_status: unknown category', args.category);
            await slackApi('chat.postMessage', { channel, text: `⚠️ 알 수 없는 분야입니다: ${args.category}`, thread_ts: threadTs }, env.BOT_TOKEN);
            continue;
          }

          let reportContextDate = nowKST;
          let ymdCalendar = null;
          if (args.category === 'calendar') {
            ymdCalendar = resolveCalendarKstYmd(text, args.query);
            reportContextDate = formatKstYmdLong(ymdCalendar);
            console.log(`[BOSS] Calendar KST day: ${reportContextDate} (query=${args.query || ''})`);
          }

          const historyLimit = args.category === 'calendar' ? 150 : 100;
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: historyLimit }, env.BOT_TOKEN);

          let slackParsedBlock = '';
          if (args.category === 'calendar' && historyRes.ok && ymdCalendar) {
            const matched = (historyRes.messages || []).filter((m) => messageMatchesCalendarDay(m, ymdCalendar));
            const parsedFlat = [];
            for (const m of matched) {
              const plain = slackPlainForParse(resolveEmailsInText(m.text || ''));
              parsedFlat.push(...parseCalendarStructuredFromSlack(plain));
            }
            const deduped = dedupeParsedSlackEvents(parsedFlat);
            slackParsedBlock = formatSlackParsedCalendarMarkdown(deduped);
            console.log(`[BOSS] Slack calendar lines parsed: ${deduped.length} (from ${matched.length} messages)`);
          }

          if (args.category === 'calendar') {
            const apiResult = await fetchCalendarEventsForKstDay(ymdCalendar);
            if (apiResult.error) {
              const detail = apiResult.detail ? `\n상세: ${apiResult.detail}` : '';
              rawData = `[0. Slack #noti-업무일정 — 구조 파싱(최우선, Calendar: 는 구분명)]\n${slackParsedBlock}\n\n[⚠️ Google Calendar API]\n사유: ${apiResult.error}\n진단: ${apiResult.diagnostics || '없음'}${detail}\n\n`;
            } else {
              const shellOnly = apiEventsAreOnlyCalendarShells(apiResult.events);
              const apiMd = shellOnly
                ? `※ API 응답이 캘린더 표시명(hnin·hni 출장 등) 위주입니다. 일정명·시간은 [0]과 채널 원문을 우선하세요.\n\n${formatCalendarEventsAsMarkdown(apiResult.events)}`
                : formatCalendarEventsAsMarkdown(apiResult.events);
              rawData = `[0. Slack #noti-업무일정 — 구조 파싱(최우선)]\n${slackParsedBlock}\n\n[1. Google Calendar API] 조회일(KST): ${reportContextDate}\n${apiMd}\n\n[JSON]\n${JSON.stringify(apiResult.events)}\n\n`;
            }
          }

          if (historyRes.ok) {
            const context = historyRes.messages.reverse().map(m => `[발신:${Object.keys(HNI.members).find(k=>HNI.members[k].id===m.user)||m.user}] ${resolveEmailsInText(m.text)}`).join('\n\n');
            rawData += `[#${targetChannel.name} 채널 원문 전체]\n${context}`;
          } else {
            rawData += `[#${targetChannel.name} 채널] 히스토리 조회 실패: ${historyRes.error || 'unknown'}`;
          }

          const calendarReplyRules = args.category === 'calendar'
            ? `[일정 답변 규칙 — 필수]\n- 각 일정의 **제목·시간**은 먼저 [0. Slack 구조 파싱]과 같아야 합니다. 파싱이 비어 있으면 채널 원문에서 [외근][출장] 포함 **전체 제목**과 시각을 추출하세요.\n- "hnin", "hni 출장"은 Google 알림의 **Calendar: (캘린더 구분)** 일 뿐이며 일정 제목으로 쓰지 마세요.\n- 제목 괄호·담당자(예: ○○ 책임)·게스트 표기는 원문에서 유지하세요. API만 믿지 말 것.\n`
            : '';
          const summaryRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: `지시: ${text}\n타겟날짜·맥락: ${reportContextDate}\n전체 데이터:\n${rawData}` }] },
                { role: 'user', parts: [{ text: calendarReplyRules + (args.category === 'calendar' ? '위 규칙과 데이터를 따른 일정 브리핑을 작성하세요.' : '위 데이터를 분석하여 보고하세요.') }] }
              ]
            })
          });
          const sData = await summaryRes.json();
          const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (sReply) await slackApi('chat.postMessage', { channel, text: sReply, thread_ts: threadTs }, env.BOT_TOKEN);
        } else if (name === 'send_message') {
          const target = Object.entries(HNI.members).find(([n]) => n.includes(args.name));
          if (target) {
            await slackApi('chat.postMessage', { channel: target[1].id, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${target[0]}님께 메시지를 전송했습니다.`, thread_ts: threadTs }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) { console.error("[BOSS] Error:", e); }
}

// ─── [5] 메인 핸들러 ──────────────────────────────────────

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    
    const env = { 
      BOT_TOKEN: process.env.SLACK_BOT_TOKEN, 
      BOSS_ID: process.env.BOSS_USER_ID, 
      GEMINI_KEY: process.env.GEMINI_API_KEY, 
      SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET 
    };

    console.log(`[INBOUND] Received Slack Signal. Body length: ${rawBody.length}`);

    // Slack Signing Secret 검증 (Replay 방지 포함)
    if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) {
      console.warn("[SECURITY] Invalid Signature.");
      return res.status(200).send('bad signature');
    }

    if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');
    
    let body;
    try { body = JSON.parse(rawBody); } catch (e) { return res.status(200).end(); }
    if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });
    
    const event = body.event;
    if (!event || event.bot_id || !event.text) return res.status(200).end();
    
    const cleanText = event.text.replace(/<@U[A-Z0-9]+>/g, '').trim();
    console.log(`[EVENT] User: ${event.user}, Channel: ${event.channel}, Msg: ${cleanText.substring(0, 15)}...`);

    if (event.user === env.BOSS_ID) {
      await handleBoss(cleanText, event.channel, event.thread_ts || event.ts, env);
    }
    
    return res.status(200).send('ok');
  } catch (e) { 
    console.error("[HANDLER FATAL]:", e);
    return res.status(200).send('error handled'); 
  }
}
export const config = { api: { bodyParser: false } };
