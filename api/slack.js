export default async function handler(req, res) {

  // POST만 허용
  if (req.method !== 'POST') return res.status(405).end();

  // body 읽기
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // body 파싱
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

  // 이벤트 꺼내기
  const event = body.event;

  // 이벤트 없으면 종료
  if (!event) return res.status(200).end();

  // 봇 메시지 무시
  if (event.subtype === 'bot_message') return res.status(200).end();

  // 텍스트 없으면 종료
  if (!event.text) return res.status(200).end();

  const senderId = event.user;
  const text     = event.text.trim();
  const channel  = event.channel;

  const BOT_TOKEN   = process.env.SLACK_BOT_TOKEN;
  const BOSS_ID     = process.env.BOSS_USER_ID;
  const CLAUDE_KEY  = process.env.ANTHROPIC_API_KEY;

  // 대표님이 보낸 메시지면 AI와 직접 대화
  if (senderId === BOSS_ID) {
    try {
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
          system: '당신은 구자덕 대표(H&I 에이치앤아이)의 AI 집사봇입니다. 한국어로 간결하게 답하세요.',
          messages: [{ role: 'user', content: text }]
        })
      });
      const d = await r.json();
      const reply = d.content?.[0]?.text || '처리 중 오류가 발생했습니다.';
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, text: reply })
      });
    } catch(e) {
      console.error('boss chat error:', e.message);
    }
    return res.status(200).end();
  }

  // 직원 메시지 처리
  try {
    // 발신자 이름 조회
    const ur = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
      headers: { 'Authorization': `Bearer ${BOT_TOKEN}` }
    });
    const ud = await ur.json();
    const name = ud.user?.profile?.real_name || ud.user?.name || senderId;

    // Claude AI 분석
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: `당신은 구자덕 대표(H&I)의 AI 집사봇입니다.
직원 메시지를 분석해서 순수 JSON만 출력하세요.
{"importance":"high|medium|low","summary":"한줄요약","report":"대표님보고내용","draft":"답변초안"}
importance: high(결재/계약/인사), medium(업무보고), low(단순문의)`,
        messages: [{ role: 'user', content: `발신자: ${name}\n내용: ${text}` }]
      })
    });
    const d = await r.json();
    let analysis;
    try {
      analysis = JSON.parse(d.content?.[0]?.text?.trim() || '{}');
    } catch {
      analysis = { importance: 'medium', summary: '메시지 수신', report: `${name}: ${text}`, draft: '확인 후 답변 드리겠습니다.' };
    }

    const emoji = { high: '🔴', medium: '🟡', low: '🟢' }[analysis.importance] || '⚪';

    // 대표님께 보고 (승인 버튼 포함)
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: BOSS_ID,
        text: `${emoji} [집사봇] ${name}: ${analysis.summary}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `${emoji} ${analysis.summary}`, emoji: true } },
          { type: 'section', fields: [
            { type: 'mrkdwn', text: `*발신자*\n${name}` },
            { type: 'mrkdwn', text: `*중요도*\n${emoji} ${analysis.importance}` }
          ]},
          { type: 'section', text: { type: 'mrkdwn', text: `*원본*\n> ${text}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*AI 요약*\n${analysis.report}` } },
          { type: 'divider' },
          { type: 'section', text: { type: 'mrkdwn', text: `*AI 초안 답변*\n${analysis.draft}` } },
          { type: 'actions', elements: [
            { type: 'button', style: 'primary', action_id: 'approve',
              text: { type: 'plain_text', text: '✅ 초안으로 발송', emoji: true },
              value: JSON.stringify({ action: 'approve', channel, reply: analysis.draft }) },
            { type: 'button', action_id: 'ignore', style: 'danger',
              text: { type: 'plain_text', text: '🚫 무시', emoji: true },
              value: JSON.stringify({ action: 'ignore' }) }
          ]}
        ]
      })
    });

  } catch(e) {
    console.error('worker handler error:', e.message);
    // 오류 시 원문 그대로 대표님께 전달
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: BOSS_ID, text: `⚠️ 처리 오류\n발신자: ${senderId}\n내용: ${text}\n오류: ${e.message}` })
    });
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
