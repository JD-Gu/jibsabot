// ═══════════════════════════════════════════════════════
// 구대표 집사봇 v9
// ═══════════════════════════════════════════════════════

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

// 상담 세션
const sessions = new Map();

// 이름으로 Slack ID 찾기
function findMemberId(name) {
  for (const [key, val] of Object.entries(HNI.members)) {
    if (name.includes(key) || key.includes(name)) return val.id;
  }
  return null;
}

// 발신자 부서 찾기
function getDept(name) {
  for (const [key, val] of Object.entries(HNI.members)) {
    if (name.includes(key) || key.includes(name)) return `${val.dept} · ${val.role}`;
  }
  return '미확인';
}

// 상담 키워드
function isCounsel(text) {
  return ['고민', '힘들', '스트레스', '어려워', '걱정', '불안', '상담', '조언',
    '회사 어때', '경영 현황', '우리 회사', '비전', '미래', '앞으로'].some(k => text.includes(k));
}

// 비공개 키워드
function isConfidential(text) {
  return HNI.confidential.some(k => text.includes(k));
}

// ─── Claude Tool 정의 ────────────────────────────────────
const TOOLS = [
  {
    name: 'send_message',
    description: '직원에게 Slack DM을 보냅니다. 이름을 알려주면 자동으로 찾아서 발송합니다.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '받을 직원 이름 (예: 김인구, 이종혁)' },
        message: { type: 'string', description: '보낼 메시지 내용' }
      },
      required: ['name', 'message']
    }
  },
  {
    name: 'search_slack',
    description: 'Slack에서 메시지, 일정, 업무 현황 등을 검색합니다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색할 내용' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_member_status',
    description: '직원의 Slack 상태(온라인 여부, 상태 메시지 등)를 조회합니다.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '조회할 직원 이름' }
      },
      required: ['name']
    }
  }
];

// ─── API 헬퍼 ────────────────────────────────────────────

async function slackPost(channel, text, blocks, token) {
  const body = blocks
    ? { channel, text: String(text || '집사봇'), blocks }
    : { channel, text: String(text || '집사봇') };
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!d.ok) console.error('slack post error:', d.error);
  return d;
}

// ─── Tool 실행 ───────────────────────────────────────────
async function executeTool(toolName, input, env) {
  console.log(`Tool: ${toolName}`, JSON.stringify(input));

  if (toolName === 'send_message') {
    // 이름으로 ID 찾기
    let targetId = findMemberId(input.name);

    // 없으면 Slack 검색
    if (!targetId) {
      const r = await fetch('https://slack.com/api/users.list', {
        headers: { 'Authorization': `Bearer ${env.BOT_TOKEN}` }
      });
      const d = await r.json();
      if (d.ok) {
        const found = d.members?.find(m =>
          m.real_name?.includes(input.name) ||
          m.profile?.real_name?.includes(input.name) ||
          m.name?.includes(input.name)
        );
        if (found) targetId = found.id;
      }
    }

    if (!targetId) return `죄송합니다. ${input.name}의 Slack 계정을 찾을 수 없습니다.`;

    const result = await slackPost(targetId, input.message, null, env.BOT_TOKEN);
    return result.ok
      ? `✅ ${input.name}에게 메시지를 보냈습니다: "${input.message}"`
      : `❌ 발송 실패: ${result.error}`;
  }

  if (toolName === 'search_slack') {
    const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(input.query)}&count=5&sort=timestamp&sort_dir=desc`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${env.BOT_TOKEN}` } });
    const d = await r.json();
    if (!d.ok || !d.messages?.matches?.length) return '검색 결과가 없습니다.';
    return d.messages.matches.map(m =>
      `[${m.username}] ${m.text?.slice(0, 150)}`
    ).join('\n\n');
  }

  if (toolName === 'get_member_status') {
    const memberId = findMemberId(input.name);
    if (!memberId) return `${input.name}의 정보를 찾을 수 없습니다.`;
    const r = await fetch(`https://slack.com/api/users.info?user=${memberId}`, {
      headers: { 'Authorization': `Bearer ${env.BOT_TOKEN}` }
    });
    const d = await r.json();
    if (!d.ok) return '사용자 정보 조회 실패';
    const u = d.user;
    const status = u.profile?.status_text || '없음';
    const presence = u.deleted ? '퇴사' : '재직중';
    return `${u.real_name} (${HNI.members[input.name]?.dept || '미확인'} ${HNI.members[input.name]?.role || ''})\n상태: ${status}\n${presence}`;
  }

  return '알 수 없는 도구입니다.';
}

