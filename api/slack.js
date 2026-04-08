// ═══════════════════════════════════════════════════════
// 구대표 집사봇 v7 — 완성본
// 기능 1: 대표님 ↔ 집사봇 직접 대화
// 기능 2: 직원 → 집사봇 → 대표님 보고 (승인 버튼)
// 기능 3: 직원 고민 상담 (상담 후 대표님께 요약 보고)
// 기능 4: 회사 경영현황 브리핑 (공개 범위 내)
// ═══════════════════════════════════════════════════════

// ─── H&I 조직 및 회사 정보 ──────────────────────────────
const HNI = {
  departments: {
    '경영본부':    { head: '김대수 본부장',  members: [] },
    '제품본부':    { head: '이종혁 본부장',  members: [] },
    '상품관리팀':  { head: '이지민 팀장',    members: ['김민영 프로', '김다영 프로'] },
    '서비스지원팀':{ head: '김인구 팀장',    members: ['김훈지 프로'] },
    '기술연구소':  { head: '김봉석 소장',    members: ['김찬영 프로', '이창현 프로'] },
    '플랫폼팀':    { head: '정현수 팀장',    members: ['지우현 프로', '박인영 프로', '정명휘 프로'] }
  },
  // 직원에게 공개 가능한 경영현황
  public: {
    vision: '국내 1위 초정밀 측위 플랫폼 기업',
    business: 'GNSS/RTK 초정밀 측위 전문기업. LG유플러스와 독점 파트너십.',
    projects: 'HI-PPE v4.0 임베디드 개발 중, HI-RTK 클라우드 플랫폼 운영 중, 전국 200개 GNSS 기준국 운영',
    culture: '기술 중심, 자율적 문화, 빠른 성장 환경',
    future: '초정밀 측위 기술로 자율주행, 스마트시티 등 미래 모빌리티 시장 선도'
  },
  // 직원에게 비공개 정보 (언급 차단)
  confidential: ['M&A', '한진그룹', '유상증자', '투자 협상', '투자자', '소송', '법무', '급여', '연봉', '인사평가', '매출', '재무제표', '영업이익']
};

// 상담 세션 저장 (서버 메모리)
const sessions = new Map();

// ─── 유틸 함수들 ────────────────────────────────────────

// 발신자 부서 찾기
function getDept(name) {
  for (const [dept, info] of Object.entries(HNI.departments)) {
    if (info.head?.includes(name)) return `${dept} · ${info.head}`;
    for (const m of (info.members || [])) {
      if (m.includes(name)) return `${dept} · ${m}`;
    }
  }
  return '미확인';
}

// 상담 키워드 감지
function isCounsel(text) {
  const keywords = [
    '고민', '힘들', '힘드', '스트레스', '어려워', '걱정', '불안', '외로워',
    '상담', '조언', '도움', '어떡하', '모르겠어', '지쳐',
    '회사 어때', '회사 어떻게', '경영 현황', '우리 회사', '회사 방향',
    '비전', '미래', '앞으로', '전망'
  ];
  return keywords.some(k => text.includes(k));
}

// 비공개 키워드 감지
function isConfidential(text) {
  return HNI.confidential.some(k => text.includes(k));
}

// ─── API 헬퍼 함수들 ────────────────────────────────────

// Slack 메시지 발송
async function slack(channel, text, blocks, token) {
  const fallback = String(text || '집사봇 알림');
  const body = blocks
    ? { channel, text: fallback, blocks }
    : { channel, text: fallback };

  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!d.ok) console.error('slack error:', d.error, '| channel:', channel);
  return d;
}

// Claude API 호출
async function claude(system, userMsg, apiKey, maxTokens = 1024) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
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

// JSON 안전 추출
function parseJSON(raw) {
  try {
    const match = raw.match(/\{[\s\S]*?\}/);
    return JSON.parse(match ? match[0] : '{}');
  } catch {
    return {};
  }
}

// ─── 기능 1: 대표님 직접 대화 ───────────────────────────
async function handleBoss(text, channel, env) {
  const reply = await claude(
    `당신은 구자덕 대표(H&I 에이치앤아이)의 전용 AI 집사봇입니다.
회사: GNSS/RTK 초정밀 측위 전문기업, LG유플러스 독점 파트너
주요 인물: 이종혁(제품본부장), 김봉석(기술연구소장), 김인구(서비스지원팀장), 김대수(경영본부장)
주요 현안: HI-PPE v4.0 개발, 유상증자 15억, 법무 진행 중, 한진그룹 M&A 협상
대표님의 업무를 돕는 비서로서 친절하고 간결하게 한국어로 답하세요.
필요하면 직원에게 보낼 메시지 초안도 작성해드리세요.`,
    text,
    env.CLAUDE_KEY
  );
  await slack(channel, reply || '처리 완료', null, env.BOT_TOKEN);
}

