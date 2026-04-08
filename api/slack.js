import crypto from 'crypto';

const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN      || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY    || '';
const BOSS_USER_ID         = process.env.BOSS_USER_ID         || '';

// H&I 조직 정보
const ORG = {
  departments: {
    '경영본부':    { head: '김대수 본부장',  members: [] },
    '제품본부':    { head: '이종혁 본부장',  members: [] },
    '상품관리팀':  { head: '이지민 팀장',   members: ['김민영 프로', '김다영 프로'] },
    '서비스지원팀':{ head: '김인구 팀장',   members: ['김훈지 프로'] },
    '기술연구소':  { head: '김봉석 소장',   members: ['김찬영 프로', '이창현 프로'] },
    '플랫폼팀':    { head: '정현수 팀장',   members: ['지우현 프로', '박인영 프로', '정명휘 프로'] }
  },
  confidential: ['M&A', '한진그룹', '유상증자', '투자 협상', '소송', '법무', '급여', '인사평가']
};

// 상담 세션 (서버 메모리)
const sessions = new Map();

// ─── Slack 서명 검증 ────────────────────────────────────
function verify(headers, rawBody) {
  return true; // 임시 우회 - 테스트용
  try {
    const ts  = headers['x-slack-request-timestamp'] || '';
    const sig = headers['x-slack-signature'] || '';
    if (!ts || !sig) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const computed = 'v0=' + crypto
      .createHmac('sha256', SLACK_SIGNING_SECRET)
      .update(`v0:${ts}:${rawBody}`, 'utf8')
      .digest('hex');
    return computed === sig;
  } catch (e) {
    console.error('verify error:', e.message);
    return false;
  }
}

// ─── Slack 메시지 발송 ──────────────────────────────────
async function send(channel, text, blocks) {
  const body = blocks ? { channel, text, blocks } : { channel, text };
  try {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!d.ok) console.error('Slack send error:', d.error);
    return d;
  } catch (e) {
    console.error('send error:', e.message);
  }
}

// ─── 발신자 부서 찾기 ────────────────────────────────────
function getDept(name) {
  for (const [dept, info] of Object.entries(ORG.departments)) {
    if (info.head?.includes(name)) return `${dept} · ${info.head}`;
    for (const m of (info.members || [])) {
      if (m.includes(name)) return `${dept} · ${m}`;
    }
  }
  return '미확인';
}

// ─── 상담 키워드 감지 ────────────────────────────────────
function isCounsel(text) {
  return ['고민', '힘들', '스트레스', '어려워', '걱정', '불안', '상담', '조언',
    '회사 어때', '회사 어떻게', '경영 현황', '우리 회사', '비전'].some(k => text.includes(k));
}

// ─── 비공개 키워드 감지 ──────────────────────────────────
function isSecret(text) {
  return ORG.confidential.some(k => text.includes(k));
}

// ─── Claude 업무 분석 ────────────────────────────────────
async function analyzeWork(text, name, dept) {
  const system = `당신은 구자덕 대표(H&I)의 AI 집사봇입니다.
반드시 순수 JSON만 출력하세요. 마크다운, 설명 없이.
형식:
{"importance":"medium","category":"일반업무","summary":"한줄요약","auto_reply":null,"report":"보고내용","draft":"답변초안"}
importance: high(결재/계약/인사/투자), medium(업무보고/이슈), low(단순문의/완료보고)
auto_reply: low일때만 답변문자열, 나머지는 null`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system,
        messages: [{ role: 'user', content: `발신자: ${name} (${dept})\n내용: ${text}` }]
      })
    });
    const d = await r.json();
    const raw = d.content?.[0]?.text?.trim() || '{}';
    return JSON.parse(raw);
  } catch (e) {
    console.error('analyzeWork error:', e.message);
    return {
      importance: 'medium', category: '일반업무', summary: '메시지 수신',
      auto_reply: null,
      report: `${name}으로부터 메시지가 왔습니다: ${text}`,
      draft: '확인 후 답변 드리겠습니다.'
    };
  }
}