// ─── Claude API (Tool Use 포함) ───────────────────────────
async function claudeWithTools(system, userMsg, env) {
  const messages = [{ role: 'user', content: userMsg }];
  let finalText = '';

  for (let round = 0; round < 5; round++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system,
        tools: TOOLS,
        messages
      })
    });
    const d = await r.json();

    // 텍스트 수집
    const texts = d.content?.filter(b => b.type === 'text') || [];
    if (texts.length) finalText = texts.map(b => b.text).join('');

    if (d.stop_reason === 'end_turn') break;
    if (d.stop_reason !== 'tool_use') break;

    // 도구 실행
    const toolUses = d.content?.filter(b => b.type === 'tool_use') || [];
    if (!toolUses.length) break;

    messages.push({ role: 'assistant', content: d.content });

    const results = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input, env);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) });
    }
    messages.push({ role: 'user', content: results });
  }

  return finalText || '처리가 완료되었습니다.';
}

// ─── Claude API (단순) ────────────────────────────────────
async function claudeSimple(system, userMsg, env, maxTokens = 512) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }]
    })
  });
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

function parseJSON(raw) {
  try {
    const match = raw.match(/\{[\s\S]*?\}/);
    return JSON.parse(match ? match[0] : '{}');
  } catch { return {}; }
}

// ─── 기능 1: 대표님 대화 (자연스럽게 + Tool Use) ──────────
async function handleBoss(text, channel, env) {
  const memberList = Object.entries(HNI.members)
    .map(([n, v]) => `${n}(${v.dept} ${v.role}, ID:${v.id || '미확인'})`)
    .join(', ');

  const reply = await claudeWithTools(
    `당신은 구자덕 대표(H&I 에이치앤아이)의 전용 AI 집사봇 "자두"입니다.

[회사 정보]
- 회사: GNSS/RTK 초정밀 측위 전문기업, LG유플러스 독점 파트너
- 직원: ${memberList}
- 주요 프로젝트: HI-PPE v4.0 개발, HI-RTK 플랫폼, GNSS 기준국 200개

[행동 원칙]
1. 인사나 일상 대화는 자연스럽게 친근하게 답변
2. "안녕" → "안녕하세요, 대표님! 오늘 어떤 업무를 도와드릴까요? 😊"
3. 날씨, 일반 지식 질문 → 바로 답변
4. 직원에게 메시지 보내달라 → send_message 도구로 실제 발송
5. 직원/채널 검색 → search_slack 도구 사용
6. 모든 답변은 한국어로, 간결하고 친근하게`,
    text,
    env
  );
  await slackPost(channel, reply, null, env.BOT_TOKEN);
}

