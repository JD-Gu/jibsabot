import crypto from 'crypto';

// ─── [1] 데이터 및 환경 설정 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
  },
  public: {
    vision: '국내 1위 초정밀 측위 플랫폼 기업',
    business: 'GNSS/RTK 전문, LG유플러스 독점 파트너',
    projects: 'HI-PPE v4.0 개발 중, 전국 200개 GNSS 기준국 운영'
  }
};

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: 'send_message',
      description: '특정 직원에게 슬랙 메시지를 보냅니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '메시지를 받을 직원 이름 (직함/부서 제외하고 성함만 추출)' },
          message: { type: 'STRING', description: '전달할 내용' }
        },
        required: ['name', 'message']
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

// ─── [3] 자두(AI 비서) 핵심 엔진 ─────────────────────────────────

async function handleBoss(text, channel, env) {
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님을 보좌하는 유능한 AI 비서 '자두'입니다.
  
  [행동 지침]
  1. 대표님이 누구에게 무엇을 전하라고 하면, "성함이 어떻게 되시나요?"라고 묻지 말고 즉시 send_message 도구를 호출하세요.
  2. 이름에 수식어(@김인구/팀장 등)가 붙어있어도 이름만(예: 김인구) 정확히 추출해서 도구를 사용하세요.
  3. 정보가 부족할 때만 물어보되, "이름"과 "메시지"가 한 문장에 있다면 확인 절차 없이 즉시 발송하세요.
  4. 도구 실행 후에는 "발송했습니다"라고 간결하게 보고하세요.`;
  
  const modelPath = "models/gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${env.GEMINI_KEY}`;
  
  const payload = {
    contents: [{ parts: [{ text: text }] }],
    system_instruction: { parts: [{ text: systemPrompt }] },
    tools: GEMINI_TOOLS
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) {
        await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      }

      if (part.functionCall) {
        const { name, args } = part.functionCall;
        if (name === 'send_message') {
          let targetId = null;
          // 이름 매칭 로직 (이름만 쏙 뽑아오도록 개선)
          for (const [mName, mInfo] of Object.entries(HNI.members)) {
            if (args.name.includes(mName)) { targetId = mInfo.id; break; }
          }
          
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 알겠습니다. ${args.name}님께 말씀하신 내용을 전달했습니다!` }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ 죄송합니다 대표님, ${args.name}님의 ID 정보가 없습니다. 멤버 리스트를 확인해 주세요.` }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    await slackApi('chat.postMessage', { channel, text: `⚠️ 자두가 대답하는 중에 오류가 났어요. (${e.message})` }, env.BOT_TOKEN);
  }
}

// ─── [4] Vercel 메인 핸들러 ──────────────────────────────────────

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
    return res.status(200).send('ok');
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
