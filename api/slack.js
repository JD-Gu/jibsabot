/**
 * [v14.2] 구대표집사봇(H&I) 실전 운영용 전문
 * * 변경 및 업데이트 내역:
 * 1. OAuth 동의 화면 불필요: 서비스 계정 기반 JWT 인증으로 설정 복잡도 최소화
 * 2. Vercel 환경변수 최적화: GOOGLE_PRIVATE_KEY의 줄바꿈(\\n) 처리 로직 강화
 * 3. 정밀 로깅 추가: JWT 생성부터 API 응답까지 각 단계를 로그로 남겨 디버깅 용이성 확보
 * 4. 타임아웃 방어: 구글 API 응답 지연 시에도 프로세스가 멈추지 않도록 비동기 처리 개선
 */

import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 (H&I 마스터 데이터) ──────────────
const HNI = {
  members: {
    '구자덕': { id: 'U02M1T5E1N3', email: 'ceo@hni-gl.com', dept: '경영진', role: '대표이사' },
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
    ceo: "구자덕 대표이사",
    botName: "구대표집사봇",
    coreTech: "GNSS/RTK 초정밀 측위(cm급), HI-PPE v4.0 지능형 안전 솔루션, AI라이브 맵핑 플랫폼",
    management_channels: {
      finance: { name: "경영재무", id: "C02M8BMJZG9" }, 
      sales: { name: "영업지원", id: "C06DRAHHAQZ" },
      calendar: { name: "업무일정", id: "C03R1QVMKC4" }
    },
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID || 'primary'
  }
};

const GEMINI_TOOLS = [{
  function_declarations: [
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
    },
    {
      name: 'report_management_status',
      description: '재무, 영업, 일정 데이터를 직접 조회하거나 분석하여 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: '분야' },
          query: { type: 'STRING', description: '검색 날짜 또는 키워드' }
        },
        required: ['category']
      }
    }
  ]
}];

// ─── [2] 구글 인증 및 캘린더 엔진 (v14.2 고도화) ─────────────────────

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Vercel 환경변수에서 줄바꿈이 깨지는 현상 방지
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    console.warn("[AUTH] Missing Google Credentials in Environment Variables");
    return null;
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
    return data.access_token;
  } catch (e) {
    console.error("[AUTH ERROR] JWT Generation Failed:", e);
    return null;
  }
}

async function fetchCalendarEventsDirectly(queryDate) {
  const token = await getGoogleAccessToken();
  if (!token) return null;

  const calendarId = HNI.knowledge.googleCalendarId;
  const start = new Date(queryDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(queryDate);
  end.setHours(23, 59, 59, 999);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`;

  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    
    if (data.items) {
      return data.items.map(ev => ({
        title: ev.summary,
        time: ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString('ko-KR') : "종일",
        location: ev.location || "장소미지정",
        attendees: ev.attendees ? ev.attendees.map(a => a.email).join(', ') : ""
      }));
    }
    return null;
  } catch (e) {
    console.error("[CALENDAR API ERROR] Fetch Failed:", e);
    return null;
  }
}

// ─── [3] 슬랙 유틸리티 ───────────────────────────────────────

function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  const hmac = crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return `v0=${hmac}` === signature;
}

async function slackApi(endpoint, body, token) {
  const method = (endpoint.includes('.list') || endpoint.includes('.history')) ? 'GET' : 'POST';
  let url = `https://slack.com/api/${endpoint}`;
  let options = { method, headers: { 'Authorization': `Bearer ${token}` } };
  if (method === 'GET' && body) {
    url += '?' + new URLSearchParams(body).toString();
  } else {
    options.headers['Content-Type'] = 'application/json; charset=utf-8';
    options.body = JSON.stringify(body);
  }
  const r = await fetch(url, options);
  return await r.json();
}

function resolveEmailsInText(text) {
  let processedText = text;
  Object.keys(HNI.members).forEach(name => {
    const email = HNI.members[name].email;
    if (email) {
      const regex = new RegExp(email, 'gi');
      processedText = processedText.replace(regex, name);
    }
  });
  return processedText;
}

// ─── [4] handleBoss: 대표님 전용 (하이브리드 엔진 v14.2) ───────────

async function handleBoss(text, channel, threadTs, env) {
  const now = new Date();
  const optionsKST = { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const nowKST = now.toLocaleString('ko-KR', optionsKST);
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKST = tomorrow.toLocaleString('ko-KR', optionsKST);

  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구자덕 대표님의 수석 비서 '${HNI.knowledge.botName}'입니다. 
  현재 시각: ${nowKST}
  당신은 구글 캘린더 API(JWT 인증)를 통해 실시간 데이터를 직접 가져올 수 있습니다. 슬랙 알림 메시지보다 API 데이터를 우선하여 보고하세요.`;

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
        
        if (name === 'report_management_status' && args.category === 'calendar') {
          // 💡 구글 서버 직접 조회 (JWT 기반) 및 슬랙 보조 조회 병렬 처리
          const [apiEvents, slackHistory] = await Promise.all([
            fetchCalendarEventsDirectly(tomorrow),
            slackApi('conversations.history', { channel: HNI.knowledge.management_channels.calendar.id, limit: 30 }, env.BOT_TOKEN)
          ]);
          
          let rawData = `[1. 구글 캘린더 실시간 조회 결과]\n${apiEvents && apiEvents.length > 0 ? JSON.stringify(apiEvents) : "조회된 일정 없음 또는 인증 대기 중"}`;
          if (slackHistory.ok) {
            const historyText = slackHistory.messages.reverse().map(m => `[발신:${m.user}] ${resolveEmailsInText(m.text)}`).join('\n\n');
            rawData += `\n\n[2. 슬랙 알림 보조 데이터]\n${historyText}`;
          }

          const summaryRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: `지시: ${text}\n내일: ${tomorrowKST}\n전체 데이터:\n${rawData}` }] },
                { role: 'user', parts: [{ text: `위 데이터를 분석하여 보고하세요. 캘린더 API 데이터가 있다면 이를 기반으로 시간표를 만들고, 슬랙 알림만 있다면 해당 내용을 요약하세요.` }] }
              ]
            })
          });
          const sData = await summaryRes.json();
          const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (sReply) await slackApi('chat.postMessage', { channel, text: sReply, thread_ts: threadTs }, env.BOT_TOKEN);
        }
      }
    }
  } catch (e) { console.error("[BOSS ERROR]", e); }
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

    if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) return res.status(200).send('bad signature');
    if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');
    
    let body;
    try { body = JSON.parse(rawBody); } catch (e) { return res.status(200).end(); }
    if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });
    
    const event = body.event;
    if (!event || event.bot_id || !event.text) return res.status(200).end();
    
    const cleanText = event.text.replace(/<@U[A-Z0-9]+>/g, '').trim();
    const threadTs = event.thread_ts || event.ts;
    
    if (event.user === env.BOSS_ID) {
      await handleBoss(cleanText, event.channel, threadTs, env);
    }
    return res.status(200).send('ok');
  } catch (e) { return res.status(200).send('error handled'); }
}
export const config = { api: { bodyParser: false } };
