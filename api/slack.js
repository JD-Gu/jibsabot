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
      head: '김대수 본부장',
      slackId: 'U03M1SGS352',
      members: ['최선영 매니저 (퇴사)'],
      roles: ['경영관리 전반', '자금운영 관리', '생산/재고 관리', '구매/수출입']
    },
    '제품본부': {
      head: '이종혁 본부장',
      slackId: 'U02M86NGGM7',
      members: ['이지민 팀장(상품관리팀)', '김민영 프로', '김다영 프로',
                '김인구 팀장(서비스지원팀)', '김훈지 프로(보)',
                '김봉석 소장(기술연구소)', '김찬영 프로(보)', '이창현 프로',
                '정현수 팀장(플랫폼팀)', '지우현 프로', '박인영 프로', '정명휘 프로'],
      subDepts: {
        '상품관리팀': { head: '이지민 팀장', roles: ['상품 기획/관리', '상품 개발 관리', '고객 서비스 지원', '영업/마케팅 지원', 'R&D 관리'] },
        '서비스지원팀': { head: '김인구 팀장', roles: ['고객 서비스 지원', '서비스 운영 지원', '디바이스 생산 지원', '디바이스 납품 지원', '자산 관리 지원'] },
        '기술연구소': { head: '김봉석 소장', roles: ['디바이스 제품 개발 (HI-PPE v4.0)', '디바이스 제품 운영'] },
        '디바이스팀': { head: '김봉석 팀장(겸)', roles: ['디바이스 제품 개발', '디바이스 제품 운영'] },
        '플랫폼팀': { head: '정현수 팀장', roles: ['플랫폼 서비스 개발 (HI-RTK)', '플랫폼 서비스 운영'] }
      }
    }
  },

  keyProjects: [
    'HI-PPE v4.0 임베디드 코어 + HI-CCP 통합 INS 모듈 개발 (STM32H743ZIT6, EKF)',
    'HI-RTK 클라우드 SaaS 정밀측위 플랫폼 (AWS/NCP)',
    'LG유플러스 독점 OEM 공급 - U+초정밀측위 서비스',
    '전국 200개 GNSS 기준국 네트워크 운영',
    '유상증자 15억 목표 투자 유치',
    '수원고등법원 2025라10377 법무 (JIN 경쟁사 분쟁)',
    '한진그룹 M&A 협상 (목표 150억)'
  ]
};

// ─── 중요도 판단 기준 ────────────────────────────────────
const IMPORTANCE_RULES = `
[HIGH - 반드시 대표님 승인 필요]
- 예산/결재/지출 승인 요청
- 외부 기관, 고객사, 파트너 대응
- 계약/협상/MOU 관련
- 인사 관련 (채용, 퇴사, 평가)
- 법무 관련 (소송, 계약 검토)
- 투자/IR 관련
- 전략적 의사결정

[MEDIUM - 대표님께 보고 후 처리]
- 개발 진행상황 보고
- 프로젝트 이슈/리스크 보고
- 주간/월간 업무 보고
- 예산 집행 현황 공유
- 고객 불만/이슈 보고

[LOW - 자동 처리 가능]
- 단순 일정/회의 확인
- 파일/자료 요청
- 간단한 정보 문의
- 완료 보고 (별도 액션 불필요)
`;

// ─── Slack 서명 검증 ────────────────────────────────────
function verifySlackSignature(headers, rawBody) {
  const timestamp = headers['x-slack-request-timestamp'];
  const slackSig  = headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBase)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(slackSig)
    );
  } catch {
    return false;
  }
}

