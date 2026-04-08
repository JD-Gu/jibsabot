import crypto from 'crypto';

// ─── 환경변수 ───────────────────────────────────────────
const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;
const BOSS_USER_ID         = process.env.BOSS_USER_ID; // 구자덕 대표님 Slack User ID

// ─── H&I 조직 정보 ──────────────────────────────────────
const HNI_ORG = {
  company: '주식회사 에이치앤아이 (H&I)',
  ceo: '구자덕 대표이사',
  departments: {
    '경영본부': {
      head: '김대수 본부장', slackId: 'U03M1SGS352',
      members: [],
      roles: ['경영관리 전반', '자금운영 관리', '생산/재고 관리', '구매/수출입']
    },
    '제품본부': {
      head: '이종혁 본부장', slackId: 'U02M86NGGM7',
      subDepts: {
        '상품관리팀': { head: '이지민 팀장', members: ['김민영 프로', '김다영 프로'], roles: ['상품 기획/관리', '영업/마케팅 지원', 'R&D 관리'] },
        '서비스지원팀': { head: '김인구 팀장', members: ['김훈지 프로(보)'], roles: ['고객 서비스 지원', '서비스 운영 지원', '디바이스 납품 지원'] },
        '기술연구소': { head: '김봉석 소장', members: ['김찬영 프로(보)', '이창현 프로'], roles: ['HI-PPE v4.0 개발', '디바이스 제품 운영'] },
        '플랫폼팀': { head: '정현수 팀장', members: ['지우현 프로', '박인영 프로', '정명휘 프로'], roles: ['HI-RTK 플랫폼 개발/운영'] }
      }
    }
  },
  keyProjects: [
    'HI-PPE v4.0 임베디드 코어 개발 (STM32H743ZIT6, EKF)',
    'HI-RTK 클라우드 SaaS 정밀측위 플랫폼 (AWS/NCP)',
    'LG유플러스 독점 OEM - U+초정밀측위 서비스',
    '전국 200개 GNSS 기준국 네트워크 운영',
    '유상증자 15억 목표 투자 유치 진행 중',
    '수원고등법원 2025라10377 법무 (JIN 경쟁사 분쟁)',
    '한진그룹 M&A 협상 진행 중'
  ],
  // 직원에게 공개 가능한 경영현황
  publicInfo: {
    status: '성장 중인 GNSS 전문기업. LG유플러스와 파트너십 견고.',
    vision: '국내 1위 초정밀 측위 플랫폼 기업 목표',
    projects: 'HI-PPE v4.0 개발 중, HI-RTK 플랫폼 운영 중, 기준국 200개 전국망 운영',
    culture: '기술 중심, 자율적 문화, 빠른 성장 환경'
  },
  // 직원에게 비공개 정보
  confidential: ['M&A', '한진그룹', '유상증자', '투자 협상', '소송', '법무', '급여', '인사평가', '매출', '재무제표']
};

// ─── 진행 중인 상담 세션 저장 (메모리) ──────────────────
const counselingSessions = new Map();
// { userId: { messages: [], startTime, senderName, dept } }

// ─── Slack 서명 검증 ────────────────────────────────────
function verifySlackSignature(headers, rawBody) {
  const timestamp = headers['x-slack-request-timestamp'];
  const slackSig  = headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(sigBase).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(slackSig));
  } catch { return false; }
}

