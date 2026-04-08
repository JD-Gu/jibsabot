import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 (H&I 전 직원 마스터 데이터) ──────────────
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
    coreTech: "GNSS/RTK 초정밀 측위(cm급), HI-PPE 지능형 초정밀 측위 엔진, AI라이브 플랫폼, 비전 AI 엣지 기술",
    vision: "초정밀 위치 정보를 기반으로 모든 이동의 안전과 지능화를 선도하는 국내 1위 측위 플랫폼 기업",
    management_channels: {
      finance: { name: "경영재무", id: "C02M8BMJZG9" }, 
      sales: { name: "영업지원", id: "C06DRAHHAQZ" },
      calendar: { name: "업무일정", id: "C03R1QVMKC4" }
    }
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
      description: '사내 주요 채널(재무, 영업, 일정)의 데이터를 분석하여 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: '분야' },
          query: { type: 'STRING', description: '검색 키워드 (날짜 또는 인물)' }
        },
        required: ['category']
      }
    }
  ]
}];

// ─── [2] 유틸리티 및 보안 ──────────────────────────────────────

function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  const hmac = crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return `v0=${hmac}` === signature;
}

// 💡 타임아웃 방지를 위해 개별 요청 시간을 12초로 제한
async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 12000); 
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (response.status === 429 && i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      return response;
    } catch (e) {
      clearTimeout(id);
      if (i === maxRetries) throw e;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

async function slackApi(endpoint, body, token) {
  const isRead = endpoint.includes('.list') || endpoint.includes('.info') || endpoint.includes('.history') || endpoint.includes('search.');
  const method = isRead ? 'GET' : 'POST';
  let url = `https://slack.com/api/${endpoint}`;
  let options = { method, headers: { 'Authorization': `Bearer ${token}` } };
  if (method === 'GET' && body) {
    const params = new URLSearchParams(body).toString();
    url += (params ? `?${params}` : '');
  } else if (method === 'POST') {
    options.headers['Content-Type'] = 'application/json; charset=utf-8';
    options.body = JSON.stringify(body);
  }
  const r = await fetchWithRetry(url, options);
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

async function getChatContext(channel, token, limit = 10) {
  try {
    const res = await slackApi('conversations.history', { channel, limit }, token);
    if (!res.ok) return [];
    return res.messages.reverse().map(m => ({
      role: m.bot_id ? "model" : "user",
      parts: [{ text: m.text || "" }]
    }));
  } catch (e) { return []; }
}

// ─── [3] handleBoss: 대표님 전용 (최적화 모드) ───────────────────────

async function handleBoss(text, channel, threadTs, env) {
  const now = new Date();
  const optionsKST = { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  const nowKST = now.toLocaleString('ko-KR', optionsKST);
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKST = tomorrow.toLocaleString('ko-KR', optionsKST);
  const tomorrowEN = tomorrow.toLocaleString('en-US', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
  const tomorrowDayEN = tomorrow.toLocaleString('en-US', { timeZone: 'Asia/Seoul', weekday: 'long' });

  console.log(`[BOSS] Processing: ${text}`);

  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구자덕 대표님의 수석 비서 '${HNI.knowledge.botName}'입니다.
  현재(오늘): ${nowKST}
  내일: ${tomorrowKST} (영문: ${tomorrowDayEN}, ${tomorrowEN})
  
  일정 검색 시 구글 캘린더 데이터(${tomorrowDayEN}, ${tomorrowEN})를 기필코 찾아 논리적이고 객관적으로 보고하세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const history = await getChatContext(channel, env.BOT_TOKEN);
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [...history, { role: "user", parts: [{ text }] }],
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
        
        if (name === 'send_message') {
          const target = Object.entries(HNI.members).find(([n]) => n.includes(args.name));
          if (target) {
            await slackApi('chat.postMessage', { channel: target[1].id, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${target[0]}님께 메시지를 전송했습니다.`, thread_ts: threadTs }, env.BOT_TOKEN);
          }
        }
        
        if (name === 'report_management_status') {
          const targetChannel = HNI.knowledge.management_channels[args.category];
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: 100 }, env.BOT_TOKEN);
          
          if (historyRes.ok) {
            // 💡 최적화: users.info 호출을 생략하고 HNI.members와 이메일 치환만 사용하여 속도 확보
            const context = historyRes.messages.reverse().map(m => {
              const senderName = Object.keys(HNI.members).find(key => HNI.members[key].id === m.user) || m.user || "시스템";
              return `[발신:${senderName}] ${resolveEmailsInText(m.text)}`;
            }).join('\n\n');

            const summaryRes = await fetchWithRetry(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  { role: 'user', parts: [{ text: `지시: ${text}\n타겟: ${tomorrowDayEN}, ${tomorrowEN}\n데이터:\n${context}` }] },
                  { role: 'user', parts: [{ text: `위 데이터에서 해당 날짜의 일정을 요약 보고하세요. 없으면 없다고 하세요.` }] }
                ]
              })
            });
            const sData = await summaryRes.json();
            const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (sReply) await slackApi('chat.postMessage', { channel, text: sReply, thread_ts: threadTs }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    console.error("[CRITICAL BOSS ERROR]", e);
    // 타임아웃 발생 시 사용자에게 안내
    await slackApi('chat.postMessage', { channel, text: "⚠️ 데이터 분석량이 많아 처리가 지연되고 있습니다. 잠시 후 다시 시도해 주시겠습니까?", thread_ts: threadTs }, env.BOT_TOKEN);
  }
}

// ─── [4] handleMember: 임직원 응대 ────────────────────────────────

async function handleMember(senderId, text, channel, threadTs, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "임직원";
  const systemPrompt = `당신은 ${HNI.knowledge.companyName}의 공식 AI 비서 '${HNI.knowledge.botName}'입니다. 
  친절하고 전문적으로 답하고 답변 끝에 [REPORT_STRENGTH: LOW/HIGH]를 붙이세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const history = await getChatContext(channel, env.BOT_TOKEN);
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [...history, { role: "user", parts: [{ text }] }], system_instruction: { parts: [{ text: systemPrompt }] } })
    });
    const data = await response.json();
    let reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const isHigh = reply.includes('REPORT_STRENGTH: HIGH');
    reply = reply.replace(/\[REPORT_STRENGTH: (LOW|HIGH)\]/g, "").trim();

    if (reply) await slackApi('chat.postMessage', { channel, text: reply, thread_ts: threadTs }, env.BOT_TOKEN);
    if (isHigh) {
      await slackApi('chat.postMessage', { channel: env.BOSS_ID, text: `🔔 *[직원 대화 보고]*\n발신자: ${name}\n내용: ${text}` }, env.BOT_TOKEN);
    }
  } catch (e) { console.error('[MEMBER ERROR]', e); }
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

    if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) return res.status(401).end();
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
    } else {
      await handleMember(event.user, cleanText, event.channel, threadTs, env);
    }
    return res.status(200).send('ok');
  } catch (globalError) {
    console.error('[GLOBAL ERROR]', globalError);
    return res.status(200).send('error handled');
  }
}
export const config = { api: { bodyParser: false } };
