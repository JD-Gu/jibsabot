import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 (H&I 전 직원 마스터 데이터 반영) ──────────
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
    ceo: "구자덕 대표이사 (공간정보 분야 30년 베테랑)",
    vision: "초정밀 위치 정보를 기반으로 모든 이동의 안전과 지능화를 선도하는 '국내 1위 초정밀 측위 플랫폼 기업'",
    coreStrengths: [
      "전국 200여 개의 GNSS 상시관측소(기준국) 인프라 운영",
      "LG유플러스와의 독점적 파트너십을 통한 전국망 RTK 서비스 제공",
      "공간정보 전문 역량 기반의 실시간 위치 보정 기술력 보유"
    ],
    technicalDetails: {
      gnss_rtk: "Network-RTK 기반 cm급 초정밀 측위 기술. 자율주행, 드론 정밀 항법 등에 활용.",
      hi_ppe: "HI-PPE. 임베디드 제어 기술과 AI 엣지를 결합한 지능형 정밀측위 및 안전 솔루션.",
      ai_live: "AI라이브 플랫폼. 실시간 위치 데이터와 AI 비전을 결합하여 디지털 트윈 구현.",
      vision_ai: "AI 엣지 비전을 활용한 객체 인식 기술."
    },
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
          name: { type: 'STRING', description: '메시지를 받을 직원 이름 (성함만)' },
          message: { type: 'STRING', description: '전달할 내용' }
        },
        required: ['name', 'message']
      }
    },
    {
      name: 'report_management_status',
      description: '재무, 영업, 업무일정 채널의 이력을 훑어서 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: '보고 분야' },
          query: { type: 'STRING', description: '요약 시 집중할 키워드 또는 인물 이름' }
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

// ─── [3] 데이터 전처리: 텍스트 내 이메일을 실명으로 치환 ────────────────

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

// ─── [4] handleBoss: 대표님용 (마스터 데이터 기반 맥락 보고) ───────────────

async function handleBoss(text, channel, env) {
  // 💡 [v12.5 핵심] AI에게 현재 날짜/시간 정보를 주입
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  
  console.log(`[대표님 지시 수신] ${text}`);
  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구대표님의 전담 비서 '구대표집사봇'입니다.
  
  현재 시각: ${now} (이 정보를 기준으로 '오늘', '내일', '모레'를 계산하세요)
  
  지침:
  1. [전 직원 명단 반영] HNI.members에 등록된 정보를 바탕으로 이메일을 성함으로 치환하여 인식합니다.
  2. 일정을 물으면(예: '내일 일정'), 현재 시각을 기준으로 해당 날짜의 데이터를 채널 이력에서 찾아 요약 보고하세요.
  3. 모든 보고는 싹싹하고 전문적으로 하세요.`;

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
      return await slackApi('chat.postMessage', { channel, text: "⏳ 구대표님, 엔진 사용량이 많아 잠시 후 다시 시도해 주세요." }, env.BOT_TOKEN);
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
          // 💡 탐색 범위를 50개로 확장하여 더 많은 일정을 훑음
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: 50 }, env.BOT_TOKEN);
          
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
                contents: [{ role: 'user', parts: [{ text: text }] }, { role: 'model', parts: [part] }, { role: 'user', parts: [{ text: `기준 시각: ${now}\n채널 가공 데이터:\n${context}\n\n위 데이터에서 사용자가 요청한 날짜(예: 내일)의 일정만 추출하여 보고하세요.` }] }]
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
    console.error('[핸들러 에러]', e);
    await slackApi('chat.postMessage', { channel, text: `⚠️ 응답 중 오류가 발생했습니다. 다시 지시해주세요.` }, env.BOT_TOKEN);
  }
}

// ─── [5] handleMember: 직원용 ──────────────────────────────────

async function handleMember(senderId, text, channel, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "직원";
  const systemPrompt = `당신은 ${HNI.knowledge.companyName}의 AI 비서 '구대표집사봇'입니다. 사내 기술(${JSON.stringify(HNI.knowledge.technicalDetails)})에 답하고 친절히 대화하세요. 마지막에 [REPORT_STRENGTH: LOW/HIGH]를 붙이세요.`;
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
  } catch (e) { console.error(e); }
}

// ─── [6] 메인 핸들러 (최상위 예외 처리) ───────────────────────────

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const env = { BOT_TOKEN: process.env.SLACK_BOT_TOKEN, BOSS_ID: process.env.BOSS_USER_ID, GEMINI_KEY: process.env.GEMINI_API_KEY, SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET };
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
