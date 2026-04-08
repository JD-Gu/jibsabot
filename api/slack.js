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

  // URL 검증
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  const event = body.event;
  if (!event || !event.text || event.bot_id) return res.status(200).end();

  // 대표님께 바로 전달
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      channel: process.env.BOSS_USER_ID,
      text: `📨 테스트 수신\n발신자ID: ${event.user}\n내용: ${event.text}`
    })
  });

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