// ─── 기능 2: 직원 업무 메시지 → 대표님 보고 ─────────────
async function handleWork(name, dept, senderId, text, channel, env) {
  const raw = await claudeSimple(
    `직원 메시지를 분석해서 JSON만 출력. 코드블록 없이.
{"importance":"medium","summary":"10자이내요약","report":"보고내용","draft":"답변초안","auto_reply":"low일때자동회신문구또는null"}
importance: high(결재/계약/인사/예산), medium(업무보고/이슈), low(단순인사/완료보고/테스트)
low이고 단순 인사나 테스트 메시지면 auto_reply에 자연스러운 회신 문구 넣기`,
    `발신자: ${name} (${dept})\n내용: ${text}`,
    env
  );

  const a = parseJSON(raw);
  const importance = String(a.importance || 'medium');
  const summary    = String(a.summary    || '메시지 수신');
  const report     = String(a.report     || `${name}: ${text}`);
  const draft      = String(a.draft      || '확인 후 답변 드리겠습니다.');
  const autoReply  = a.auto_reply;
  const emoji      = { high: '🔴', medium: '🟡', low: '🟢' }[importance] || '⚪';

  // low + 자동회신 → 즉시 발송
  if (importance === 'low' && autoReply) {
    await slackPost(channel, autoReply, null, env.BOT_TOKEN);
    await slackPost(env.BOSS_ID,
      `🟢 자동 처리 | ${name}(${dept})\n메시지: ${text}\n답변: ${autoReply}`,
      null, env.BOT_TOKEN
    );
    return;
  }

  // 대표님께 보고 + 승인 버튼
  await slackPost(env.BOSS_ID, `${emoji} [집사봇] ${name}: ${summary}`, [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${summary}`, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*발신자*\n${name}` },
      { type: 'mrkdwn', text: `*부서*\n${dept}` },
      { type: 'mrkdwn', text: `*중요도*\n${emoji} ${importance}` }
    ]},
    { type: 'section', text: { type: 'mrkdwn', text: `*원본 메시지*\n> ${text}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 요약*\n${report}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 초안 답변*\n${draft}` } },
    { type: 'actions', elements: [
      { type: 'button', style: 'primary', action_id: 'approve',
        text: { type: 'plain_text', text: '✅ 초안으로 발송', emoji: true },
        value: JSON.stringify({ action: 'approve', channel, reply: draft }) },
      { type: 'button', style: 'danger', action_id: 'ignore',
        text: { type: 'plain_text', text: '🚫 무시', emoji: true },
        value: JSON.stringify({ action: 'ignore' }) }
    ]}
  ], env.BOT_TOKEN);
}

