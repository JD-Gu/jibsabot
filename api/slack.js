import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
    // 아래 명단은 ID가 없어도 슬랙에서 자동으로 찾아냅니다.
    '김봉석': { id: null, dept: '기술연구소', role: '소장' },
    '김찬영': { id: null, dept: '기술연구소', role: '연구원' },
    '이지민': { id: null, dept: '상품관리팀', role: '팀장' },
    '정현수': { id: null, dept: '플랫폼팀', role: '팀장' },
  },
  knowledge: {
    tech: "GNSS/RTK 초정밀 측위(cm급), HI-PPE v4.0 임베디드 제어, IoT 플랫폼 연동, AI 엣지 비전 기술",
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

// ─── [2] 유틸리티 및 보안 (API 호출 로직 강화) ──────────────────────

function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  const hmac = crypto.createHmac('sha256', signingSecret)
                     .update(`v0:${timestamp}:${rawBody}`)
                     .digest('hex');
  return `v0=${hmac}` === signature;
}

// 슬랙 API 호출 함수 (GET/POST 자동 분기 및 에러 로깅 강화)
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
    const r = await fetch(url, options);
    const res = await r.json();
    if (!res.ok) console.error(`[Slack API 응답 에러] ${endpoint}: ${res.error}`);
    return res;
  } catch (e) {
    console.error(`[Slack API 네트워크 에러] ${endpoint}:`, e);
    return { ok: false, error: e.message };
  }
}

// 이름으로 사용자를 검색하는 함수 (Fallback 로직)
async function findUserIdByName(name, token) {
  console.log(`[탐색 시작] 이름: ${name}`);
  const res = await slackApi('users.list', { limit: 1000 }, token); 
  if (!res.ok) return null;

  const found = res.members.find(m => 
    m.profile?.real_name?.includes(name) || 
    m.real_name?.includes(name) || 
    m.name?.includes(name)
  );
  
  if (found) console.log(`[탐색 성공] ${name} -> ${found.id}`);
  else console.log(`[탐색 실패] ${name}님을 찾을 수 없음`);
  
  return found ? found.id : null;
}

// ─── [3] handleBoss: 대표님용 (비서 + 재무조회) ───────────────────

async function handleBoss(text, channel, env) {
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님의 유능한 비서 '구대표집사봇'입니다.
  [행동 지침]
  1. 즉시 실행: "누구에게 ~라고 전해줘"라는 명령에 되묻지 말고 즉시 send_message를 호출하세요.
  2. 재무 보고: 자금이나 재무 상황을 물으시면 search_financial_status를 호출하여 데이터를 찾아 보고하세요.
  3. 말투: 싹싹하고 유능하게, 결론부터 명확하게 보고하세요.`;

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
          let targetId = HNI.members[args.name]?.id;
          if (!targetId) targetId = await findUserIdByName(args.name, env.BOT_TOKEN);
          
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${args.name}님께 메시지를 발송했습니다.` }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ 슬랙에서 '${args.name}'님을 찾지 못했습니다. 실명을 확인해 주세요.` }, env.BOT_TOKEN);
          }
        }

        if (name === 'search_financial_status') {
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
                  { role: 'user', parts: [{ text: `검색된 현황입니다:\n${context}\n\n이 데이터를 요약하여 대표님께 보고하세요.` }] }
                ]
              })
            });
            const sData = await summaryRes.json();
            await slackApi('chat.postMessage', { channel, text: sData.candidates[0].content.parts[0].text }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ 최근 '${args.query}' 관련 데이터를 찾지 못했습니다.` }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    await slackApi('chat.postMessage', { channel, text: `⚠️ 에러 발생: ${e.message}` }, env.BOT_TOKEN);
  }
}

// ─── [4] handleMember: 직원용 (상담 + 기술공유 + 보고) ──────────

async function handleMember(senderId, text, channel, env) {
  const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
  const name = userRes.user?.profile?.real_name || "직원";

  const systemPrompt = `당신은 에이치앤아이(H&I)의 친절한 AI 집사 '구대표집사봇'입니다.
  - 기술 질문(${HNI.knowledge.tech})에 전문가처럼 답변하세요.
  - 상담 내용은 요약되어 대표님께 보고된다는 점을 정중히 알리세요.`;

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

    if (text.length >= 5) {
      await slackApi('chat.postMessage', { channel: env.BOSS_ID, text: `💬 [보고] ${name}: ${text}\n응대: ${reply.slice(0, 50)}...` }, env.BOT_TOKEN);
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

  if (event.user === env.BOSS_ID) {
    await handleBoss(event.text.trim(), event.channel, env);
  } else {
    await handleMember(event.user, event.text.trim(), event.channel, env);
  }
  return res.status(200).send('ok');
}

export const config = { api: { bodyParser: false } };
