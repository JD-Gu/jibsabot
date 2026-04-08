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
    '지우현': { id: 'U02MJRGEP7F', email: '90jay@hni-gl.com', dept: '플랫폼', role: '프로' }
  },
  knowledge: {
    companyName: "주식회사 에이치앤아이 (H&I)",
    ceo: "구자덕 대표이사",
    vision: "초정밀 위치 정보를 기반으로 모든 이동의 안전과 지능화를 선도하는 '국내 1위 초정밀 측위 플랫폼 기업'",
    management_channels: {
      finance: { name: "cmm-cxo", id: "C02M8BMJZG9" }, 
      sales: { name: "cmm-영업지원", id: "C06DRAHHAQZ" },
      calendar: { name: "업무일정(구글캘린더)", id: "C03R1QVMKC4" }
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
      description: '재무, 영업, 업무일정 채널의 이력을 분석하여 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: '분야' },
          query: { type: 'STRING', description: '집중 검색어 (예: 특정 날짜, 인물)' }
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

async function fetchWithRetry(url, options, maxRetries = 3) {
  const delays = [1500, 3000, 7000]; 
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 18000); 
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (response.status === 429 && i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delays[i]));
        continue;
      }
      return response;
    } catch (e) {
      clearTimeout(id);
      if (i === maxRetries) throw e;
      await new Promise(resolve => setTimeout(resolve, delays[i]));
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

async function findUserIdByName(name, token) {
  const res = await slackApi('users.list', { limit: 1000 }, token); 
  if (!res.ok) return null;
  const found = res.members.find(m => m.profile?.real_name?.includes(name) || m.real_name?.includes(name));
  return found ? found.id : null;
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

async function getChatContext(channel, token, limit = 8) {
  const res = await slackApi('conversations.history', { channel, limit }, token);
  if (!res.ok) return [];
  return res.messages
    .reverse()
    .filter(m => m.text && !m.text.includes('할당량이 소진되었습니다'))
    .map(m => ({
      role: m.bot_id ? "model" : "user",
      parts: [{ text: m.text }]
    }));
}

// ─── [3] handleBoss: 대표님용 (구글 캘린더 파싱 지능화) ───────────────

async function handleBoss(text, channel, env) {
  const nowKST = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`[대표님 지시 수신] ${text} | 기준시각: ${nowKST}`);
  
  const systemPrompt = `당신은 에이치앤아이(H&I) 구대표님의 전담 비서 '구대표집사봇'입니다.
  현재 시각: ${nowKST}
  
  [구글 캘린더 데이터 해석 지침]
  1. 구글 캘린더 메시지는 'Event updated!', '15 minutes until...', 'Event cancelled.' 등 중복 알림이 많습니다.
  2. 반드시 'When:' 필드에 적힌 날짜와 시간을 기준으로 판단하세요.
  3. 'Event updated!' 메시지의 경우, 여러 개의 'When:'이 있으면 가장 아래(최신) 정보를 유효한 것으로 간주하세요.
  4. '내일' 일정을 물으면 ${nowKST} 기준 다음 날짜의 모든 일정을 찾아 리스트로 보고하세요.
  5. 정보가 누락되지 않도록 꼼꼼히 훑으세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const history = await getChatContext(channel, env.BOT_TOKEN);
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: history,
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: GEMINI_TOOLS
      })
    });
    
    const data = await response.json();
    if (data.error && data.error.code === 429) {
      return await slackApi('chat.postMessage', { channel, text: "⏳ 현재 엔진 할당량이 소진되었습니다. 잠시 후 시도해 주세요." }, env.BOT_TOKEN);
    }

    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        
        if (name === 'send_message') {
          let targetId = HNI.members[args.name]?.id || await findUserIdByName(args.name, env.BOT_TOKEN);
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${args.name}님께 다음 내용을 전달했습니다:\n> ${args.message}` }, env.BOT_TOKEN);
          }
        }
        
        if (name === 'report_management_status') {
          const targetChannel = HNI.knowledge.management_channels[args.category];
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: 100 }, env.BOT_TOKEN);
          
          if (historyRes.ok && historyRes.messages.length > 0) {
            const userCache = {};
            const messagesWithNames = await Promise.all(historyRes.messages.reverse().map(async (m) => {
              let senderName = Object.keys(HNI.members).find(key => HNI.members[key].id === m.user);
              if (!senderName && m.user && !userCache[m.user]) {
                const uInfo = await slackApi('users.info', { user: m.user }, env.BOT_TOKEN);
                if (uInfo.ok) userCache[m.user] = uInfo.user.profile.real_name || uInfo.user.name;
              }
              senderName = senderName || userCache[m.user] || m.user || "시스템";
              const resolvedText = resolveEmailsInText(m.text);
              return `[발신:${senderName}] ${resolvedText}`;
            }));

            const context = messagesWithNames.join('\n\n');
            const summaryRes = await fetchWithRetry(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  { role: 'user', parts: [{ text: `기준 시각: ${nowKST}\n대표님 지시: ${text}\n\n[채널 데이터]\n${context}` }] },
                  { role: 'user', parts: [{ text: `위 데이터에서 대표님이 요청하신 날짜의 일정만 골라내어 명확하게 보고하세요. 취소된 일정은 제외하고, 업데이트된 일정은 최종 시간을 반영하세요.` }] }
                ]
              })
            });
            const sData = await summaryRes.json();
            const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (sReply) await slackApi('chat.postMessage', { channel, text: sReply }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    console.error('[에러]', e);
    await slackApi('chat.postMessage', { channel, text: `⚠️ 응답 중 지연이 발생했습니다. 다시 지시해 주세요.` }, env.BOT_TOKEN);
  }
}

// ─── [4] handleMember: 직원용 ──────────────────────────────────

async function handleMember(senderId, text, channel, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "직원";
  const systemPrompt = `당신은 에이치앤아이(H&I) AI 집사입니다. 친절히 대화하고 마지막에 [REPORT_STRENGTH: LOW/HIGH]를 붙이세요.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const history = await getChatContext(channel, env.BOT_TOKEN);
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: history, system_instruction: { parts: [{ text: systemPrompt }] } })
    });
    const data = await response.json();
    let reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const isHigh = reply.includes('REPORT_STRENGTH: HIGH');
    reply = reply.replace(/\[REPORT_STRENGTH: (LOW|HIGH)\]/g, "").trim();
    if (reply) await slackApi('chat.postMessage', { channel, text: reply }, env.BOT_TOKEN);
    if (isHigh) {
      await slackApi('chat.postMessage', { channel: env.BOSS_ID, text: `🔔 *[중요 직원 대화 보고]*\n발신자: ${name}\n내용: ${text}` }, env.BOT_TOKEN);
    }
  } catch (e) { console.error('[직원 응대 에러]', e); }
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
    
    if (event.user === env.BOSS_ID) {
      await handleBoss(event.text.trim(), event.channel, env);
    } else {
      await handleMember(event.user, event.text.trim(), event.channel, env);
    }
    
    return res.status(200).send('ok');
  } catch (globalError) {
    console.error('[CRITICAL RUNTIME ERROR]', globalError);
    return res.status(200).send('error handled');
  }
}

export const config = { api: { bodyParser: false } };
console.log("[H&I Slack Bot] Script Loaded Successfully");
