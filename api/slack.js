export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

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
  if (event.bot_id) return res.status(200).end();
  if (event.subtype === 'bot_message') return res.status(200).end();
  if (!event.user) return res.status(200).end();
  if (!event.text) return res.status(200).end();

  const senderId = event.user;
  const text     = event.text.trim();
  const channel  = event.channel;

  const BOT_TOKEN  = process.env.SLACK_BOT_TOKEN;
  const BOSS_ID    = process.env.BOSS_USER_ID;
  const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

  // Slack 메시지 발송 헬퍼
  async function slack(ch, txt, blocks) {
    const fallback = txt || '집사봇 알림';
    const b = blocks
      ? { channel: ch, text: fallback, blocks }
      : { channel: ch, text: fallback };
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(b)
    });
    const d = await r.json();
    if (!d.ok) console.error('slack error:', d.error);
    return d;
  }

  // Claude API 호출 헬퍼
  async function claude(system, userMsg) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    const d = await r.json();
    return d.content?.[0]?.text || '';
  }

  // ── 대표님이 직접 대화하는 경우 ──
  if (senderId === BOSS_ID) {
    try {
      const reply = await claude(
        `당신은 구자덕 대표(H&I 에이치앤아이)의 AI 집사봇입니다.
회사: GNSS/RTK 초정밀 측위 전문기업, LG유플러스 파트너
주요 인물: 이종혁(제품본부장), 김봉석(기술연구소장), 김인구(서비스지원팀장)
친절하고 간결하게 한국어로 답하세요.`,
        text
      );
      await slack(channel, reply || '처리 완료');
    } catch(e) {
      console.error('boss error:', e.message);
      await slack(channel, `오류: ${e.message}`);
    }
    return res.status(200).end();
  }

  // ── 직원 메시지 처리 ──
  try {
    // 발신자 이름 조회
    const ur = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
      headers: { 'Authorization': `Bearer ${BOT_TOKEN}` }
    });
    const ud   = await ur.json();
    const name = ud.user?.profile?.real_name || ud.user?.name || senderId;

    // Claude AI 분석
    const raw = await claude(
      `당신은 구자덕 대표(H&I)의 AI 집사봇입니다.
직원 메시지를 분석해서 아래 형식의 JSON만 출력하세요. 코드블록 없이 순수 JSON만.
{"importance":"medium","summary":"한줄요약","report":"대표님께보고할내용","draft":"답변초안"}
importance: high(결재/계약/인사/예산), medium(업무보고/이슈), low(단순문의/완료보고)
summary는 반드시 10자 이내로 작성하세요.`,
      `발신자: ${name}\n내용: ${text}`
    );

    // JSON 안전 추출
    let a = {};
    try {
      const match = raw.match(/\{[\s\S]*?\}/);
      a = JSON.parse(match ? match[0] : '{}');
    } catch {
      a = {};
    }

    // 기본값 보장 (undefined 방지)
    const importance = String(a.importance || 'medium');
    const summary    = String(a.summary    || '메시지 수신');
    const report     = String(a.report     || `${name}: ${text}`);
    const draft      = String(a.draft      || '확인 후 답변 드리겠습니다.');
    const emoji      = { high: '🔴', medium: '🟡', low: '🟢' }[importance] || '⚪';

    const headerText = `${emoji} ${summary}`;
    const fallbackText = `${emoji} [집사봇] ${name}: ${summary}`;

    // 대표님께 보고 (승인 버튼 포함)
    await slack(BOSS_ID, fallbackText, [
      {
        type: 'header',
        text: { type: 'plain_text', text: headerText, emoji: true }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*발신자*\n${name}` },
          { type: 'mrkdwn', text: `*중요도*\n${emoji} ${importance}` }
        ]
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*원본 메시지*\n> ${text}` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*AI 요약*\n${report}` }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*AI 초안 답변*\n${draft}` }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button', style: 'primary', action_id: 'approve',
            text: { type: 'plain_text', text: '✅ 초안으로 발송', emoji: true },
            value: JSON.stringify({ action: 'approve', channel, reply: draft })
          },
          {
            type: 'button', style: 'danger', action_id: 'ignore',
            text: { type: 'plain_text', text: '🚫 무시', emoji: true },
            value: JSON.stringify({ action: 'ignore' })
          }
        ]
      }
    ]);

  } catch(e) {
    console.error('worker error:', e.message);
    await slack(BOSS_ID, `⚠️ 오류\n발신자: ${senderId}\n내용: ${text}\n오류: ${e.message}`);
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
