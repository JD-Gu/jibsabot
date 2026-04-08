import crypto from 'crypto';

// ─── [1] 기업 정보 및 멤버 데이터 ──────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
    // 여기에 다른 직원분들의 ID를 추가해두시면 매칭이 정확해집니다.
  },
  public: {
    vision: '국내 1위 초정밀 측위 플랫폼 기업',
    business: 'GNSS/RTK 전문, LG유플러스 독점 파트너, 전국 200개 GNSS 기준국 운영',
    projects: 'HI-PPE v4.0, HI-RTK 클라우드, AI 엣지 KIT 개발 중'
  },
  confidential: ['M&A', '한진그룹', '유상증자', '급여', '연봉', '소송', '투자']
};

const TOOLS = [
  {
    name: 'send_message',
    description: '직원에게 Slack DM을 보냅니다.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '직원 성함' },
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

// 슬랙 보안 검증
function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  const hmac = crypto.createHmac('sha256', signingSecret)
                     .update(`v0:${timestamp}:${rawBody}`)
                     .digest('hex');
  return `v0=${hmac}` === signature;
}

// 슬랙 API 호출 헬퍼
async function slackApi(endpoint, body, token) {
  const r = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!data.ok) console.error(`Slack API Error [${endpoint}]:`, data.error);
  return data;
}

// Claude API 호출 (Tool Use 루프 포함)
async function handleBoss(text, channel, env) {
  let messages = [{ role: 'user', content: text }];
  const system = `당신은 에이치앤아이(H&I) 구자덕 대표님을 보좌하는 AI 비서 "자두"입니다.
  - 말투: 매우 친절하고 싹싹하며 유능한 비서처럼 대답하세요.
  - 대표님의 인사에 반갑게 화답하고, 어떤 업무든 도울 준비가 되었음을 알리세요.
  - 답변은 한국어로, 핵심 위주로 정중하게 하세요.`;

  console.log('[자두] 대화 루프 시작...');

  for (let i = 0; i < 5; i++) { // 최대 5번의 도구 실행/대화 시도
    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
    
    const data = await response.json();
    if (data.error) {
      console.error('Claude API Error:', data.error);
      await slackApi('chat.postMessage', { channel, text: `⚠️ API 통신 중 오류가 발생했습니다: ${data.error.message}` }, env.BOT_TOKEN);
      return;
    }

    // 1. 텍스트 응답 추출 및 전송
    const textParts = data.content.filter(b => b.type === 'text');
    if (textParts.length > 0) {
      const reply = textParts.map(b => b.text).join('\n');
      console.log('[자두] 답변 발송:', reply);
      await slackApi('chat.postMessage', { channel, text: reply }, env.BOT_TOKEN);
    }

    // 2. 루프 종료 조건 체크
    if (data.stop_reason === 'end_turn') break;

    // 3. 도구(Tool) 사용 처리
    if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: data.content });
      
      const toolResults = [];
      for (const tu of toolUses) {
        console.log(`[자두] 도구 실행: ${tu.name}`, tu.input);
        const result = await executeTool(tu.name, tu.input, env);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) });
      }
      messages.push({ role: 'user', content: toolResults });
    }
  }
}

// 도구 실제 로직
async function executeTool(name, input, env) {
  if (name === 'send_message') {
    let targetId = null;
    for (const [mName, mInfo] of Object.entries(HNI.members)) {
      if (input.name.includes(mName)) { targetId = mInfo.id; break; }
    }
    if (!targetId) return `${input.name}님의 정보를 찾을 수 없습니다. (ID 미등록)`;
    const res = await slackApi('chat.postMessage', { channel: targetId, text: input.message }, env.BOT_TOKEN);
    return res.ok ? `✅ ${input.name}님께 메시지를 보냈습니다.` : `❌ 발송 실패: ${res.error}`;
  }
  return '지원하지 않는 도구입니다.';
}

// ─── [3] 메인 핸들러 (Vercel Entry Point) ─────────────────────
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

  // 1. 보안 서명 검증
  if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) {
    console.error('[Security] Signature mismatch');
    return res.status(401).send('Invalid Signature');
  }

  // 2. 슬랙 재시도 방지
  if (req.headers['x-slack-retry-num']) {
    return res.status(200).send('ok');
  }

  let body;
  try {
    body = rawBody.startsWith('payload=') 
      ? JSON.parse(decodeURIComponent(rawBody.slice(8))) 
      : JSON.parse(rawBody);
  } catch { return res.status(200).end(); }

  // 3. URL Verification (슬랙 앱 최초 설정용)
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();

  const senderId = event.user;
  const text = event.text.trim();
  const channel = event.channel;

  // [디버깅] 로그에서 이 값을 꼭 확인하세요!
  console.log(`[Event] Sender: ${senderId} | Boss_ID: ${env.BOSS_ID} | Text: ${text}`);

  // 4. 권한 분기
  if (senderId === env.BOSS_ID) {
    console.log('[Flow] Boss detected, starting 자두...');
    // Vercel 타임아웃 방지를 위해 await를 사용하여 끝까지 실행 보장
    // (슬랙은 3초를 기다리지만, Vercel은 실행 중이면 프로세스를 유지함)
    await handleBoss(text, channel, env);
    return res.status(200).send('ok');
  } else {
    // 직원 메시지는 간단하게 로그만 남기고 200 응답
    console.log('[Flow] Member message ignored for now.');
    return res.status(200).end();
  }
}

export const config = { api: { bodyParser: false } };
