import crypto from 'crypto';

// ─── [1] 데이터 및 지식 베이스 ──────────────────────────────────
const HNI = {
  members: {
    '이종혁': { id: 'U02M86NGGM7', dept: '제품본부', role: '본부장' },
    '김대수': { id: 'U03M1SGS352', dept: '경영본부', role: '본부장' },
    '김인구': { id: 'U02M755LQHM', dept: '서비스지원팀', role: '팀장' },
    '김봉석': { id: null, dept: '기술연구소', role: '소장' },
    '김찬영': { id: null, dept: '기술연구소', role: '연구원' },
    '이지민': { id: null, dept: '상품관리팀', role: '팀장' },
    '정현수': { id: null, dept: '플랫폼팀', role: '팀장' },
  },
  knowledge: {
    tech: "GNSS/RTK 초정밀 측위(cm급), HI-PPE 임베디드 제어, AI라이브 플랫폼, AI 엣지 비전 기술",
    business: "LG유플러스 독점 파트너, 전국 200개 GNSS 기준국 운영, 자율주행 및 드론 정밀 항법 지원",
    vision: "국내 1위 초정밀 측위 플랫폼 기업 (H&I)",
    
    // 💡 구대표님, 실제 채널 ID가 적용되었습니다.
    management_channels: {
      finance: { name: "cmm-cxo", id: "C02M8BMJZG9" }, 
      sales: { name: "cmm-영업지원", id: "C06DRAHHAQZ" }
    }
  }
};

const GEMINI_TOOLS = [{
  function_declarations: [
    {
      name: 'send_message',
      description: '특정 직원에게 슬랙 메시지를 즉시 보냅니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '메시지를 받을 직원 이름 (성함만)' },
          message: { type: 'STRING', description: '전달할 내용' }
        },
        required: ['name', 'message']
      }
    },
    {
      name: 'report_management_status',
      description: '재무(#cmm-cxo), 영업(#cmm-영업지원) 채널의 최신 이력을 훑어서 보고합니다.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['finance', 'sales'], description: '보고 분야 (finance:재무, sales:영업)' },
          query: { type: 'STRING', description: '요약 시 집중할 키워드' }
        },
        required: ['category']
      }
    }
  ]
}];

// ─── [2] 유틸리티 및 보안 ──────────────────────────────────────

function verifySlackRequest(req, rawBody, signingSecret) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  const hmac = crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return `v0=${hmac}` === signature;
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  const delays = [1500, 3000, 7000]; 
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 18000); 
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (response.status === 429 && i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delays[i]));
        continue;
      }
      return response;
    } catch (e) {
      clearTimeout(id);
      if (i === maxRetries) throw e;
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
}

async function slackApi(endpoint, body, token) {
  const isRead = endpoint.includes('.list') || endpoint.includes('.info') || endpoint.includes('.history') || endpoint.includes('search.');
  const method = isRead ? 'GET' : 'POST';
  let url = `https://slack.com/api/${endpoint}`;
  let options = { method, headers: { 'Authorization': `Bearer ${token}` } };
  if (method === 'GET' && body) {
    const params = new URLSearchParams(body).toString();
    url += (params ? `?${params}` : '');
  } else if (method === 'POST') {
    options.headers['Content-Type'] = 'application/json; charset=utf-8';
    options.body = JSON.stringify(body);
  }
  const r = await fetchWithRetry(url, options);
  return await r.json();
}

async function findUserIdByName(name, token) {
  const res = await slackApi('users.list', { limit: 1000 }, token); 
  if (!res.ok) return null;
  const found = res.members.find(m => m.profile?.real_name?.includes(name) || m.real_name?.includes(name));
  return found ? found.id : null;
}

// ─── [3] handleBoss: 대표님용 (강력한 경영 보고 포함) ───────────────

async function handleBoss(text, channel, env) {
  console.log(`[대표님 지시 수신] ${text}`);
  const systemPrompt = `당신은 주식회사 에이치앤아이(H&I) 구대표님의 전담 비서 '구대표집사봇'입니다. 
  1. 경영현황 질문 시 다음 채널을 타격하세요:
     - 재무현황(#cmm-cxo): category='finance'
     - 영업현황(#cmm-영업지원): category='sales'
  2. 정보를 가져온 후에는 가독성 있게 요약하여 보고하세요.
  3. 모든 답변은 대표님께 결론부터 정중하고 명확하게 말씀드리세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_KEY}`;

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text }] }],
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: GEMINI_TOOLS
      })
    });
    
    const data = await response.json();
    if (data.error && data.error.code === 429) {
      return await slackApi('chat.postMessage', { channel, text: "⏳ 구대표님, 죄송합니다. 현재 엔진 사용량이 일시적으로 소진되었습니다. 1~2분 후 다시 시도해 주세요." }, env.BOT_TOKEN);
    }

    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) await slackApi('chat.postMessage', { channel, text: part.text }, env.BOT_TOKEN);
      
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        
        if (name === 'send_message') {
          let targetId = HNI.members[args.name]?.id || await findUserIdByName(args.name, env.BOT_TOKEN);
          if (targetId) {
            await slackApi('chat.postMessage', { channel: targetId, text: args.message }, env.BOT_TOKEN);
            await slackApi('chat.postMessage', { channel, text: `✅ 대표님, ${args.name}님께 메시지를 전달했습니다:\n> ${args.message}` }, env.BOT_TOKEN);
          }
        }
        
        if (name === 'report_management_status') {
          const targetChannel = HNI.knowledge.management_channels[args.category];
          console.log(`[경영 정보 조회 시작] 채널: ${targetChannel.name}(ID:${targetChannel.id})`);
          
          const historyRes = await slackApi('conversations.history', { channel: targetChannel.id, limit: 15 }, env.BOT_TOKEN);
          
          if (historyRes.ok && historyRes.messages.length > 0) {
            const context = historyRes.messages.reverse().map(m => `[발신:${m.user}] ${m.text}`).join('\n\n');
            const summaryRes = await fetchWithRetry(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: text }] }, { role: 'model', parts: [part] }, { role: 'user', parts: [{ text: `채널(#${targetChannel.name})의 최근 대화 이력입니다:\n${context}\n\n이 내용을 분석하여 대표님이 원하시는 경영현황 요약 보고서를 작성하세요.` }] }]
              })
            });
            const sData = await summaryRes.json();
            const sReply = sData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (sReply) await slackApi('chat.postMessage', { channel, text: sReply }, env.BOT_TOKEN);
          } else {
            const errorMsg = historyRes.error === 'not_in_channel' ? `봇이 #${targetChannel.name} 채널에 초대되지 않았습니다. /invite @구대표집사봇 명령어로 초대해 주세요.` : `정보를 가져오지 못했습니다 (${historyRes.error}). 채널 권한을 확인해 주세요.`;
            await slackApi('chat.postMessage', { channel, text: `❓ ${errorMsg}` }, env.BOT_TOKEN);
          }
        }
      }
    }
  } catch (e) {
    await slackApi('chat.postMessage', { channel, text: `⚠️ 응답 지연 발생. 잠시 후 다시 지시해 주세요.` }, env.BOT_TOKEN);
