import crypto from 'crypto';

// ─── 환경변수 ───────────────────────────────────────────
const SLACK_BOT_TOKEN    = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const BOSS_USER_ID       = process.env.BOSS_USER_ID; // 대표님 Slack User ID

// ─── Slack 서명 검증 (보안) ─────────────────────────────
function verifySlackSignature(req, rawBody) {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSig  = req.headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false; // 5분 이상 된 요청 거부

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', SLACK_SIGNING_SECRET);
  const mySignature = 'v0=' + hmac.update(sigBase).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(slackSig));
}

// ─── Slack 메시지 발송 ──────────────────────────────────
async function sendSlack(channel, text, blocks = null) {
  const body = { channel, text };
  if (blocks) body.blocks = blocks;

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// ─── Claude AI 호출 ─────────────────────────────────────
async function askClaude(userMessage, senderName) {
  const system = `당신은 구자덕 대표(H&I 에이치앤아이)의 전용 AI 집사봇입니다.

회사 정보:
- GNSS/RTK 초정밀 측위 전문 중소기업
- LG유플러스 독점 OEM 공급 (U+초정밀측위)
- 전국 200개 GNSS 기준국 운영

주요 인물:
- 이종혁: 제품본부장 (개발/연구 총괄)
- 김봉석: 연구소장 (HI-PPE 개발)
- 김찬영: 연구원

주요 현안:
- HI-PPE v4.0 임베디드 코어 개발 중
- 유상증자 15억 목표 진행 중
- 수원고등법원 2025라10377 법무 진행 중
- 한진그룹 M&A 협상 (목표 150억)

당신의 역할:
Slack으로 들어오는 메시지를 분석해서 아래 JSON 형식으로만 답하세요.

{
  "importance": "high" | "medium" | "low",
  "auto_reply": "자동으로 답변 가능하면 답변 내용, 불가능하면 null",
  "report_to_boss": "대표님께 보고할 내용 (간결하게)",
  "suggested_reply": "대표님 승인용 답변 초안"
}

판단 기준:
- high (대표님 승인 필요): 예산/결재, 외부 기관 대응, 중요 의사결정, 계약/협상
- medium (대표님 보고 후 자동처리): 일반 업무 보고, 진행상황 공유
- low (자동처리): 단순 질문, 일정 확인, 간단한 요청

JSON만 출력하고 다른 텍스트는 절대 출력하지 마세요.`;

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
        content: `발신자: ${senderName}\n메시지: ${userMessage}`
      }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  try {
    return JSON.parse(text);
  } catch {
    return {
      importance: 'medium',
      auto_reply: null,
      report_to_boss: `[파싱 오류] ${senderName}: ${userMessage}`,
      suggested_reply: '확인 후 답변 드리겠습니다.'
    };
  }
}

// ─── 대표님께 보고 (승인 버튼 포함) ────────────────────
async function reportToBoss({ senderName, senderId, originalMsg, analysis, originalChannel }) {
  const importanceEmoji = {
    high:   '🔴',
    medium: '🟡',
    low:    '🟢',
  }[analysis.importance] || '⚪';

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${importanceEmoji} *새 메시지 보고*\n*발신자:* ${senderName}\n*내용:* ${originalMsg}\n\n*AI 요약:* ${analysis.report_to_boss}`
      }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*AI 초안 답변:*\n${analysis.suggested_reply}`
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ 이 내용으로 발송', emoji: true },
          style: 'primary',
          value: JSON.stringify({ action: 'approve', senderId, originalChannel, reply: analysis.suggested_reply }),
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

  await sendSlack(BOSS_USER_ID, `${importanceEmoji} 새 메시지: ${senderName}`, blocks);
}

// ─── 메인 핸들러 ────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Raw body 읽기 (서명 검증용)
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const body = JSON.parse(rawBody);

  // Slack URL 검증 (최초 1회)
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // 서명 검증
  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 이벤트 처리
  const event = body.event;
  if (!event) return res.status(200).end();

  // 봇 자신의 메시지 무시 (무한루프 방지)
  if (event.bot_id || event.subtype === 'bot_message') {
    return res.status(200).end();
  }

  // DM 또는 채널 메시지 처리
  if (event.type === 'message' && event.text) {
    const senderId   = event.user;
    const messageText = event.text;
    const channel    = event.channel;

    // 대표님 본인 메시지 무시
    if (senderId === BOSS_USER_ID) {
      return res.status(200).end();
    }

    try {
      // 발신자 이름 조회
      const userRes = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
        headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
      });
      const userData = await userRes.json();
      const senderName = userData.user?.real_name || userData.user?.name || senderId;

      // Claude AI 분석
      const analysis = await askClaude(messageText, senderName);

      if (analysis.importance === 'low' && analysis.auto_reply) {
        // 저중요도: 자동 답변
        await sendSlack(channel, analysis.auto_reply);

        // 대표님께 처리 완료 조용히 알림
        await sendSlack(BOSS_USER_ID,
          `🟢 자동 처리 완료\n*${senderName}:* ${messageText}\n*답변:* ${analysis.auto_reply}`
        );
      } else {
        // 중/고중요도: 대표님께 보고 후 승인 대기
        await reportToBoss({
          senderName,
          senderId,
          originalMsg: messageText,
          analysis,
          originalChannel: channel
        });
      }
    } catch (err) {
      console.error('Error processing message:', err);
      // 오류 시 대표님께 원본 메시지 전달
      await sendSlack(BOSS_USER_ID,
        `⚠️ 처리 중 오류 발생\n원본 메시지를 확인해주세요.\n발신자ID: ${senderId}\n내용: ${messageText}`
      );
    }
  }

  // 버튼 액션 처리 (승인/거절)
  if (body.payload) {
    const payload = JSON.parse(body.payload);
    const action  = payload.actions?.[0];
    const value   = JSON.parse(action?.value || '{}');

    if (value.action === 'approve') {
      // 승인: 초안 답변 발송
      await sendSlack(value.originalChannel, value.reply);
      await sendSlack(BOSS_USER_ID, '✅ 답변이 발송되었습니다.');

    } else if (value.action === 'manual') {
      // 직접 답변 안내
      await sendSlack(BOSS_USER_ID,
        `✏️ 직접 답변하시려면:\n<slack://channel?team=T02LVH15KJN&id=${value.originalChannel}|채널 열기>`
      );

    } else if (value.action === 'ignore') {
      await sendSlack(BOSS_USER_ID, '🚫 메시지를 무시했습니다.');
    }
  }

  return res.status(200).end();
}

export const config = {
  api: { bodyParser: false }
};