// ─── 기능 2: 직원 업무 메시지 → 대표님 보고 ─────────────
async function handleWork(name, dept, senderId, text, channel, env) {
  const raw = await claude(
    `당신은 구자덕 대표(H&I)의 AI 집사봇입니다.
직원 업무 메시지를 분석해서 아래 JSON만 출력하세요. 코드블록 없이 순수 JSON만.
{"importance":"medium","summary":"10자이내요약","report":"대표님께보고할내용2-3문장","draft":"답변초안"}
importance 기준:
- high: 결재/예산승인/계약/인사/외부기관 대응
- medium: 업무보고/개발현황/이슈/고객문의
- low: 단순완료보고/간단문의`,
    `발신자: ${name} (${dept})\n내용: ${text}`,
    env.CLAUDE_KEY,
    512
  );

  const a = parseJSON(raw);
  const importance = String(a.importance || 'medium');
  const summary    = String(a.summary    || '메시지 수신');
  const report     = String(a.report     || `${name}: ${text}`);
  const draft      = String(a.draft      || '확인 후 답변 드리겠습니다.');
  const emoji      = { high: '🔴', medium: '🟡', low: '🟢' }[importance] || '⚪';

  await slack(env.BOSS_ID, `${emoji} [집사봇] ${name}: ${summary}`, [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${summary}`, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*발신자*\n${name}` },
      { type: 'mrkdwn', text: `*부서*\n${dept}` },
      { type: 'mrkdwn', text: `*중요도*\n${emoji} ${importance}` },
      { type: 'mrkdwn', text: `*시간*\n방금` }
    ]},
    { type: 'section', text: { type: 'mrkdwn', text: `*원본 메시지*\n> ${text}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 요약*\n${report}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 초안 답변*\n${draft}` } },
    { type: 'actions', elements: [
      { type: 'button', style: 'primary', action_id: 'approve',
        text: { type: 'plain_text', text: '✅ 초안으로 발송', emoji: true },
        value: JSON.stringify({ action: 'approve', channel, reply: draft }) },
      { type: 'button', action_id: 'ignore', style: 'danger',
        text: { type: 'plain_text', text: '🚫 무시', emoji: true },
        value: JSON.stringify({ action: 'ignore' }) }
    ]}
  ], env.BOT_TOKEN);
}

