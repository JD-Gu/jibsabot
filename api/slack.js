import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
    '구자덕': { id: 'U02M1T5E1N3', dept: '경영진', role: '대표이사' }, // 대표님 ID 명시적 추가
    '김봉석': { id: null, dept: '기술연구소', role: '소장' },
    '김찬영': { id: null, dept: '기술연구소', role: '연구원' },
    '이지민': { id: null, dept: '상품관리팀', role: '팀장' },
    '정현수': { id: null, dept: '플랫폼팀', role: '팀장' },
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
      gnss_rtk: "Network-RTK 기반 cm급 초정밀 측위 기술. 자율주행, 드론 정밀 항법, 시설물 변위 모니터링에 활용.",
      hi_ppe: "HI-PPE. 임베디드 제어 기술과 AI 엣지를 결합한 지능형 정밀측위솔루션.",
      ai_live: "AI라이브 플랫폼. 실시간 위치 데이터와 AI 비전을 결합하여 현장의 상황을 디지털 트윈으로 구현하는 실시간 맵핑 기술.",
      vision_ai: "AI 엣지 비전을 활용한 객체 인식 및 안전 위험 요소 실시간 감지 기술."
    },
    businessDomains: {
      smart_construction: "건설 현장 안전 관리 플랫폼 및 지능형 PPE 보급",
      telematics: "차량 및 이동체의 실시간 정밀 위치 관제 솔루션",
      autonomous: "자율주행 로봇 및 드론을 위한 항법 보정 데이터 서비스"
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
      description: '재무(#cmm-cxo), 영업(#cmm-영업지원), 업무일정(#업무일정) 채널의 최신 이력을 훑어서 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales', 'calendar'], description: '보고 분야 (finance:재무, sales:영업, calendar:업무일정)' },
          query: { type: 'STRING', description: '요약 시 집중할 키워드' }
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

// ─── [3] handleBoss: 대표님용 (맥락 + 자동 이름 매핑 강화) ──────────────────

async function handleBoss(text, channel, env) {
  console.log(`[대표님 지시 수신] ${text}`);
  const systemPrompt = `당신은 ${HNI.knowledge.companyName} 구대표님의 전담 비서 '구대표집사봇'입니다. 
  1. 경영현황 및 일정 질문 시 해당 채널 정보를 훑어보고 실명 위주로 보고하세요.
  2. 슬랙 ID가 보이면 사람 이름으로 치환하여 자연스럽게 보고하세요.
  3. 싹싹하고 전문적으로 대답하세요.`;

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
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${args.name}님께 메시지를 전달했습니다:\n> ${args.message}` }, env.BOT_TOKEN);
          }
        }
        
        if (name === 'report_management_status') {
          const targetChannel = HNI.knowledge.management_channels[args.category];
          console.log(`[정보 조회 시작] 채널: ${targetChannel.name}`);
          
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: 15 }, env.BOT_TOKEN);
          
          if (historyRes.ok && historyRes.messages.length > 0) {
            // 💡 [v12.0 핵심] User ID를 실명으로 변환하는 로직
            const userCache = {};
            const messagesWithNames = await Promise.all(historyRes.messages.reverse().map(async (m) => {
              if (!m.user) return `[기타] ${m.text}`;
              
              // 캐시 및 HNI.members 확인
              let displayName = Object.keys(HNI.members).find(key => HNI.members[key].id === m.user);
              if (!displayName && !userCache[m.user]) {
                const uInfo = await slackApi('users.info', { user: m.user }, env.BOT_TOKEN);
                if (uInfo.ok) userCache[m.user] = uInfo.user.profile.real_name || uInfo.user.name;
              }
              displayName = displayName || userCache[m.user] || m.user;
              return `[발신:${displayName}] ${m.text}`;
            }));

            const context = messagesWithNames.join('\n\n');
            const summaryRes = await fetchWithRetry(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: text }] }, { role: 'model', parts: [part] }, { role: 'user', parts: [{ text: `채널(#${targetChannel.name})의 대화 내용(ID 변환 완료)입니다:\n${context}\n\n이 내용을 분석하여 대표님께 보고하세요.` }] }]
              })
            });
            const sData = await summaryRes.json();
            const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (sReply) await slackApi('chat.postMessage', { channel, text: sReply }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ 데이터를 가져오지 못했습니다.` }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    console.error('[핸들러 에러]', e);
    await slackApi('chat.postMessage', { channel, text: `⚠️ 응답 중 오류가 발생했습니다. 다시 지시해주세요.` }, env.BOT_TOKEN);
  }
}

// ─── [4] handleMember: 직원용 ──────────────────────────────────

async function handleMember(senderId, text, channel, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "직원";
  const systemPrompt = `당신은 ${HNI.knowledge.companyName}의 AI 비서 '구대표집사봇'입니다. 기술 질문(${JSON.stringify(HNI.knowledge.technicalDetails)})에 답하고 친절히 대화하세요. 답변 마지막에 "[REPORT_STRENGTH: LOW/HIGH]"를 붙이세요.`;
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

// ─── [5] 메인 핸들러 ──────────────────────────────────────

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
