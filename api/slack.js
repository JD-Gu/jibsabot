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

// Gemini용 도구(Tool) 정의
const GEMINI_TOOLS = [{
  function_declarations: [
    {
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
    }
  ]
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
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await r.json();
}

// ─── [3] Gemini API 핸들러 (무료 테스트용) ────────────────────

async function handleBossWithGemini(text, channel, env) {
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님의 AI 비서 '자두'입니다. 싹싹하고 유능하게 대답하세요.`;
  
  // Gemini 1.5 Flash API 호출 (무료 티어 활용)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_KEY}`;
  
  let payload = {
    contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n사용자 명령: ${text}` }] }],
    tools: GEMINI_TOOLS
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    // 1. 일반 텍스트 응답 처리
    if (part?.text) {
      await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
    }

    // 2. 도구 실행(Function Calling) 처리
    if (part?.functionCall) {
      const { name, args } = part.functionCall;
      console.log(`[자두] 도구 실행 시도: ${name}`, args);
      
      if (name === 'send_message') {
        let targetId = null;
        for (const [mName, mInfo] of Object.entries(HNI.members)) {
          if (args.name.includes(mName)) { targetId = mInfo.id; break; }
        }
        
        if (targetId) {
          const res = await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
          const status = res.ok ? "성공적으로 보냈습니다!" : `발송 실패했습니다. (${res.error})`;
          await slackApi('chat.postMessage', { channel, text: `✅ ${args.name}님께 메시지를 ${status}` }, env.BOT_TOKEN);
        } else {
          await slackApi('chat.postMessage', { channel, text: `❓ ${args.name}님의 ID를 찾을 수 없어 발송하지 못했습니다.` }, env.BOT_TOKEN);
        }
      }
    }
  } catch (e) {
    console.error('Gemini API Error:', e);
    await slackApi('chat.postMessage', { channel, text: "⚠️ 자두가 응답하는 중 오류가 발생했습니다." }, env.BOT_TOKEN);
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
    GEMINI_KEY: process.env.GEMINI_API_KEY, // 새로운 무료 키 필요
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
    // Gemini 모델을 사용하여 무료로 테스트 실행
    await handleBossWithGemini(event.text.trim(), event.channel, env);
    return res.status(200).send('ok');
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