// ─── 기능 3 & 4: 직원 상담 + 경영현황 브리핑 ─────────────
async function handleCounsel(senderId, name, dept, text, channel, env) {
  // 새 세션 시작
  if (!sessions.has(senderId)) {
    sessions.set(senderId, {
      userId: senderId, name, dept,
      history: [], start: Date.now()
    });
    await slack(channel,
      `안녕하세요 ${name}님 😊 집사봇이 말씀 들을게요.\n편하게 이야기해 주세요.\n_(대화 내용은 요약되어 대표님께 보고됩니다)_`,
      null, env.BOT_TOKEN
    );
  }

  const session = sessions.get(senderId);

  // 비공개 정보 차단
  if (isConfidential(text)) {
    const reply = '해당 내용은 대표님께 직접 문의해 주시면 더 정확하게 안내해드릴 수 있어요 😊';
    await slack(channel, reply, null, env.BOT_TOKEN);
    session.history.push({ role: 'user', content: text });
    session.history.push({ role: 'assistant', content: reply });
    return;
  }

  // AI 상담 답변
  const reply = await claude(
    `당신은 H&I(에이치앤아이)의 친근한 AI 상담사입니다.

[공개 가능한 회사 정보]
- 비전: ${HNI.public.vision}
- 사업: ${HNI.public.business}
- 진행 프로젝트: ${HNI.public.projects}
- 문화: ${HNI.public.culture}
- 미래: ${HNI.public.future}

[상담 원칙]
1. 따뜻하게 공감하며 경청
2. 업무 스트레스, 커리어, 팀 관계 등 진심으로 상담
3. 회사 현황은 위 공개 정보 범위 내에서만 답변
4. 민감 정보 질문은 "대표님께 직접 문의"로 안내
5. 한국어, 친근하게, 200자 이내로 간결하게
6. 발신자: ${name} (${dept})`,
    text,
    env.CLAUDE_KEY,
    400
  );

  await slack(channel, reply || '말씀 잘 들었습니다 😊', null, env.BOT_TOKEN);

  session.history.push({ role: 'user', content: text });
  session.history.push({ role: 'assistant', content: reply });

  // 마무리 감지 또는 10턴 → 요약 보고
  const endWords = ['감사', '고마워', '고맙', '알겠어', '됐어', '해결', '이제 됐', '도움됐'];
  const isEnding = endWords.some(k => text.includes(k));

  if (isEnding || session.history.length >= 10) {
    const historyText = session.history
      .map(m => `${m.role === 'user' ? session.name : '봇'}: ${m.content}`)
      .join('\n');

    const summary = await claude(
      '직원 상담 내용을 대표님께 3-4줄로 요약하세요. 핵심 고민, 상담 내용, 조치 필요 여부 포함. 민감 개인정보 제외.',
      historyText,
      env.CLAUDE_KEY,
      300
    );

    const elapsed = Math.round((Date.now() - session.start) / 60000);

    await slack(env.BOSS_ID, `💬 [집사봇] ${session.name} 상담 완료`, [
      { type: 'header', text: { type: 'plain_text', text: '💬 직원 상담 완료 보고', emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*직원*\n${session.name}` },
        { type: 'mrkdwn', text: `*부서*\n${session.dept}` },
        { type: 'mrkdwn', text: `*대화횟수*\n${Math.ceil(session.history.length / 2)}회` },
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
    await slack(val.channel, val.reply, null, env.BOT_TOKEN);
    await slack(env.BOSS_ID, '✅ 답변이 발송되었습니다.', null, env.BOT_TOKEN);
  } else if (val.action === 'ignore') {
    await slack(env.BOSS_ID, '🚫 해당 메시지를 무시했습니다.', null, env.BOT_TOKEN);
  } else if (val.action === 'contact') {
    await slack(env.BOSS_ID, `📞 <@${val.userId}>에게 직접 연락해주세요.`, null, env.BOT_TOKEN);
  } else if (val.action === 'ack') {
    await slack(env.BOSS_ID, '✅ 상담 보고를 확인하셨습니다.', null, env.BOT_TOKEN);
  }
}

// ─── 메인 핸들러 ────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const env = {
    BOT_TOKEN: process.env.SLACK_BOT_TOKEN  || '',
    BOSS_ID:   process.env.BOSS_USER_ID     || '',
    CLAUDE_KEY:process.env.ANTHROPIC_API_KEY || ''
  };

  // 버튼 액션 처리
  if (rawBody.startsWith('payload=')) {
    try {
      const payload = JSON.parse(decodeURIComponent(rawBody.slice(8)));
      await handleAction(payload, env);
    } catch(e) {
      console.error('action error:', e.message);
    }
    return res.status(200).end();
  }

  // JSON 파싱
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return res.status(200).end();
  }

  // Slack URL 검증 (최초 1회)
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  const event = body.event;
  if (!event) return res.status(200).end();

  // 봇 자신의 메시지 무시 (무한루프 방지)
  if (event.bot_id)                          return res.status(200).end();
  if (event.subtype === 'bot_message')       return res.status(200).end();
  if (!event.user)                           return res.status(200).end();
  if (!event.text)                           return res.status(200).end();

  const senderId = event.user;
  const text     = event.text.trim();
  const channel  = event.channel;

  try {
    // ── 기능 1: 대표님 직접 대화 ──
    if (senderId === env.BOSS_ID) {
      await handleBoss(text, channel, env);
      return res.status(200).end();
    }

    // 발신자 이름 조회
    const ur = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
      headers: { 'Authorization': `Bearer ${env.BOT_TOKEN}` }
    });
    const ud   = await ur.json();
    const name = ud.user?.profile?.real_name || ud.user?.name || senderId;
    const dept = getDept(name);

    // ── 기능 3 & 4: 상담/경영현황 브리핑 ──
    if (sessions.has(senderId) || isCounsel(text)) {
      await handleCounsel(senderId, name, dept, text, channel, env);
      return res.status(200).end();
    }

    // ── 기능 2: 직원 업무 메시지 → 대표님 보고 ──
    await handleWork(name, dept, senderId, text, channel, env);

  } catch(e) {
    console.error('main error:', e.message);
    await slack(env.BOSS_ID,
      `⚠️ 오류\n발신자: ${senderId}\n내용: ${text}\n오류: ${e.message}`,
      null, env.BOT_TOKEN
    );
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
