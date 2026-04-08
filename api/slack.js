/**
 * [v15.3] 구대표집사봇(H&I) 실전 운영용 통합 마스터 버전 (버그 수정 및 로깅 완비)
 * * * [수정 사항]
 * 1. ReferenceError 해결: 누락되었던 verifySlackRequest 보안 검증 함수 복구
 * 2. 로깅 시스템 표준화: [INBOUND], [AUTH], [EVENT], [TOOL] 등 태그별 로깅 유지
 * 3. 통합 기능 유지: Google Calendar API(JWT), 3대 채널 분석, 자가 진단 엔진 포함
 * 4. 안정성 강화: 비정상적인 신호 유입 시 예외 처리 및 에러 보고 로직 강화
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
    management_channels: {
      finance: { name: "경영재무", id: "C02M8BMJZG9" }, 
      sales: { name: "영업지원", id: "C06DRAHHAQZ" },
      calendar: { name: "업무일정", id: "C03R1QVMKC4" }
    },
    googleCalendarId: (process.env.GOOGLE_CALENDAR_ID || '09jj@hni-gl.com').trim()
  }
};

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: 'report_management_status',
      description: '사내 경영(재무), 영업, 일정 관련 데이터를 해당 채널에서 조회하여 분석 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: '분야' },
          query: { type: 'STRING', description: '검색 날짜 또는 키워드' }
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

// ─── [3] 구글 정식 인증 및 데이터 엔진 ────────────────────────

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
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

async function fetchCalendarEventsDirectly(queryDate) {
  const auth = await getGoogleAccessToken();
  if (auth.error) return { error: auth.error };

  const calendarId = HNI.knowledge.googleCalendarId;
  const start = new Date(queryDate); start.setHours(0, 0, 0, 0);
  const end = new Date(queryDate); end.setHours(23, 59, 59, 999);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`;
  
  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${auth.token}` } });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 404) {
        const list = await getAccessibleCalendars(auth.token);
        return { error: `404 Not Found`, diagnostics: `접근 가능 목록: ${list.join(', ') || '없음'}` };
      }
      return { error: `API Error ${res.status}` };
    }
    return { events: data.items?.map(ev => ({ title: ev.summary, time: ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString('ko-KR') : "종일", location: ev.location || "장소미지정" })) || [] };
  } catch (e) { return { error: e.message }; }
}

// ─── [4] handleBoss: 대표님 전용 통합 관리 엔진 ───────────────────

async function handleBoss(text, channel, threadTs, env) {
  const now = new Date();
  const optionsKST = { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const nowKST = now.toLocaleString('ko-KR', optionsKST);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKST = tomorrow.toLocaleString('ko-KR', optionsKST);

  console.log(`[BOSS] Processing: "${text}" at ${nowKST}`);

  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구자덕 대표님의 수석 비서 '${HNI.knowledge.botName}'입니다.
  현재 시각: ${nowKST}
  [미션] 대표님의 질문 의도에 따라 아래 채널에서 데이터를 분석 보고하세요.
  1. 경영실적/현황: #경영재무 채널(finance)
  2. 영업실적/현황: #영업지원 채널(sales)
  3. 업무일정: 구글 캘린더 API + #업무일정 채널(calendar)`;

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
          
          if (args.category === 'calendar') {
            const apiResult = await fetchCalendarEventsDirectly(tomorrow);
            if (apiResult.error) rawData = `[⚠️ API 연동 에러]\n사유: ${apiResult.error}\n진단: ${apiResult.diagnostics || '없음'}\n\n`;
            else rawData = `[1. 구글 캘린더 직접 데이터]\n${JSON.stringify(apiResult.events)}\n\n`;
          }
          
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: 100 }, env.BOT_TOKEN);
          if (historyRes.ok) {
            const context = historyRes.messages.reverse().map(m => `[발신:${Object.keys(HNI.members).find(k=>HNI.members[k].id===m.user)||m.user}] ${resolveEmailsInText(m.text)}`).join('\n\n');
            rawData += `[#${targetChannel.name} 채널 데이터]\n${context}`;
          }

          const summaryRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: `지시: ${text}\n타겟날짜: ${tomorrowKST}\n전체 데이터:\n${rawData}` }] },
                { role: 'user', parts: [{ text: `위 데이터를 분석하여 보고하세요.` }] }
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

    // 💡 [v15.3] verifySlackRequest 함수가 이제 정의되어 있어 에러가 나지 않습니다.
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
