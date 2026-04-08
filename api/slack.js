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
  function_declarations: [{
    name: 'send_message',
    description: '직원에게 Slack DM을 보냅니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: '직원 이름' },
        message: { type: 'STRING', description: '보낼 내용' }
      },
      required: ['name', 'message']
    }
  }]
}];

// ─── [2] 유틸리티 함수 ────────────────────────────────────

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
  const res = await r.json();
  if (!res.ok) console.error(`[Slack API 에러] ${res.error}`);
  return res;
}

// ─── [3] Gemini API 핸들러 (모델명 및 에러 처리 수정) ─────────────

async function handleBossWithGemini(text, channel, env) {
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님의 AI 비서 '자두'입니다. 
  대표님의 "안녕" 같은 인사에는 반갑게 화답하고, 비서처럼 싹싹하게 대답하세요.`;
  
  // 💡 모델명을 'gemini-1.5-flash-latest'로 변경하여 더 넓은 호환성을 확보합니다.
  const modelId = "gemini-1.5-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${env.GEMINI_KEY}`;
  
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

    // 에러 발생 시 상세 메시지를 슬랙으로 전송
    if (data.error) {
      console.error('[Gemini API 에러]', data.error);
      let errorHint = "모델명을 확인해 주세요.";
      if (data.error.code === 404) errorHint = "모델명을 'gemini-1.5-pro'로 바꿔 시도해 볼 수 있습니다.";
      
      await slackApi('chat.postMessage', { 
        channel, 
        text: `⚠️ 자두 엔진 오류 (404)\n메시지: ${data.error.message}\n조언: ${errorHint}` 
      }, env.BOT_TOKEN);
      return;
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    if (parts.length === 0) {
      await slackApi('chat.postMessage', { channel, text: "🤔 자두가 잠시 생각을 정리하지 못했습니다. 다시 말씀해 주시겠어요?" }, env.BOT_TOKEN);
      return;
    }

    for (const part of parts) {
      if (part.text) {
        await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      }

      if (part.functionCall) {
        const { name, args } = part.functionCall;
        if (name === 'send_message') {
          let targetId = null;
          for (const [mName, mInfo] of Object.entries(HNI.members)) {
            if (args.name.includes(mName)) { targetId = mInfo.id; break; }
          }
          
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ ${args.name}님께 메시지를 보냈습니다.` }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { channel, text: `❓ ${args.name}님을 찾을 수 없습니다.` }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    console.error('[런타임 에러]', e);
    await slackApi('chat.postMessage', { channel, text: `⚠️ 시스템 에러가 발생했습니다: ${e.message}` }, env.BOT_TOKEN);
  }
}

// ─── [4] 메인 핸들러 ──────────────────────────────────────

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
    await handleBossWithGemini(event.text.trim(), event.channel, env);
    return res.status(200).send('ok');
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
