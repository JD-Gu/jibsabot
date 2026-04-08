import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
  },
  // 자두가 상시 보유한 기술 및 경영 지식
  knowledge: {
    tech: "GNSS/RTK 초정밀 측위(cm급), HI-PPE v4.0 임베디드, IoT 플랫폼, AI 엣지 비전",
    business: "LG유플러스 독점 파트너, 전국 200개 GNSS 기준국 운영, 자율주행 정밀 항법",
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

async function slackApi(endpoint, body, token) {
  const r = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  return await r.json();
}

// ─── [3] handleBoss: 1. 업무 비서 (메시지 전달 + 재무 조회) ───────

async function handleBoss(text, channel, env) {
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님의 전용 비서 '자두'입니다.
  
  [행동 지침]
  1. 즉시 실행: "누구에게 ~라고 전해줘"라는 명령에 "성함이 어떻게 되시나요?"라고 되묻지 마세요. 문장에서 이름과 내용을 즉시 추출하여 send_message를 호출하세요.
  2. 재무 보고: 자금이나 재무 현황을 물으시면 search_financial_status를 호출하여 경영 채널의 실시간 데이터를 기반으로 보고하세요.
  3. 말투: 정중하고 싹싹하며, 30년 경력의 대표님 취향에 맞게 결론부터 명확하게 보고하세요.`;

  const modelPath = "models/gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: GEMINI_TOOLS
      })
    });
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      
      if (part.functionCall) {
        const { name, args } = part.functionCall;

        if (name === 'send_message') {
          let targetId = null;
          for (const [mName, mInfo] of Object.entries(HNI.members)) {
            if (args.name.includes(mName)) { targetId = mInfo.id; break; }
          }
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${args.name}님께 메시지를 발송했습니다.` }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ ${args.name}님의 ID 정보가 없습니다. 등록이 필요합니다.` }, env.BOT_TOKEN);
          }
        }

        if (name === 'search_financial_status') {
          // 'search:read' 권한을 사용하여 경영 관련 키워드 검색
          const searchRes = await slackApi('search.messages', { query: args.query, count: 5, sort: 'timestamp' }, env.BOT_TOKEN);
          if (searchRes.ok && searchRes.messages.matches.length > 0) {
            const context = searchRes.messages.matches.map(m => `[채널:${m.channel.name}] ${m.text}`).join('\n\n');
            const summaryRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  { role: 'user', parts: [{ text: text }] },
                  { role: 'model', parts: [part] },
                  { role: 'user', parts: [{ text: `검색된 현황입니다:\n${context}\n\n이 데이터를 요약하여 대표님께 직관적으로 보고하세요.` }] }
                ]
              })
            });
            const sData = await summaryRes.json();
            await slackApi('chat.postMessage', { channel, text: sData.candidates[0].content.parts[0].text }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ '${args.query}'와 관련된 최근 경영 데이터를 찾지 못했습니다.` }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) { console.error(e); }
}

// ─── [4] handleMember: 2. 직원상담 + 3. 기술공유 ──────────────────

async function handleMember(senderId, text, channel, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "직원";

  const systemPrompt = `당신은 에이치앤아이(H&I)의 친절한 AI 집사 '자두'입니다.
  
  [행동 지침]
  1. 기술공유: 회사의 주력 기술(${HNI.knowledge.tech})에 대한 질문에는 전문가처럼 상세히 설명하세요.
  2. 직원상담: 고충이나 고민에 대해서는 깊이 공감하고 따뜻하게 위로하세요.
  3. 보안: 재무, 경영현황, 인사정보 등 기밀은 절대 답하지 말고 "대표님께 직접 문의하시라"고 안내하세요.
  4. 보고 알림: 상담 내용은 요약되어 대표님께 보고된다는 점을 정중히 알리세요.`;

  const modelPath = "models/gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        system_instruction: { parts: [{ text: systemPrompt }] }
      })
    });
    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    await slackApi('chat.postMessage', { channel, text: reply }, env.BOT_TOKEN);

    // 대표님께 비밀 보고 (5자 이상일 때만)
    if (text.length >= 5) {
      const report = `💬 [자두의 상담/기술문의 보고]\n발신: ${name}\n내용: ${text}\n자두 응대: ${reply.slice(0, 70)}...`;
      await slackApi('chat.postMessage', { channel: env.BOSS_ID, text: report }, env.BOT_TOKEN);
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
  if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(200).end(); }
  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });

  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();

  const senderId = event.user;
  const text = event.text.trim();
  const channel = event.channel;

  if (senderId === env.BOSS_ID) {
    await handleBoss(text, channel, env);
  } else {
    await handleMember(senderId, text, channel, env);
  }

  return res.status(200).send('ok');
}

export const config = { api: { bodyParser: false } };