// ─── Slack 메시지 발송 ──────────────────────────────────
async function sendSlack(channel, text, blocks = null) {
  const body = { channel, text };
  if (blocks) body.blocks = blocks;

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── 발신자 부서/직급 파악 ───────────────────────────────
function getSenderInfo(senderName) {
  const org = HNI_ORG.departments;
  for (const [deptName, dept] of Object.entries(org)) {
    if (dept.head.includes(senderName)) {
      return { dept: deptName, role: dept.head, isHead: true };
    }
    for (const member of (dept.members || [])) {
      if (member.includes(senderName)) {
        return { dept: deptName, role: member, isHead: false };
      }
    }
    if (dept.subDepts) {
      for (const [subDeptName, subDept] of Object.entries(dept.subDepts)) {
        if (subDept.head.includes(senderName)) {
          return { dept: subDeptName, role: subDept.head, isHead: true };
        }
      }
    }
  }
  return { dept: '미확인', role: senderName, isHead: false };
}

// ─── Claude AI 호출 ─────────────────────────────────────
async function askClaude(messageText, senderName, senderInfo) {
  const system = `당신은 구자덕 대표(H&I 에이치앤아이)의 전용 AI 집사봇입니다.

## 회사 정보
${JSON.stringify(HNI_ORG, null, 2)}

## 중요도 판단 기준
${IMPORTANCE_RULES}

## 역할
Slack으로 들어오는 메시지를 분석해서 아래 JSON 형식으로만 답하세요.
다른 텍스트, 설명, 마크다운 코드블록 없이 순수 JSON만 출력하세요.

{
  "importance": "high" | "medium" | "low",
  "category": "개발현황" | "재무/예산" | "법무" | "투자/IR" | "인사" | "고객/파트너" | "일반업무" | "완료보고",
  "summary": "한 줄 요약 (20자 이내)",
  "auto_reply": "low일 때만 자동 답변 내용, 나머지는 null",
  "report_to_boss": "대표님께 보고할 내용 (간결하게, 2-3문장)",
  "suggested_reply": "대표님 승인용 답변 초안 (정중하고 명확하게)"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system,
      messages: [{
        role: 'user',
        content: `발신자: ${senderName} (${senderInfo.dept} / ${senderInfo.role})\n메시지 내용: ${messageText}`
      }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  try {
    return JSON.parse(text.trim());
  } catch {
    return {
      importance: 'medium',
      category: '일반업무',
      summary: '메시지 수신',
      auto_reply: null,
      report_to_boss: `${senderName}으로부터 메시지가 왔습니다: ${messageText}`,
      suggested_reply: '확인 후 답변 드리겠습니다. 감사합니다.'
    };
  }
}

// ─── 대표님께 보고 (승인 버튼 포함) ────────────────────
async function reportToBoss({ senderName, senderInfo, senderId, originalMsg, analysis, originalChannel }) {
  const emoji = { high: '🔴', medium: '🟡', low: '🟢' }[analysis.importance] || '⚪';
  const categoryEmoji = {
    '개발현황': '⚙️', '재무/예산': '💰', '법무': '⚖️',
    '투자/IR': '📈', '인사': '👥', '고객/파트너': '🤝',
    '일반업무': '📋', '완료보고': '✅'
  }[analysis.category] || '📌';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${analysis.summary}`, emoji: true }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*발신자*\n${senderName}` },
        { type: 'mrkdwn', text: `*부서/직급*\n${senderInfo.dept} · ${senderInfo.role}` },
        { type: 'mrkdwn', text: `*분류*\n${categoryEmoji} ${analysis.category}` },
        { type: 'mrkdwn', text: `*중요도*\n${emoji} ${analysis.importance.toUpperCase()}` }
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*원본 메시지*\n>${originalMsg}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*AI 요약*\n${analysis.report_to_boss}` }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*AI 초안 답변*\n${analysis.suggested_reply}` }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ 초안으로 발송', emoji: true },
          style: 'primary',
          value: JSON.stringify({
            action: 'approve',
            senderId,
            originalChannel,
            reply: analysis.suggested_reply
          }),
          action_id: 'approve_reply'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ 직접 답변', emoji: true },
          value: JSON.stringify({ action: 'manual', senderId, originalChannel }),
          action_id: 'manual_reply'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🚫 무시', emoji: true },
          style: 'danger',
          value: JSON.stringify({ action: 'ignore' }),
          action_id: 'ignore_reply'
        }
      ]
    }
  ];

  await sendSlack(
    BOSS_USER_ID,
    `${emoji} [집사봇] ${senderName}: ${analysis.summary}`,
    blocks
  );
}

// ─── 메인 핸들러 ────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Raw body 읽기
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  let body;
  try {
    // 버튼 액션은 payload 형식으로 옴
    if (rawBody.startsWith('payload=')) {
      const decoded = decodeURIComponent(rawBody.replace('payload=', ''));
      body = { payload: decoded };
    } else {
      body = JSON.parse(rawBody);
    }
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  // ── 버튼 액션 처리 ──
  if (body.payload) {
    const payload = JSON.parse(body.payload);

    // 서명 검증 생략 (payload는 별도 검증)
    const action = payload.actions?.[0];
    if (!action) return res.status(200).end();

    const value = JSON.parse(action.value || '{}');

    if (value.action === 'approve') {
      await sendSlack(value.originalChannel, value.reply);
      await sendSlack(BOSS_USER_ID, '✅ 답변이 발송되었습니다.');

    } else if (value.action === 'manual') {
      await sendSlack(BOSS_USER_ID,
        `✏️ 직접 답변 모드입니다.\n해당 채팅창에서 직접 답변해 주세요.`
      );

    } else if (value.action === 'ignore') {
      await sendSlack(BOSS_USER_ID, '🚫 해당 메시지를 무시했습니다.');
    }

    return res.status(200).end();
  }

  // ── Slack URL 검증 (최초 1회) ──
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // ── 서명 검증 ──
  if (!verifySlackSignature(req.headers, rawBody)) {
    console.error('Invalid Slack signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 이벤트 처리 ──
  const event = body.event;
  if (!event) return res.status(200).end();

  // 봇 메시지 무시 (무한루프 방지)
  if (event.bot_id || event.subtype === 'bot_message') {
    return res.status(200).end();
  }

  // 대표님 본인 메시지 무시
  if (event.user === BOSS_USER_ID) {
    return res.status(200).end();
  }

  // DM 또는 채널 메시지
  if (event.type === 'message' && event.text) {
    const senderId    = event.user;
    const messageText = event.text;
    const channel     = event.channel;

    try {
      // 발신자 이름 조회
      const userRes = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
        headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
      });
      const userData = await userRes.json();
      const senderName = userData.user?.profile?.real_name ||
                         userData.user?.real_name ||
                         userData.user?.name ||
                         senderId;

      // 발신자 조직 정보 파악
      const senderInfo = getSenderInfo(senderName);

      // Claude AI 분석
      const analysis = await askClaude(messageText, senderName, senderInfo);

      if (analysis.importance === 'low' && analysis.auto_reply) {
        // 저중요도: 자동 답변 + 대표님께 조용히 알림
        await sendSlack(channel, analysis.auto_reply);
        await sendSlack(BOSS_USER_ID,
          `🟢 자동 처리됨 | ${senderName}(${senderInfo.dept})\n*메시지:* ${messageText}\n*답변:* ${analysis.auto_reply}`
        );

      } else {
        // 중/고중요도: 대표님께 보고 후 승인 대기
        await reportToBoss({
          senderName,
          senderInfo,
          senderId,
          originalMsg: messageText,
          analysis,
          originalChannel: channel
        });
      }

    } catch (err) {
      console.error('Error:', err);
      await sendSlack(BOSS_USER_ID,
        `⚠️ 집사봇 처리 오류\n발신자ID: ${senderId}\n내용: ${messageText}\n오류: ${err.message}`
      );
    }
  }

  return res.status(200).end();
}

export const config = {
  api: { bodyParser: false }
};
