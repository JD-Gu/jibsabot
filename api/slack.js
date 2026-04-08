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
  console.log(`[Slack API 호출] endpoint: ${endpoint}`);
  const r = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  const res = await r.json();
  if (!res.ok) console.error(`[Slack API 에러] ${res.error}`);
  return res;
}

// ─── [3] Gemini API 핸들러 (응답 처리 강화) ───────────────────

async function handleBossWithGemini(text, channel, env) {
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님의 AI 비서 '자두'입니다. 
  대표님의 "안녕" 같은 인사에는 반갑게 화답하고, 비서처럼 싹싹하게 대답하세요.`;
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_KEY}`;
  
  // Gemini 1.5 표준 페이로드 구조
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
    console.log('[Gemini 응답 수신]', JSON.stringify(data).slice(0, 500));

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    if (parts.length === 0) {
      console.warn('[경고] Gemini로부터 받은 부품(parts)이 없습니다.');
      return;
    }

    for (const part of parts) {
      // 1. 텍스트 응답 처리
      if (part.text) {
        console.log(`[자두 답변 전송] ${part.text}`);
        await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      }

      // 2. 도구 실행 처리
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        console.log(`[도구 실행] ${name}`, args);
        
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
    console.error('[Gemini 핸들러 에러]', e);
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
  
  // 슬랙 재시도 방지 (매우 중요)
  if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(200).end(); }

  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });

  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();

  if (event.user === env.BOSS_ID) {
    console.log(`[대표님 메시지 확인] ${event.text}`);
    // Vercel에서 끝까지 실행되도록 await를 걸어줍니다.
    await handleBossWithGemini(event.text.trim(), event.channel, env);
    return res.status(200).send('ok');
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