// ─── Claude 상담 답변 ────────────────────────────────────
async function counselReply(text, name, dept, history) {
  const system = `당신은 H&I의 친근한 AI 상담사입니다.
회사: GNSS/RTK 초정밀 측위 전문기업, LG유플러스 파트너, 전국 200개 기준국 운영
원칙: 따뜻하게 공감, 업무/커리어/팀관계 상담, 민감정보(급여/M&A 등)는 "확인이 필요한 사항"으로 안내
답변: 한국어, 친근하게, 200자 이내, 발신자: ${name} (${dept})`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system,
        messages: [...history, { role: 'user', content: text }]
      })
    });
    const d = await r.json();
    return d.content?.[0]?.text || '죄송합니다, 잠시 후 다시 시도해주세요.';
  } catch (e) {
    console.error('counselReply error:', e.message);
    return '죄송합니다, 일시적인 오류가 발생했습니다.';
  }
}

// ─── 상담 요약 ───────────────────────────────────────────
async function summarize(session) {
  const txt = session.history
    .map(m => `${m.role === 'user' ? session.name : '봇'}: ${m.content}`)
    .join('\n');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: '직원 상담 내용을 대표님께 3-4줄로 요약. 핵심 고민, 상담 내용, 조치 필요 여부 포함. 민감 개인정보 제외.',
        messages: [{ role: 'user', content: txt }]
      })
    });
    const d = await r.json();
    return d.content?.[0]?.text || '요약 불가';
  } catch (e) {
    return '요약 중 오류 발생';
  }
}

// ─── 대표님께 업무 보고 ──────────────────────────────────
async function reportWork(name, dept, senderId, text, a, channel) {
  const e = { high: '🔴', medium: '🟡', low: '🟢' }[a.importance] || '⚪';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${e} ${a.summary}`, emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*발신자*\n${name}` },
        { type: 'mrkdwn', text: `*부서*\n${dept}` },
        { type: 'mrkdwn', text: `*분류*\n${a.category}` },
        { type: 'mrkdwn', text: `*중요도*\n${e} ${a.importance}` }
      ]
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*원본 메시지*\n> ${text}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 요약*\n${a.report}` } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*AI 초안 답변*\n${a.draft}` } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button', style: 'primary', action_id: 'approve',
          text: { type: 'plain_text', text: '✅ 초안으로 발송', emoji: true },
          value: JSON.stringify({ action: 'approve', senderId, channel, reply: a.draft })
        },
        {
          type: 'button', action_id: 'manual',
          text: { type: 'plain_text', text: '✏️ 직접 답변', emoji: true },
          value: JSON.stringify({ action: 'manual', senderId, channel })
        },
        {
          type: 'button', style: 'danger', action_id: 'ignore',
          text: { type: 'plain_text', text: '🚫 무시', emoji: true },
          value: JSON.stringify({ action: 'ignore' })
        }
      ]
    }
  ];
  await send(BOSS_USER_ID, `${e} [집사봇] ${name}: ${a.summary}`, blocks);
}

// ─── 대표님께 상담 요약 보고 ─────────────────────────────
async function reportCounsel(session, summary) {
  const elapsed = Math.round((Date.now() - session.start) / 60000);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '💬 직원 상담 완료 보고', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*직원*\n${session.name}` },
        { type: 'mrkdwn', text: `*부서*\n${session.dept}` },
        { type: 'mrkdwn', text: `*대화횟수*\n${Math.ceil(session.history.length / 2)}회` },
        { type: 'mrkdwn', text: `*상담시간*\n약 ${elapsed}분` }
      ]
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*상담 요약*\n${summary}` } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button', action_id: 'contact',
          text: { type: 'plain_text', text: '📞 직접 연락', emoji: true },
          value: JSON.stringify({ action: 'contact', userId: session.userId })
        },
        {
          type: 'button', style: 'primary', action_id: 'ack',
          text: { type: 'plain_text', text: '✅ 확인 완료', emoji: true },
          value: JSON.stringify({ action: 'ack' })
        }
      ]
    }
  ];
  await send(BOSS_USER_ID, `💬 [집사봇] ${session.name} 상담 완료`, blocks);
}