// ─── Slack 메시지 발송 ──────────────────────────────────
async function sendSlack(channel, text, blocks = null) {
  const body = { channel, text };
  if (blocks) body.blocks = blocks;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── 발신자 조직 정보 ────────────────────────────────────
function getSenderInfo(senderName) {
  const org = HNI_ORG.departments;
  for (const [deptName, dept] of Object.entries(org)) {
    if (dept.head?.includes(senderName)) return { dept: deptName, role: dept.head };
    if (dept.subDepts) {
      for (const [subName, sub] of Object.entries(dept.subDepts)) {
        if (sub.head.includes(senderName)) return { dept: subName, role: sub.head };
        for (const m of (sub.members || [])) {
          if (m.includes(senderName)) return { dept: subName, role: m };
        }
      }
    }
  }
  return { dept: '미확인', role: senderName };
}

// ─── 상담 여부 감지 ──────────────────────────────────────
function isCounseling(text) {
  const keywords = [
    '고민', '힘들', '힘들어', '스트레스', '어려워', '걱정', '불안',
    '모르겠어', '어떡하', '상담', '조언', '도움', '어떻게 생각',
    '회사 어때', '회사 어떻게', '경영 현황', '회사 상황', '앞으로 어떻게',
    '미래', '방향', '비전', '우리 회사'
  ];
  return keywords.some(k => text.includes(k));
}

// ─── 비공개 정보 포함 여부 감지 ──────────────────────────
function isConfidential(text) {
  return HNI_ORG.confidential.some(k => text.includes(k));
}

// ─── Claude AI 호출 (일반 업무) ──────────────────────────
async function askClaudeForWork(messageText, senderName, senderInfo) {
  const system = `당신은 구자덕 대표(H&I)의 전용 AI 집사봇입니다.
조직정보: ${JSON.stringify(HNI_ORG, null, 2)}

아래 JSON 형식으로만 답하세요. 다른 텍스트 없이 순수 JSON만 출력.
{
  "importance": "high" | "medium" | "low",
  "category": "개발현황"|"재무/예산"|"법무"|"투자/IR"|"인사"|"고객/파트너"|"일반업무"|"완료보고",
  "summary": "한 줄 요약 (20자 이내)",
  "auto_reply": "low일 때만 답변, 나머지는 null",
  "report_to_boss": "대표님 보고 내용 (2-3문장)",
  "suggested_reply": "답변 초안"
}

판단기준:
- high: 예산/결재, 외부기관, 계약/협상, 인사, 법무, 투자/IR, 전략적 의사결정
- medium: 개발/업무 보고, 이슈/리스크, 주간보고, 고객 이슈
- low: 단순 일정확인, 파일요청, 간단 문의, 완료보고`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: `발신자: ${senderName} (${senderInfo.dept} / ${senderInfo.role})\n메시지: ${messageText}` }]
    }),
  });
  const data = await res.json();
  try { return JSON.parse(data.content?.[0]?.text?.trim() || '{}'); }
  catch { return { importance: 'medium', category: '일반업무', summary: '메시지 수신', auto_reply: null, report_to_boss: `${senderName}: ${messageText}`, suggested_reply: '확인 후 답변 드리겠습니다.' }; }
}

// ─── Claude AI 호출 (직원 상담) ──────────────────────────
async function askClaudeForCounseling(messageText, senderName, senderInfo, history) {
  const system = `당신은 H&I(에이치앤아이)의 친근한 AI 직원 상담사입니다.
회사 정보:
- GNSS/RTK 초정밀 측위 전문 중소기업, LG유플러스 파트너
- 비전: 국내 1위 초정밀 측위 플랫폼 기업
- 현재 HI-PPE v4.0, HI-RTK 플랫폼 개발 중, 전국 200개 기준국 운영
- 문화: 기술 중심, 자율적, 빠른 성장 환경

상담 원칙:
1. 따뜻하고 공감하는 태도로 대화
2. 업무 고민, 커리어, 팀 관계 등 진심으로 상담
3. 경영현황은 공개 가능한 범위(비전, 프로젝트 현황, 문화)에서만 답변
4. 급여, M&A, 투자협상, 소송, 재무제표 등 민감 정보는 "확인이 필요한 사항입니다"라고 안내
5. 한국어로, 친근하게, 200자 이내로 간결하게 답변
6. 대화가 3번 이상 이어지면 마무리 시 "더 궁금한 점이 있으면 언제든 말씀해주세요 😊"로 마무리

발신자: ${senderName} (${senderInfo.dept} / ${senderInfo.role})`;

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: messageText }
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 512, system, messages }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '죄송합니다, 잠시 후 다시 시도해주세요.';
}

// ─── 상담 요약 생성 ──────────────────────────────────────
async function summarizeCounseling(session) {
  const historyText = session.messages
    .map(m => `${m.role === 'user' ? session.senderName : '집사봇'}: ${m.content}`)
    .join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 512,
      system: '직원 상담 내용을 대표님께 보고하는 요약을 작성합니다. 핵심 고민, 상담 내용, 필요한 조치 여부를 간결하게 정리하세요. 민감한 개인정보는 포함하지 마세요.',
      messages: [{ role: 'user', content: `아래 상담 내용을 3-4줄로 요약해주세요:\n\n${historyText}` }]
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '상담 내용 요약 불가';
}

