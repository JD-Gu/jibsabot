import crypto from 'crypto';

// ─── [1] 데이터 및 설정 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
    // 필요 시 여기에 다른 멤버들의 Slack ID를 추가하세요.
  },
  public: {
    vision: '국내 1위 초정밀 측위 플랫폼 기업',
    business: 'GNSS/RTK 전문, LG유플러스 독점 파트너, 전국 200개 기준국 운영',
    projects: 'HI-PPE v4.0, HI-RTK 클라우드, AI 엣지 KIT 개발 중'
  },
  confidential: ['M&A', '한진그룹', '유상증자', '급여', '연봉', '소송']
};

const TOOLS = [
  {
    name: 'send_message',
    description: '직원에게 Slack DM을 보냅니다. 이름과 메시지를 입력하세요.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '직원 성함 (예: 이종혁)' },
        message: { type: 'string', description: '전달할 내용' }
      },
      required: ['name', 'message']
    }
  },
  {
    name: 'search_slack',
    description: 'Slack 메시지를 검색하여 업무 현황을 파악합니다.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '검색어' } },
      required: ['query']
    }
  }
];

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
  return await r.json();
}

// ─── [3] 도구 실행기 (Executor) ───────────────────────────
async function executeTool(toolName, input, env) {
  if (toolName === 'send_message') {
    let targetId = HNI.members[input.name]?.id;
    if (!targetId) return `${input.name}님의 Slack ID를 찾을 수 없습니다.`;
    const res = await slackApi('chat.postMessage', { channel: targetId, text: input.message }, env.BOT_TOKEN);
    return res.ok ? `✅ ${input.name}님께 전송 완료: ${input.message}` : `❌ 발송 실패: ${res.error}`;
  }
  
  if (toolName === 'search_slack') {
    const res = await slackApi(`search.messages?query=${encodeURIComponent(input.query)}&count=3`, {}, env.BOT_TOKEN);
    if (!res.ok) return '검색 실패';
    return res.messages.matches.map(m => `[${m.username}]: ${m.text}`).join('\n');
  }
  return '알 수 없는 도구입니다.';
}

// ─── [4] 대표님 전용 대화 핸들러 (대화 루프 포함) ───────────────
async function handleBoss(text, channel, env) {
  let messages = [{ role: 'user', content: text }];
  const system = `당신은 H&I의 구자덕 대표(구대표)님을 보좌하는 전용 AI 비서 "자두"입니다.
  - 말투: 친근하고 싹싹하며 유능한 비서처럼 대답하세요.
  - "안녕"이나 인사를 받으면 반갑게 인사하고 업무 준비가 되었음을 알리세요.
  - 대표님이 30년 경력의 전문가임을 존중하며 간결하고 정확하게 보고하세요.`;

  // 최대 5회 루프 (도구 사용 포함)
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'x-api-key': env.CLAUDE_KEY, 
        'anthropic-version': '2023-06-01' 
      },
      body: JSON.stringify({ 
        model: 'claude-3-5-sonnet-20240620', 
        max_tokens: 1024, 
        system, 
        tools: TOOLS, 
        messages 
      })
    });
    
    const d = await r.json();
    if (d.error) {
      await slackApi('chat.postMessage', { channel, text: `⚠️ API 에러: ${d.error.message}` }, env.BOT_TOKEN);
      return;
    }

    const textBlocks = d.content.filter(b => b.type === 'text');
    const toolBlocks = d.content.filter(b => b.type === 'tool_use');

    // 1. 텍스트 응답이 있으면 즉시 전송
    if (textBlocks.length > 0) {
      const reply = textBlocks.map(b => b.text).join('\n');
      await slackApi('chat.postMessage', { channel, text: reply }, env.BOT_TOKEN);
    }

    // 2. 도구 사용이 없으면 종료
    if (d.stop_reason === 'end_turn' || toolBlocks.length === 0) break;

    // 3. 도구 실행 및 결과 취합
    if (d.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: d.content });
      const toolResults = [];
      for (const block of toolBlocks) {
        const result = await executeTool(block.name, block.input, env);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) });
      }
      messages.push({ role: 'user', content: toolResults });
      // 루프를 통해 다음 turn의 텍스트 응답을 받아옴
    }
  }
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
    CLAUDE_KEY: process.env.ANTHROPIC_API_KEY,
    SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET
  };

  // 보안 및 재시도 방지
  if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) return res.status(401).end();
  if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');

  let body;
  try {
    body = rawBody.startsWith('payload=') 
      ? JSON.parse(decodeURIComponent(rawBody.slice(8))) 
      : JSON.parse(rawBody);
  } catch { return res.status(200).end(); }

  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });

  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();

  const senderId = event.user;
  const text = event.text.trim();
  const channel = event.channel;

  // 대표님일 경우에만 handleBoss 실행
  if (senderId === env.BOSS_ID) {
    // Vercel 타임아웃 방지를 위해 응답은 먼저 보내고 내부 로직 실행
    res.status(200).send('ok');
    return await handleBoss(text, channel, env);
  }

  // 직원용 로직 등은 여기에 추가...
  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