// ─── 메인 핸들러 ────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // raw body 읽기
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // payload (버튼 액션) 처리
  if (rawBody.startsWith('payload=')) {
    try {
      const payload = JSON.parse(decodeURIComponent(rawBody.slice(8)));
      const action  = payload.actions?.[0];
      const val     = JSON.parse(action?.value || '{}');

      if (val.action === 'approve') {
        await send(val.channel, val.reply);
        await send(BOSS_USER_ID, '✅ 답변이 발송되었습니다.');
      } else if (val.action === 'manual') {
        await send(BOSS_USER_ID, '✏️ 직접 답변 모드입니다. 해당 채팅창에서 직접 답변해 주세요.');
      } else if (val.action === 'ignore') {
        await send(BOSS_USER_ID, '🚫 해당 메시지를 무시했습니다.');
      } else if (val.action === 'contact') {
        await send(BOSS_USER_ID, `📞 <@${val.userId}>에게 직접 연락해주세요.`);
      } else if (val.action === 'ack') {
        await send(BOSS_USER_ID, '✅ 상담 보고를 확인하셨습니다.');
      }
    } catch (e) {
      console.error('payload error:', e.message);
    }
    return res.status(200).end();
  }

  // JSON 파싱
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    console.error('JSON parse error:', e.message);
    return res.status(400).end();
  }

  // URL 검증 (최초 1회)
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // 서명 검증
  if (!verify(req.headers, rawBody)) {
    console.error('Signature mismatch');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = body.event;
  if (!event) return res.status(200).end();

  // 봇/자기 메시지 무시
  if (event.bot_id || event.subtype === 'bot_message') return res.status(200).end();
  if (event.user === BOSS_USER_ID) return res.status(200).end();

  // 메시지 이벤트
  if (event.type === 'message' && event.text) {
    const senderId = event.user;
    const text     = event.text.trim();
    const channel  = event.channel;

    console.log(`Message from ${senderId}: ${text}`);

    try {
      // 발신자 이름 조회
      const ur = await fetch(`https://slack.com/api/users.info?user=${senderId}`, {
        headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
      });
      const ud   = await ur.json();
      const name = ud.user?.profile?.real_name || ud.user?.name || senderId;
      const dept = getDept(name);

      // 상담 세션 확인
      const inSession = sessions.has(senderId);
      const startNew  = isCounsel(text);

      if (inSession || startNew) {
        // 새 세션 시작
        if (!inSession) {
          sessions.set(senderId, {
            userId: senderId, name, dept,
            history: [], start: Date.now()
          });
          await send(channel,
            `안녕하세요 ${name}님 😊\n집사봇이 말씀 들을게요. 편하게 이야기해 주세요.\n_(대화 내용은 요약되어 대표님께 보고됩니다)_`
          );
        }

        const session = sessions.get(senderId);

        // 비공개 정보 차단
        if (isSecret(text)) {
          const reply = '해당 내용은 확인이 필요한 사항입니다. 대표님께 직접 문의해 주시면 더 정확한 답변을 드릴 수 있어요 😊';
          await send(channel, reply);
          session.history.push({ role: 'user', content: text });
          session.history.push({ role: 'assistant', content: reply });
          return res.status(200).end();
        }

        // 상담 답변
        const reply = await counselReply(text, name, dept, session.history);
        await send(channel, reply);
        session.history.push({ role: 'user', content: text });
        session.history.push({ role: 'assistant', content: reply });

        // 마무리 감지 or 10턴 이상 → 요약 보고
        const endWords = ['감사', '고마워', '알겠어', '됐어', '해결', '이제 됐'];
        if (endWords.some(k => text.includes(k)) || session.history.length >= 10) {
          const summary = await summarize(session);
          await reportCounsel(session, summary);
          sessions.delete(senderId);
        }

        return res.status(200).end();
      }

      // 일반 업무 메시지
      const analysis = await analyzeWork(text, name, dept);

      if (analysis.importance === 'low' && analysis.auto_reply) {
        await send(channel, analysis.auto_reply);
        await send(BOSS_USER_ID,
          `🟢 자동처리 | ${name}(${dept})\n*메시지:* ${text}\n*답변:* ${analysis.auto_reply}`
        );
      } else {
        await reportWork(name, dept, senderId, text, analysis, channel);
      }

    } catch (e) {
      console.error('handler error:', e.message);
      await send(BOSS_USER_ID,
        `⚠️ 처리 오류\n발신자: ${senderId}\n내용: ${text}\n오류: ${e.message}`
      );
    }
  }

  return res.status(200).end();
}

export const config = { api: { bodyParser: false } };