// ─── 기능 3 & 4: 직원 상담 + 경영현황 ───────────────────
async function handleCounsel(senderId, name, dept, text, channel, env) {
  if (!sessions.has(senderId)) {
    sessions.set(senderId, { userId: senderId, name, dept, history: [], start: Date.now() });
    await slackPost(channel,
      `안녕하세요 ${name}님 😊 집사봇이 말씀 들을게요.\n편하게 이야기해 주세요.\n_(대화 내용은 요약되어 대표님께 보고됩니다)_`,
      null, env.BOT_TOKEN
    );
  }

  const session = sessions.get(senderId);

  if (isConfidential(text)) {
    const reply = '해당 내용은 대표님께 직접 문의해 주시면 더 정확하게 안내해드릴 수 있어요 😊';
    await slackPost(channel, reply, null, env.BOT_TOKEN);
    session.history.push({ role: 'user', content: text });
    session.history.push({ role: 'assistant', content: reply });
    return;
  }

  const reply = await claudeSimple(
    `당신은 H&I의 친근한 AI 상담사입니다.
회사 공개 정보: ${JSON.stringify(HNI.public)}
원칙: 따뜻하게 공감, 업무/커리어/팀관계 상담, 민감정보는 "대표님께 직접 문의" 안내
답변: 한국어, 친근하게, 200자 이내, 발신자: ${name} (${dept})`,
    text, env, 400
  );

  await slackPost(channel, reply || '말씀 잘 들었습니다 😊', null, env.BOT_TOKEN);
  session.history.push({ role: 'user', content: text });
  session.history.push({ role: 'assistant', content: reply });

  const endWords = ['감사', '고마워', '고맙', '알겠어', '됐어', '해결', '도움됐'];
  if (endWords.some(k => text.includes(k)) || session.history.length >= 10) {
    const histTxt = session.history.map(m =>
      `${m.role === 'user' ? session.name : '봇'}: ${m.content}`
    ).join('\n');
    const summary = await claudeSimple(
      '직원 상담 내용을 대표님께 3-4줄로 요약. 핵심 고민, 상담 내용, 조치 필요 여부 포함.',
      histTxt, env, 300
    );
    const elapsed = Math.round((Date.now() - session.start) / 60000);
    await slackPost(env.BOSS_ID, `💬 [집사봇] ${session.name} 상담 완료`, [
      { type: 'header', text: { type: 'plain_text', text: '💬 직원 상담 완료 보고', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*직원*\n${session.name}` },
        { type: 'mrkdwn', text: `*부서*\n${session.dept}` },
        { type: 'mrkdwn', text: `*대화횟수*\n${Math.ceil(session.history.length/2)}회` },
        { type: 'mrkdwn', text: `*상담시간*\n약 ${elapsed}분` }
      ]},
      { type: 'section', text: { type: 'mrkdwn', text: `*상담 요약*\n${summary}` } },
      { type: 'actions', elements: [
        { type: 'button', action_id: 'contact',
          text: { type: 'plain_text', text: '📞 직접 연락', emoji: true },
          value: JSON.stringify({ action: 'contact', userId: session.userId }) },
        { type: 'button', style: 'primary', action_id: 'ack',
          text: { type: 'plain_text', text: '✅ 확인 완료', emoji: true },
          value: JSON.stringify({ action: 'ack' }) }
      ]}
    ], env.BOT_TOKEN);
    sessions.delete(senderId);
  }
}

// ─── 버튼 액션 처리 ──────────────────────────────────────
async function handleAction(payload, env) {
  const action = payload.actions?.[0];
  if (!action) return;
  let val = {};
  try { val = JSON.parse(action.value || '{}'); } catch {}

  if (val.action === 'approve') {
    await slackPost(val.channel, val.reply, null, env.BOT_TOKEN);
    await slackPost(env.BOSS_ID, '✅ 답변이 발송되었습니다.', null, env.BOT_TOKEN);
  } else if (val.action === 'ignore') {
    await slackPost(env.BOSS_ID, '🚫 해당 메시지를 무시했습니다.', null, env.BOT_TOKEN);
  } else if (val.action === 'contact') {
    await slackPost(env.BOSS_ID, `📞 <@${val.userId}>에게 직접 연락해주세요.`, null, env.BOT_TOKEN);
  } else if (val.action === 'ack') {
    await slackPost(env.BOSS_ID, '✅ 상담 보고를 확인하셨습니다.', null, env.BOT_TOKEN);
  }
}

// ─── 메인 핸들러 ────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const env = {
    BOT_TOKEN:  process.env.SLACK_BOT_TOKEN   || '',
    BOSS_ID:    process.env.BOSS_USER_ID      || '',
    CLAUDE_KEY: process.env.ANTHROPIC_API_KEY || ''
  };

  // 버튼 액션
  if (rawBody.startsWith('payload=')) {
    try {
      const payload = JSON.parse(decodeURIComponent(rawBody.slice(8)));
      await handleAction(payload, env);
    } catch(e) { console.error('action error:', e.message); }
    return res.status(200).end();
  }

  let body;
  try { body = JSON.parse(rawBody); }
  catch { return res.status(200).end(); }

  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  const event = body.event;
  if (!event) return res.status(200).end();

  if (event.bot_id)                    return res.status(200).end();
  if (event.subtype === 'bot_message') return res.status(200).end();
  if (!event.user)                     return res.status(200).end();
  if (!event.text)                     return res.status(200).end();

  const senderId = event.user;
  const text     = event.text.trim();
  const channel  = event.channel;

  try {
    // 기능 1: 대표님 대화
    if (senderId === env.BOSS_ID) {
      await handleBoss(text, channel, env);
      return res.status(200).end();
    }

    // 발신자 정보
    const ur = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
      headers: { 'Authorization': `Bearer ${env.BOT_TOKEN}` }
    });
    const ud   = await ur.json();
    const name = ud.user?.profile?.real_name || ud.user?.name || senderId;
    const dept = getDept(name);

    // 기능 3 & 4: 상담
    if (sessions.has(senderId) || isCounsel(text)) {
      await handleCounsel(senderId, name, dept, text, channel, env);
      return res.status(200).end();
    }

    // 기능 2: 업무 보고
    await handleWork(name, dept, senderId, text, channel, env);

  } catch(e) {
    console.error('main error:', e.message);
    await slackPost(env.BOSS_ID,
      `⚠️ 오류\n발신자: ${senderId}\n내용: ${text}\n오류: ${e.message}`,
      null, env.BOT_TOKEN
    );
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
