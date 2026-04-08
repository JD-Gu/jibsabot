import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
    '김봉석': { id: null, dept: '기술연구소', role: '소장' },
    '김찬영': { id: null, dept: '기술연구소', role: '연구원' },
    '이지민': { id: null, dept: '상품관리팀', role: '팀장' },
    '정현수': { id: null, dept: '플랫폼팀', role: '팀장' },
  },
  knowledge: {
    tech: "GNSS/RTK 초정밀 측위(cm급), HI-PPE 임베디드 제어, AI라이브 플랫폼 연동, AI 엣지 비전 기술",
    business: "LG유플러스 독점 파트너, 전국 200개 GNSS 기준국 운영, 자율주행 및 드론 정밀 항법 지원",
    vision: "국내 1위 초정밀 측위 플랫폼 기업 (H&I)"
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
      name: 'search_financial_status',
      description: '재무현황, 자금현황 등 경영 채널의 최신 정보를 검색합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: '검색 키워드 (예: 자금현황, 재무현황, 잔액)' }
        },
        required: ['query']
      }
    }
  ]
}];

// ─── [2] 유틸리티 및 보안 ──────────────────────────────────────

function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  const hmac = crypto.createHmac('sha256', signingSecret)
                     .update(`v0:${timestamp}:${rawBody}`)
                     .digest('hex');
  return `v0=${hmac}` === signature;
}

// [Vercel 타임아웃 최적화] 재시도 간격 단축 및 총 시간 제한
async function fetchWithRetry(url, options, maxRetries = 4) {
  const delays = [500, 1000, 2000, 4000]; // 0.5s ~ 4s 로 단축 (총 7.5s 대기)
  
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000); // 각 요청당 최대 15초 제한
    
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      
      if (response.status === 429 || response.status >= 500) {
        if (i < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delays[i]));
          continue;
        }
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
  let options = {
    method: method,
    headers: { 'Authorization': `Bearer ${token}` }
  };

  if (method === 'GET' && body) {
    const params = new URLSearchParams(body).toString();
    url += (params ? `?${params}` : '');
  } else if (method === 'POST') {
    options.headers['Content-Type'] = 'application/json; charset=utf-8';
    options.body = JSON.stringify(body);
  }

  try {
    const r = await fetchWithRetry(url, options);
    const res = await r.json();
    if (!res.ok) console.error(`[Slack API 응답 에러] ${endpoint}: ${res.error}`);
    return res;
  } catch (e) {
    console.error(`[Slack API 에러] ${endpoint}:`, e);
    return { ok: false, error: e.message };
  }
}

async function findUserIdByName(name, token) {
  const res = await slackApi('users.list', { limit: 1000 }, token); 
  if (!res.ok) return null;
  const found = res.members.find(m => 
    m.profile?.real_name?.includes(name) || m.real_name?.includes(name) || m.name?.includes(name)
  );
  return found ? found.id : null;
}

// ─── [3] handleBoss: 대표님용 ───────────────────────────────────

async function handleBoss(text, channel, env) {
  console.log(`[대표님 지시 수신] ${text}`);
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님의 유능한 비서 '구대표집사봇'입니다. 
  간결하고 명확하게 답변하세요. 도구 실행이 필요하면 즉시 실행하세요.`;

  const modelPath = "models/gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${env.GEMINI_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: text }] }],
    system_instruction: { parts: [{ text: systemPrompt }] },
    tools: GEMINI_TOOLS,
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]
  };

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();

    if (data.error) {
      if (data.error.code === 429) {
        return await slackApi('chat.postMessage', { channel, text: "⏳ 구글 엔진 사용량이 많아 답변이 지연되고 있습니다. 10초 후 다시 시도해 주세요." }, env.BOT_TOKEN);
      }
      throw new Error(data.error.message);
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    
    if (parts.length === 0) {
      await slackApi('chat.postMessage', { channel, text: "🤔 엔진에서 답변을 생성하지 못했습니다. 다시 말씀해 주시겠어요?" }, env.BOT_TOKEN);
      return;
    }

    for (const part of parts) {
      if (part.text) {
        await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      }
      
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        if (name === 'send_message') {
          let targetId = HNI.members[args.name]?.id || await findUserIdByName(args.name, env.BOT_TOKEN);
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${args.name}님께 메시지를 전송했습니다.` }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ '${args.name}'님을 찾지 못했습니다.` }, env.BOT_TOKEN);
          }
        }
        
        if (name === 'search_financial_status') {
          const searchRes = await slackApi('search.messages', { query: args.query, count: 5 }, env.BOT_TOKEN);
          if (searchRes.ok && searchRes.messages.matches.length > 0) {
            const context = searchRes.messages.matches.map(m => `[${m.channel.name}] ${m.text}`).join('\n\n');
            const summaryRes = await fetchWithRetry(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  { role: 'user', parts: [{ text: text }] },
                  { role: 'model', parts: [part] },
                  { role: 'user', parts: [{ text: `검색 결과:\n${context}\n위 내용을 대표님께 요약 보고해 주세요.` }] }
                ]
              })
            });
            const sData = await summaryRes.json();
            const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (sReply) await slackApi('chat.postMessage', { channel, text: sReply }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: "❓ 관련 경영 데이터를 찾지 못했습니다." }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    console.error('[핸들러 에러]', e);
    await slackApi('chat.postMessage', { channel, text: `⚠️ 구대표집사봇 응답 지연 (Vercel Timeout 방지). 잠시 후 다시 시도해 주세요.` }, env.BOT_TOKEN);
  }
}

// ─── [4] handleMember: 직원용 ──────────────────────────────────

async function handleMember(senderId, text, channel, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "직원";

  const systemPrompt = `당신은 에이치앤아이(H&I)의 친절한 AI 집사 '구대표집사봇'입니다. 기술 질문(${HNI.knowledge.tech})에 답변하세요.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        system_instruction: { parts: [{ text: systemPrompt }] }
      })
    });
    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (reply) await slackApi('chat.postMessage', { channel, text: reply }, env.BOT_TOKEN);

    if (text.length >= 5) {
      await slackApi('chat.postMessage', { channel: env.BOSS_ID, text: `💬 [보고] ${name}: ${text}\n답변 요약: ${reply ? reply.slice(0, 30) : ""}...` }, env.BOT_TOKEN);
    }
  } catch (e) { console.error(e); }
}

// ─── [5] 메인 핸들러 ──────────────────────────────────────

export default async function handler(req, res) {
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
  
  // 슬랙 재시도 방지 (재시도가 들어오면 이미 작업 중이거나 끝났다는 뜻이므로 200 반환)
  if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(200).end(); }
  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });

  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();

  // 비동기 실행을 위해 제어권을 handle 함수로 넘기고 즉시 200 OK를 보낼 수도 있으나,
  // Vercel 인스턴스가 즉시 종료될 수 있으므로 await를 유지하되 전체 실행 시간을 25초 내외로 관리합니다.
  if (event.user === env.BOSS_ID) {
    await handleBoss(event.text.trim(), event.channel, env);
  } else {
    await handleMember(event.user, event.text.trim(), event.channel, env);
  }
  return res.status(200).send('ok');
}

export const config = { api: { bodyParser: false } };
