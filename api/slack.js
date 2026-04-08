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
      description: '특정 직원에게 슬랙 메시지를 보냅니다. 이름과 메시지를 입력하세요.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '받는 사람 이름 (예: 이종혁)' },
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
  const systemPrompt = `당신은 에이치앤아이(H&I) 구자덕 대표님을 보좌하는 AI 비서 '자두'입니다.
  - 구대표님은 30년 경력의 초정밀 측위 분야 대가이십니다.
  - 말투는 매우 친절하고 유능하며 싹싹하게 하세요.
  - 인사를 받으면 반갑게 화답하고, 요청하신 업무(메시지 전송 등)를 정확히 수행하세요.`;
  
  // 💡 대표님이 직접 확인하신 정확한 모델 경로를 사용합니다.
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
      // 1. 일반 텍스트 답변
      if (part.text) {
        await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      }

      // 2. 도구 실행 (메시지 전송 등)
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        if (name === 'send_message') {
          let targetId = null;
          // 이름 매칭 로직
          for (const [mName, mInfo] of Object.entries(HNI.members)) {
            if (args.name.includes(mName)) { targetId = mInfo.id; break; }
          }
          
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { 
              channel, 
              text: `✅ 대표님, ${args.name} 본부장님(팀장님)께 메시지를 잘 전달했습니다!` 
            }, env.BOT_TOKEN);
          } else {
            await slackApi('chat.postMessage', { 
              channel, 
              text: `❓ ${args.name}님의 정보를 찾지 못해 메시지를 보내지 못했습니다.` 
            }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    console.error('Runtime Error:', e);
    await slackApi('chat.postMessage', { 
      channel, 
      text: `⚠️ 자두가 대답하는 중에 오류가 발생했습니다. (에러: ${e.message})` 
    }, env.BOT_TOKEN);
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

  // 1. 슬랙 서명 검증
  if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) return res.status(401).end();
  
  // 2. 슬랙 재시도 방지 (매우 중요)
  if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');

  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(200).end(); }

  // 3. 슬랙 Challenge 처리
  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });

  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();

  // 4. 대표님 식별 및 실행
  if (event.user === env.BOSS_ID) {
    // Vercel 프로세스 유지를 위해 await로 대화 완료를 기다립니다.
    await handleBoss(event.text.trim(), event.channel, env);
    return res.status(200).send('ok');
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