// ─── 대표님께 업무 보고 ──────────────────────────────────
async function reportToBoss({ senderName, senderInfo, senderId, originalMsg, analysis, originalChannel }) {
  const emoji = { high: '🔴', medium: '🟡', low: '🟢' }[analysis.importance] || '⚪';
  const catEmoji = { '개발현황':'⚙️', '재무/예산':'💰', '법무':'⚖️', '투자/IR':'📈', '인사':'👥', '고객/파트너':'🤝', '일반업무':'📋', '완료보고':'✅' }[analysis.category] || '📌';

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${analysis.summary}`, emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*발신자*\n${senderName}` },
        { type: 'mrkdwn', text: `*부서*\n${senderInfo.dept} · ${senderInfo.role}` },
        { type: 'mrkdwn', text: `*분류*\n${catEmoji} ${analysis.category}` },
        { type: 'mrkdwn', text: `*중요도*\n${emoji} ${analysis.importance.toUpperCase()}` }
      ]
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*원본 메시지*\n>${originalMsg}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 요약*\n${analysis.report_to_boss}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 초안 답변*\n${analysis.suggested_reply}` } },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '✅ 초안으로 발송', emoji: true }, style: 'primary',
          value: JSON.stringify({ action: 'approve', senderId, originalChannel, reply: analysis.suggested_reply }), action_id: 'approve_reply' },
        { type: 'button', text: { type: 'plain_text', text: '✏️ 직접 답변', emoji: true },
          value: JSON.stringify({ action: 'manual', senderId, originalChannel }), action_id: 'manual_reply' },
        { type: 'button', text: { type: 'plain_text', text: '🚫 무시', emoji: true }, style: 'danger',
          value: JSON.stringify({ action: 'ignore' }), action_id: 'ignore_reply' }
      ]
    }
  ];

  await sendSlack(BOSS_USER_ID, `${emoji} [집사봇] ${senderName}: ${analysis.summary}`, blocks);
}

// ─── 대표님께 상담 요약 보고 ─────────────────────────────
async function reportCounselingToBoss(session, summary) {
  const elapsed = Math.round((Date.now() - session.startTime) / 60000);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `💬 직원 상담 완료 보고`, emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*직원*\n${session.senderName}` },
        { type: 'mrkdwn', text: `*부서*\n${session.dept}` },
        { type: 'mrkdwn', text: `*대화 횟수*\n${Math.ceil(session.messages.length / 2)}회` },
        { type: 'mrkdwn', text: `*상담 시간*\n약 ${elapsed}분` }
      ]
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*상담 요약*\n${summary}` } },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '📞 직접 연락하기', emoji: true },
          value: JSON.stringify({ action: 'contact', userId: session.userId }), action_id: 'contact_employee' },
        { type: 'button', text: { type: 'plain_text', text: '✅ 확인 완료', emoji: true }, style: 'primary',
          value: JSON.stringify({ action: 'ack' }), action_id: 'ack_counseling' }
      ]
    }
  ];

  await sendSlack(BOSS_USER_ID, `💬 [집사봇] ${session.senderName} 상담 완료`, blocks);
}

// ─── 메인 핸들러 ────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  let body;
  try {
    body = rawBody.startsWith('payload=')
      ? { payload: decodeURIComponent(rawBody.replace('payload=', '')) }
      : JSON.parse(rawBody);
  } catch { return res.status(400).json({ error: 'Invalid body' }); }

  // ── 버튼 액션 처리 ──
  if (body.payload) {
    const payload = JSON.parse(body.payload);
    const action  = payload.actions?.[0];
    if (!action) return res.status(200).end();
    const value = JSON.parse(action.value || '{}');

    if (value.action === 'approve') {
      await sendSlack(value.originalChannel, value.reply);
      await sendSlack(BOSS_USER_ID, '✅ 답변이 발송되었습니다.');
    } else if (value.action === 'manual') {
      await sendSlack(BOSS_USER_ID, `✏️ 직접 답변 모드입니다.\n해당 채팅창에서 직접 답변해 주세요.`);
    } else if (value.action === 'ignore') {
      await sendSlack(BOSS_USER_ID, '🚫 해당 메시지를 무시했습니다.');
    } else if (value.action === 'contact') {
      await sendSlack(BOSS_USER_ID, `📞 <@${value.userId}>에게 직접 연락해주세요.`);
    } else if (value.action === 'ack') {
      await sendSlack(BOSS_USER_ID, '✅ 상담 보고를 확인하셨습니다.');
    }
    return res.status(200).end();
  }

  // ── Slack URL 검증 ──
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // ── 서명 검증 ──
  if (!verifySlackSignature(req.headers, rawBody)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = body.event;
  if (!event) return res.status(200).end();
  if (event.bot_id || event.subtype === 'bot_message') return res.status(200).end();
  if (event.user === BOSS_USER_ID) return res.status(200).end();

  if (event.type === 'message' && event.text) {
    const senderId    = event.user;
    const messageText = event.text.trim();
    const channel     = event.channel;

    try {
      // 발신자 정보 조회
      const userRes  = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
        headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
      });
      const userData   = await userRes.json();
      const senderName = userData.user?.profile?.real_name || userData.user?.name || senderId;
      const senderInfo = getSenderInfo(senderName);

      // ── 상담 세션 처리 ──
      const isInCounseling = counselingSessions.has(senderId);
      const shouldCounsel  = isCounseling(messageText);

      if (isInCounseling || shouldCounsel) {
        // 세션 없으면 새로 생성
        if (!isInCounseling) {
          counselingSessions.set(senderId, {
            userId: senderId,
            senderName,
            dept: senderInfo.dept,
            messages: [],
            startTime: Date.now()
          });
          // 상담 시작 안내
          await sendSlack(channel,
            `안녕하세요 ${senderName}님 😊\n집사봇이 말씀 들을게요. 편하게 이야기해 주세요.\n_(대화 내용은 요약되어 대표님께 보고됩니다)_`
          );
        }

        const session = counselingSessions.get(senderId);

        // 비공개 정보 요청 감지
        if (isConfidential(messageText)) {
          const reply = '해당 내용은 확인이 필요한 사항입니다. 대표님께 직접 문의해 주시면 더 정확한 답변을 드릴 수 있어요 😊';
          await sendSlack(channel, reply);
          session.messages.push({ role: 'user', content: messageText });
          session.messages.push({ role: 'assistant', content: reply });
          return res.status(200).end();
        }

        // AI 상담 답변
        const reply = await askClaudeForCounseling(
          messageText, senderName, senderInfo, session.messages
        );
        await sendSlack(channel, reply);

        // 대화 기록 저장
        session.messages.push({ role: 'user', content: messageText });
        session.messages.push({ role: 'assistant', content: reply });

        // 5턴 이상 또는 마무리 키워드 감지 시 요약 보고
        const endKeywords = ['감사', '고마워', '알겠어', '됐어', '이제 됐', '해결'];
        const isEnding = endKeywords.some(k => messageText.includes(k));
        const isLong   = session.messages.length >= 10;

        if (isEnding || isLong) {
          const summary = await summarizeCounseling(session);
          await reportCounselingToBoss(session, summary);
          counselingSessions.delete(senderId);
        }

        return res.status(200).end();
      }

      // ── 일반 업무 메시지 처리 ──
      const analysis = await askClaudeForWork(messageText, senderName, senderInfo);

      if (analysis.importance === 'low' && analysis.auto_reply) {
        await sendSlack(channel, analysis.auto_reply);
        await sendSlack(BOSS_USER_ID,
          `🟢 자동 처리 | ${senderName}(${senderInfo.dept})\n*메시지:* ${messageText}\n*답변:* ${analysis.auto_reply}`
        );
      } else {
        await reportToBoss({ senderName, senderInfo, senderId, originalMsg: messageText, analysis, originalChannel: channel });
      }

    } catch (err) {
      console.error('Error:', err);
      await sendSlack(BOSS_USER_ID, `⚠️ 처리 오류\n발신자ID: ${senderId}\n내용: ${messageText}\n오류: ${err.message}`);
    }
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
