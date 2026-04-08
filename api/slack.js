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
    tech: "GNSS/RTK 초정밀 측위(cm급), HI-PPE 임베디드 제어, AI라이브 플랫폼, AI 엣지 비전 기술",
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

// [Vercel 타임아웃 최적화] 대표님의 지시는 끝까지 시도
async function fetchWithRetry(url, options, maxRetries = 3) {
  const delays = [1000, 2500, 6000]; // 재시도 간격 조정
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000); 
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      
      if (response.status === 429 && i < maxRetries) {
        console.log(`[할당량 제한] ${delays[i]}ms 대기 후 재시도 중... (${i+1}/${maxRetries})`);
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
  const found = res.members.find(m => 
    m.profile?.real_name?.includes(name) || m.real_name?.includes(name) || m.name?.includes(name)
  );
  return found ? found.id : null;
}

// ─── [3] handleBoss: 대표님용 (반드시 회신 보장 로직) ───────────

async function handleBoss(text, channel, env) {
  console.log(`[대표님 지시 수신] ${text}`);
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님의 전담 비서 '구대표집사봇'입니다. 
  1. 대표님의 질문에는 예외 없이 상세하고 명확하게 회신해야 합니다.
  2. 도구(메시지 전송, 경영 검색)가 필요하면 즉시 실행하세요.
  3. 현재 엔진이 바쁘더라도 최선을 다해 답변을 도출하세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: GEMINI_TOOLS
      })
    });
    
    const data = await response.json();

    // 할당량 초과 시 대표님께 상황을 상세히 보고
    if (data.error && data.error.code === 429) {
      console.error("[할당량 고갈] 대표님께 지연 보고 전송");
      return await slackApi('chat.postMessage', { channel, text: "⏳ 구대표님, 죄송합니다. 현재 엔진 할당량이 일시적으로 소진되어 답변이 약 1분 정도 지연될 수 있습니다. 잠시 후 다시 한 번만 말씀해 주시면 즉시 회신드리겠습니다." }, env.BOT_TOKEN);
    }

    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) {
        console.log(`[회신 확정] ${part.text}`);
        await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      }
      
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        if (name === 'send_message') {
          let targetId = HNI.members[args.name]?.id || await findUserIdByName(args.name, env.BOT_TOKEN);
          if (targetId) {
            console.log(`[업무 수행] 대상: ${args.name}, 내용: ${args.message}`);
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, 말씀하신 대로 ${args.name}님께 메시지를 전달했습니다.` }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ 대표님, '${args.name}'님을 슬랙 명단에서 찾지 못했습니다. 성함을 다시 확인해 주시겠습니까?` }, env.BOT_TOKEN);
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
                contents: [{ role: 'user', parts: [{ text: text }] }, { role: 'model', parts: [part] }, { role: 'user', parts: [{ text: `검색된 결과입니다:\n${context}\n\n위 내용을 분석해서 보고하세요.` }] }]
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
    await slackApi('chat.postMessage', { channel, text: `⚠️ 구대표님, 응답 과정에서 지연이 발생했습니다. (원인: ${e.message}) 다시 말씀해 주시면 즉시 처리하겠습니다.` }, env.BOT_TOKEN);
  }
}

// ─── [4] handleMember: 직원용 ──────────────────────────────────

async function handleMember(senderId, text, channel, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "직원";

  const systemPrompt = `당신은 에이치앤아이(H&I)의 AI 집사 '구대표집사봇'입니다.
  1. 친절하게 대화하고 기술 질문(${HNI.knowledge.tech})에 답하세요.
  2. 답변 마지막에 "[REPORT_STRENGTH: LOW/HIGH]"를 붙이세요. (일상은 LOW, 중요 질문은 HIGH)`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: text }] }], system_instruction: { parts: [{ text: systemPrompt }] } })
    });
    const data = await response.json();
    let reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    const isHigh = reply.includes('REPORT_STRENGTH: HIGH');
    reply = reply.replace(/\[REPORT_STRENGTH: (LOW|HIGH)\]/g, "").trim();

    if (reply) await slackApi('chat.postMessage', { channel, text: reply }, env.BOT_TOKEN);
    
    if (isHigh) {
      const reportMsg = `🔔 *[중요 직원 대화 보고]*\n발신자: ${name}\n내용: ${text}\n응대 요약: ${reply.slice(0, 50)}...`;
      await slackApi('chat.postMessage', { channel: env.BOSS_ID, text: reportMsg }, env.BOT_TOKEN);
    }
  } catch (e) { console.error(e); }
}

// ─── [5] 메인 핸들러 ──────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const env = { BOT_TOKEN: process.env.SLACK_BOT_TOKEN, BOSS_ID: process.env.BOSS_USER_ID, GEMINI_KEY: process.env.GEMINI_API_KEY, SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET };
  
  if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) return res.status(401).end();
  if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');
  
  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(200).end(); }
  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });
  
  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();
  
  if (event.user === env.BOSS_ID) {
    await handleBoss(event.text.trim(), event.channel, env);
  } else {
    await handleMember(event.user, event.text.trim(), event.channel, env);
  }
  return res.status(200).send('ok');
}
export const config = { api: { bodyParser: false } };
