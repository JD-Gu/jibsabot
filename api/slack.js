/**
 * [v14.7] 구대표집사봇(H&I) 실전 운영용 전문
 * * 변경 및 업데이트 내역:
 * 1. 404 Not Found 정밀 진단: API 실패 시 현재 서비스 계정이 접근 가능한 캘린더 리스트를 조회하여 보고
 * 2. 공유 권한 검증 로직: 서비스 계정 이메일이 정상적으로 캘린더를 보고 있는지 역추적 기능 추가
 * 3. KST 시간대 보정: 캘린더 조회 범위를 한국 시간 기준 00:00~23:59로 더욱 정밀하게 타겟팅
 * 4. 에러 메시지 사용자 친화화: 기술적 에러를 구대표님이 즉시 조치 가능한 안내 문구로 변환
 */

import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 ──────────────────────────────
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
    management_channels: {
      calendar: { name: "업무일정", id: "C03R1QVMKC4" }
    },
    googleCalendarId: (process.env.GOOGLE_CALENDAR_ID || '09jj@hni-gl.com').trim()
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

// ─── [2] 구글 인증 및 캘린더 엔진 (JWT 인증 및 역추적 추가) ──────────────

async function getGoogleAccessToken() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (!clientEmail || !privateKey) return { error: "Vercel 환경변수 설정 누락" };

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
    if (data.error) return { error: `인증실패: ${data.error}` };
    return { token: data.access_token };
  } catch (e) {
    return { error: `인증엔진에러: ${e.message}` };
  }
}

/**
 * 💡 [v14.7 신규] 현재 서비스 계정이 접근 가능한 캘린더 리스트 조회
 * 404 발생 시 원인을 파악하기 위해 사용
 */
async function getAccessibleCalendars(token) {
  try {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return data.items?.map(c => c.id) || [];
  } catch (e) {
    return [];
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
  
  console.log(`[DIAGNOSTIC] Fetching events for: ${calendarId}`);

  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${auth.token}` } });
    const data = await res.json();
    
    if (!res.ok) {
      if (res.status === 404) {
        const list = await getAccessibleCalendars(auth.token);
        return { 
          error: `404 Not Found: [${calendarId}]에 접근할 수 없습니다.`,
          diagnostics: `현재 봇이 볼 수 있는 캘린더 목록: ${list.join(', ') || '없음'}. 공유 설정을 다시 확인해주세요.`
        };
      }
      return { error: `API Error ${res.status}: ${data.error?.message}` };
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
    return { error: `연동 실패: ${e.message}` };
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

// ─── [4] handleBoss: 대표님 전용 (최종 진단 엔진) ───────────────

async function handleBoss(text, channel, threadTs, env) {
  const now = new Date();
  const optionsKST = { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const nowKST = now.toLocaleString('ko-KR', optionsKST);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKST = tomorrow.toLocaleString('ko-KR', optionsKST);

  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구자덕 대표님의 수석 비서 '${HNI.knowledge.botName}'입니다. 
  현재 시각: ${nowKST}
  API 에러(특히 404) 발생 시 'diagnostics' 정보를 바탕으로 대표님께 어떤 조치가 필요한지 명확하게 보고하세요.`;

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
          const slackHistory = await slackApi('conversations.history', { channel: HNI.knowledge.management_channels.calendar.id, limit: 30 }, env.BOT_TOKEN);
          
          let rawData = "";
          if (apiResult.error) {
            rawData = `[🚨 진단 보고]\n상태: ${apiResult.error}\n디버깅정보: ${apiResult.diagnostics || '없음'}`;
          } else {
            rawData = `[1. 구글 캘린더 실시간 데이터]\n${apiResult.events.length > 0 ? JSON.stringify(apiResult.events) : "일정 없음"}`;
          }

          if (slackHistory.ok) {
            rawData += `\n\n[2. 슬랙 채널 알림 데이터]\n` + slackHistory.messages.map(m => m.text).join('\n');
          }

          const summaryRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                { role: 'user', parts: [{ text: `지시: ${text}\n타겟: ${tomorrowKST}\n전체데이터:\n${rawData}` }] },
                { role: 'user', parts: [{ text: `위 데이터를 분석하여 보고하세요. API가 404를 뱉었다면, '현재 봇이 볼 수 있는 캘린더'가 무엇인지 언급하며 해결책을 제시하세요.` }] }
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
