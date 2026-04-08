import crypto from 'crypto';

// ─── [1] 회사 데이터 구성 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
    '김봉석': { id: null, dept: '기술연구소', role: '소장' },
    '김찬영': { id: null, dept: '기술연구소', role: '연구원' },
    '이지민': { id: null, dept: '상품관리팀', role: '팀장' },
    '정현수': { id: null, dept: '플랫폼팀', role: '팀장' },
    '김민영': { id: null, dept: '상품관리팀', role: '프로' },
    '김다영': { id: null, dept: '상품관리팀', role: '프로' },
    '김훈지': { id: null, dept: '서비스지원팀', role: '프로' },
    '이창현': { id: null, dept: '기술연구소', role: '프로' },
    '지우현': { id: null, dept: '플랫폼팀', role: '프로' },
    '박인영': { id: null, dept: '플랫폼팀', role: '프로' },
    '정명휘': { id: null, dept: '플랫폼팀', role: '프로' },
  },
  public: {
    vision: '국내 1위 초정밀 측위 플랫폼 기업',
    business: 'GNSS/RTK 초정밀 측위 전문기업, LG유플러스 독점 파트너',
    projects: 'HI-PPE v4.0 임베디드 개발 중, HI-RTK 클라우드 플랫폼 운영, 전국 200개 GNSS 기준국 운영',
    culture: '기술 중심, 자율적 문화, 빠른 성장 환경'
  },
  confidential: ['M&A', '한진그룹', '유상증자', '투자 협상', '소송', '법무', '급여', '연봉', '인사평가']
};

// ─── [2] 도구(Tools) 정의 ─────────────────────────────────
const TOOLS = [
  {
    name: 'send_message',
    description: '직원에게 Slack DM을 보냅니다.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '받을 직원 이름' },
        message: { type: 'string', description: '보낼 메시지 내용' }
      },
      required: ['name', 'message']
    }
  },
  {
    name: 'search_slack',
    description: 'Slack 메시지를 검색합니다.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '검색어' } },
      required: ['query']
    }
  }
];

// ─── [3] 보안 및 유틸리티 ──────────────────────────────────
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

const sessions = new Map(); // ※ 서버리스 환경에선 외부 DB(Redis) 연동 권장

// ─── [4] 메인 핸들러 ──────────────────────────────────────
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

  if (!verifySlackRequest(req, rawBody, env.SIGNING_SECRET)) return res.status(401).end();
  if (req.headers['x-slack-retry-num']) return res.status(200).send('ok');

  let body;
  try {
    body = rawBody.startsWith('payload=') 
      ? JSON.parse(decodeURIComponent(rawBody.slice(8))) 
      : JSON.parse(rawBody);
  } catch { return res.status(200).end(); }

  if (body.type === 'url_verification') return res.status(200).json({ challenge: body.challenge });

  // 액션 처리 (버튼 클릭 등)
  if (body.type === 'block_actions') {
    await handleAction(body, env);
    return res.status(200).end();
  }

  const event = body.event;
  if (!event || event.bot_id || !event.text) return res.status(200).end();

  const senderId = event.user;
  const text = event.text.trim();
  const channel = event.channel;

  try {
    // A. 대표님 메시지 처리 (Tool Use)
    if (senderId === env.BOSS_ID) {
      await handleBoss(text, channel, env);
      return res.status(200).end();
    }

    // B. 직원 정보 조회 및 상담/업무 분기
    const userRes = await slackApi('users.info', { user: senderId }, env.BOT_TOKEN);
    const name = userRes.user?.profile?.real_name || senderId;
    const deptInfo = getDept(name);

    if (sessions.has(senderId) || isCounsel(text)) {
      await handleCounsel(senderId, name, deptInfo, text, channel, env);
    } else {
      await handleWork(name, deptInfo, senderId, text, channel, env);
    }
  } catch (e) {
    console.error('Error:', e);
  }

  return res.status(200).end();
}

// ─── [5] 세부 비즈니스 로직 ────────────────────────────────

async function handleBoss(text, channel, env) {
  const messages = [{ role: 'user', content: text }];
  const system = `당신은 H&I 구자덕 대표의 AI 비서 "자두"입니다. 한국어로 친근하게 응대하세요.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-5-sonnet-20240620', max_tokens: 1024, system, tools: TOOLS, messages })
  });
  const d = await r.json();
  
  if (d.stop_reason === 'tool_use') {
    // 도구 실행 로직 (기존 executeTool 호출 후 결과 전달)
    // ... (지면상 생략, 기존 logic 적용)
  }

  const reply = d.content?.filter(b => b.type === 'text').map(b => b.text).join('\n');
  await slackApi('chat.postMessage', { channel, text: reply || '처리했습니다.' }, env.BOT_TOKEN);
}

async function handleWork(name, dept, senderId, text, env) {
  // Claude를 이용한 업무 분석 및 대표님께 Block Kit 전송
  const prompt = `직원 메시지 분석 JSON: {"importance":"high/medium/low","summary":"요약","report":"보고","draft":"답변"}`;
  const analysis = await claudeSimple(prompt, `발신: ${name}\n내용: ${text}`, env);
  const data = JSON.parse(analysis || '{}');

  await slackApi('chat.postMessage', {
    channel: env.BOSS_ID,
    text: `[업무보고] ${name}님`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${name}* (${dept})\n> ${text}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*AI 요약:* ${data.report}` } },
      { type: 'actions', elements: [
        { type: 'button', style: 'primary', text: { type: 'plain_text', text: '초안 발송' }, value: data.draft, action_id: 'approve' }
      ]}
    ]
  }, env.BOT_TOKEN);
}

// ─── [6] 헬퍼 함수들 ─────────────────────────────────────
function getDept(name) {
  const m = HNI.members[name];
  return m ? `${m.dept} ${m.role}` : '미확인 부서';
}

function isCounsel(text) {
  return ['고민', '힘들', '상담', '조언', '비전'].some(k => text.includes(k));
}

async function claudeSimple(system, userMsg, env) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-5-sonnet-20240620', max_tokens: 512, system, messages: [{ role: 'user', content: userMsg }] })
  });
  const d = await r.json();
  return d.content?.[0]?.text;
}

async function handleAction(payload, env) {
  const action = payload.actions?.[0];
  if (action?.action_id === 'approve') {
    // 승인 로직 처리
  }
}

export const config = { api: { bodyParser: false } };
