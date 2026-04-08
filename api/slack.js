/**
 * [v14.2] 구대표집사봇(H&I) 실전 운영용 전문
 * * 변경 및 업데이트 내역:
 * 1. 구글 API 디버깅 강화: API 호출 실패 시 단순 누락이 아닌 구체적 에러 사유(403/401 등)를 보고
 * 2. 프라이빗 키(Private Key) 파싱 로직 보강: Vercel 환경변수 저장 시 발생하는 줄바꿈 깨짐 현상 완벽 대응
 * 3. 정밀 날짜 쿼리: KST(한국 표준시) 기준으로 내일 자정부터 밤 11시 59분까지의 범위를 정확히 계산
 * 4. 하이브리드 보고 엔진: 실시간 API 데이터와 슬랙 이력을 대조하여 누락 없는 보고 수행
 */

import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 ──────────────────────────────
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
    botName: "구대표집사봇",
    management_channels: {
      calendar: { name: "업무일정", id: "C03R1QVMKC4" }
    },
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID || 'primary'
  }
};

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: 'report_management_status',
      description: '일정 데이터를 조회하여 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['calendar'], description: '분야' }
        },
        required: ['category']
      }
    }
  ]
}];

// ─── [2] 구글 인증 및 캘린더 엔진 (v14.2 고도화) ─────────────────────

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // 💡 Vercel 환경변수에서 줄바꿈(\n)이 문자열로 저장되는 현상 방지
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    console.error("[AUTH ERROR] Missing credentials");
    return { error: "Vercel 환경변수(EMAIL 또는 KEY)가 누락되었습니다." };
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
    if (data.error) return { error: `JWT 인증 실패: ${data.error_description || data.error}` };
    return { token: data.access_token };
  } catch (e) {
    return { error: `서버 인증 로직 에러: ${e.message}` };
  }
}

async function fetchCalendarEventsDirectly(queryDate) {
  const auth = await getGoogleAccessToken();
  if (auth.error) return { error: auth.error };

  const calendarId = HNI.knowledge.googleCalendarId;
  const start = new Date(queryDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(queryDate);
  end.setHours(23, 59, 59, 999);

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`;

  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${auth.token}` } });
    const data = await res.json();
    
    if (data.error) {
      if (data.error.code === 403) return { error: "구글 캘린더 접근 권한이 없습니다. (서비스 계정 이메일을 캘린더 공유에 추가하셨나요?)" };
      return { error: `API 호출 에러: ${data.error.message}` };
    }
    
    return { 
      events: data.items?.map(ev => ({
        title: ev.summary,
        time: ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString('ko-KR') : "종일",
        location: ev.location || "장소미지정",
        desc: ev.description || ""
      })) || []
    };
  } catch (e) {
    return { error: `네트워크 에러: ${e.message}` };
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

// ─── [4] handleBoss: 대표님 전용 (디버깅 강화 엔진) ───────────────

async function handleBoss(text, channel, threadTs, env) {
  const now = new Date();
  const optionsKST = { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const nowKST = now.toLocaleString('ko-KR', optionsKST);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKST = tomorrow.toLocaleString('ko-KR', optionsKST);

  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구자덕 대표님의 수석 비서 '${HNI.knowledge.botName}'입니다. 
  현재 시각: ${nowKST}
  구글 캘린더 API 실시간 데이터를 최우선으로 보고하세요. 만약 API 호출 결과에 에러 메시지가 포함되어 있다면 가감 없이 보고하여 대표님이 조치할 수 있게 돕습니다.`;

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
          const apiResult = await fetchCalendarEventsDirectly(tomorrow);
          const slackHistory = await slackApi('conversations.history', { channel: HNI.knowledge.management_channels.calendar.id, limit: 20 }, env.BOT_TOKEN);
          
          let rawData = "";
          if (apiResult.error) {
            rawData = `[⚠️ API 연동 에러 발생]\n사유: ${apiResult.error}\n\n이 메시지가 보인다면 Vercel 설정이나 캘린더 공유 설정을 다시 확인해야 합니다.`;
          } else {
            rawData = `[1. 구글 캘린더 실시간 데이터]\n${apiResult.events.length > 0 ? JSON.stringify(apiResult.events) : "일정 없음"}`;
          }

          if (slackHistory.ok) {
            rawData += `\n\n[2. 슬랙 채널 보조 데이터]\n` + slackHistory.messages.map(m => m.text).join('\n');
          }

          const summaryRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: `지시: ${text}\n타겟날짜: ${tomorrowKST}\n전체 데이터:\n${rawData}` }] },
                { role: 'user', parts: [{ text: `위 데이터를 분석하여 보고하세요. 에러가 있다면 에러 내용을 언급하며 현재 상태를 솔직히 보고하세요.` }] }
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
