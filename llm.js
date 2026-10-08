/* ===========================================================
   大模型接入（OpenAI 兼容接口），失败自动回退本地规则引擎
   =========================================================== */

/* 一次最多发几张图给大模型：图片按分辨率计费，8 张会让成本和延迟都不可控 */
const MAX_VISION_IMAGES = 4;

const LLM = {
  cfg: null,
  _visionDisabled: false,   // 接口实测不支持图片后置位，避免每次生成都白试一次

  load() {
    try { this.cfg = JSON.parse(localStorage.getItem('ai_ecom_cfg') || 'null'); }
    catch (e) { this.cfg = null; }
    if (!this.cfg) this.cfg = { enabled: false, base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat' };
    return this.cfg;
  },
  save(cfg) {
    this.cfg = Object.assign(this.cfg || {}, cfg);
    localStorage.setItem('ai_ecom_cfg', JSON.stringify(this.cfg));
  },
  ready() {
    return !!(this.cfg && this.cfg.enabled && this.cfg.key && this.cfg.model);
  },
  endpoint() {
    return (this.cfg.base || '').replace(/\/+$/, '') + '/chat/completions';
  },

  /* ---------- 组装提示词 ---------- */
  /* 支持视觉的接口才把图片带进提示词。
     DeepSeek 等纯文本模型会直接报 400，靠 generate() 里的降级兜住 */
  supportsVision() {
    if (this._visionDisabled) return false;
    if (this.cfg && this.cfg.vision === false) return false;         // 用户手动关掉了
    const base = ((this.cfg && this.cfg.base) || '').toLowerCase();
    if (base.includes('deepseek')) return false;                     // 官方接口无视觉模型
    return true;
  },

  /* OpenAI 兼容的多模态格式：user 消息的 content 变成 [{type:'text'},{type:'image_url'}] 数组 */
  buildMessages(input, withImages, historyBrief) {
    const sys = `你是一名资深电商短视频内容策略专家，服务过大量抖音/快手/视频号带货团队。
你的任务：根据商家填写的产品信息${withImages ? '和随附的产品图片' : ''}，产出一份可直接用于 AI 视频生成的短视频内容策略。
严格要求：只输出一个 JSON 对象，不要输出任何解释、不要使用 markdown 代码块。
所有文案使用简体中文，口语化、具体、可执行，禁止空话套话。`;

    const shots = withImages ? this.pickImages(input) : [];
    const imgNote = shots.length
      ? `\n【产品图片】已附 ${shots.length} 张产品图（主图 ${shots.filter(s => s.t === '主图').length} 张、详情页 ${shots.filter(s => s.t === '详情').length} 张）。\n请结合图片里真实看到的信息来写：外观、材质、包装、规格、适用人群、详情页里标注的卖点都要用上。\n看不清的地方不要臆造，用已知的文字信息为准。`
      : '';

    // 历史复盘结论：有就带上，让模型优先沿用已验证的组合而不是重新猜
    const historyNote = String(historyBrief || '')
      ? '\n' + String(historyBrief).trim() + '\n'
      : '';

    const user = `【产品信息】
品类：${input.category || '未填写'}
产品名称：${input.prodName || '（未填写，按品类给一个通用主体）'}
价格带：${input.price || '未选择'}
客单价：${input.aov || '未填写'}
当前主要卖点：${input.selling || '未填写'}
当前最大内容困境：${input.pain || '未选择'}
产品卖点详细描述：${input.detail || '未填写'}${imgNote}${historyNote}

【输出 JSON 结构（严格按此结构，字段不能少）】
{
  "summary": {
    "audience": "主攻人群，一句话说清是谁（含年龄段/身份）",
    "audienceWhy": "为什么主攻这个人群，60字内",
    "buyPoint": "核心买点，即用户愿意掏钱的理由，一句话",
    "scene": "核心场景，格式：场景类型｜具体场景",
    "sceneIns": "这个场景的核心洞察，60字内"
  },
  "dims": {
    "func": ["功能卖点3-4条，每条不超过25字"],
    "effect": ["效果卖点3-4条"],
    "emotion": ["情绪卖点3-4条"],
    "trust": ["信任卖点3-4条"],
    "diff": ["差异化卖点3-4条"]
  },
  "audiences": [
    {"name":"人群名，含年龄段与身份","tag":"主攻或次攻或观察","why":"推荐理由，60字内","scores":{"match":88,"pain":82,"ease":30,"pay":80,"size":70}}
  ],
  "scenes": [
    {"k":"日常场景","level":"高或中","tone":"暖调或冷调","why":"这一组场景为什么值得用，40字内",
     "items":[{"n":"具体场景名","ins":"核心洞察，60字内","use":"画面里该出现什么，30字内"}]}
  ],
  "buyPoints": [
    {"sell":"卖点（商家想说的）","buy":"买点（用户愿意掏钱的理由，口语化一句）",
     "proof":"这个买点需要什么证据才能立住，40字内","risk":"这条卖点最容易被怎么讲错或踩什么合规红线，50字内"}
  ],
  "matrix": [
    {"audience":"人群名","scene":"场景类型｜场景名","sellPoint":"对应卖点","buyPoint":"对应买点","priority":"优先测试或次轮测试或观察测试",
     "why":"为什么这组值得先做（结合人群匹配度、场景冲突强度、买点待验证程度），60字内",
     "kpi":["这条视频要盯的第一指标","第二指标"],
     "story":"【必填·最重要】一整段连续的故事型口播稿",
     "script":[{"t":"0-3s","stage":"钩子","l":"口播台词","v":"这一秒画面里有什么"}],
     "prompt":"视频生成提示词，多行文本"}
  ],
  "actions": [
    {"what":"本周要做的第1件事，40字内","how":"怎么判断做成了（盯哪两个数）","when":"什么时候做"}
  ],
  "dimGuide": {
    "func":  {"task":"这一维在内容里承担什么任务，40字内","how":["第1条卖点怎么讲","第2条","第3条","第4条"]},
    "effect":{"task":"任务说明，40字内","how":["怎么讲1","怎么讲2","怎么讲3","怎么讲4"]},
    "emotion":{"task":"任务说明，40字内","how":["怎么讲1","怎么讲2","怎么讲3","怎么讲4"]},
    "trust": {"task":"任务说明，40字内","how":["怎么讲1","怎么讲2","怎么讲3","怎么讲4"]},
    "diff":  {"task":"任务说明，40字内","how":["怎么讲1","怎么讲2","怎么讲3","怎么讲4"]}
  }
}

【硬性要求】
1. audiences 必须恰好 3 个，tag 依次为主攻、次攻、观察；scores 五维为 0-100 整数，ease 表示"短视频表达难度"，越低越好。
   另外每个人群还要给两个字段：
   - "notFor"：不要试图同时打动哪两类人，以及为什么（50字内）
   - "chain"：他的决策链路有多长（要看几次才敢买），以及内容该怎么配合（50字内）
2. scenes 至少 4 组，k 建议为：日常场景、新手翻车场景、对比场景、情绪场景；每组至少 1 个 items。
3. buyPoints 至少 5 条，buy 必须是用户视角的掏钱理由，不能是参数复述。
4. matrix 必须恰好 8 组，每组 script 必须 5 段，时间轴依次为 0-3s / 3-8s / 8-15s / 15-22s / 22-28s，stage 依次为 钩子 / 痛点 / 演示 / 证据 / 行动。
5. matrix 中每一组的 audience、scene、buyPoint 必须相互匹配，构成一个能拍的完整故事。
6. 全篇必须针对"当前最大内容困境"给出策略倾向${input.pain ? '（本次困境：' + input.pain + '）' : ''}。
7. 价格带与客单价要体现在脚本的价格锚点与行动号召里。

【story 字段的铁律 —— 这是整份报告最重要的一个字段】
每组 matrix 必须给出一个 story，它是一整段连续的中文口播稿，200 字上下，**单段纯文本**。

硬性要求：
- 绝对不能是数组、对象、分点符号、编号、表格或换行。就是一个字符串，从头到尾一段话。
- 结构（自然融进去，不要写"第一段""钩子："这类标记）：
  开头一句钩子直接抛出问题或反常识画面 → 中间共情用户翻车的具体处境 → 给出做法并说清用户能得到什么 → 摆出证据打消顾虑 → 一句行动号召收尾。
- 全文只用第一人称或直接对观众说话，口语化、能一口气念完。
- "说白了就是…"后面接的必须是**用户得到的收益**，不能重复前一句刚说过的卖点，也不能是"数字摆在这儿""参数很清楚"这类评价话术的说法。
- 不要出现"这条视频""本组""策略""矩阵"等内部术语，写给用户看的东西里不能有这些词。
- script 里的 5 段台词必须能拼成这段 story，但 story 是把它们串好之后的那一整段话。

【关于"深度"的要求 —— 这部分比罗列更重要】
不要只把卖点按维度分堆，那是分类不是策略。每个模块都要回答"所以呢"：
- dimGuide：说清每一维在内容里承担什么任务，以及每条卖点具体怎么讲（口播/字幕/画面分别怎么落）
- notFor / chain：打分只说明值不值得投，还要说清投给他意味着放弃谁、他需要几次触达才敢下单
- scenes 的 level / tone / why：哪组先做、画面色调偏暖还是偏冷、为什么值得用
- buyPoints 的 proof / risk：这条买点靠什么证据立住、最容易踩什么合规红线（尤其注意绝对化用语和功效承诺）
- matrix 的 why / kpi：为什么这组先做、这条视频只盯哪两个数（不同困境盯的数不同）
- actions：给出本周最先做的 3 件事，每条都要有"怎么判断做成了"

【关于 v 字段和 prompt 字段的铁律 —— 这份产出会直接喂给 AI 视频生成模型】
使用者不拍摄，所有画面都由 AI 生成。所以：
- script 的 v 字段写"这一秒画面里有什么"（主体、动作、环境、光线、运镜），不要写拍摄方法。
- 严禁出现这些词：拍摄、实拍、机位、一镜到底、同期声、补拍、打光、构图三分法、浅景深、架三脚架、素材清单。
- 正确写法示例：「画面主体是充电宝，女性手握正在使用，桌面有充电线，自然光从左侧来，镜头轻微推近」
- 错误写法示例：「拍产品特写 + 使用动作一镜到底，保持同一机位」
- prompt 字段输出中文四段：【① 剧情梗概】② 5 段分镜画面提示（每段含主体/动作/环境/光线/运镜/画面文字，可直接粘贴）③ 整体风格（画幅、时长、色调、负面词）④ 一致性锚点（固定的人物外貌与商品外观）。
- ④ 尤其重要：AI 是逐段独立生成的，不给固定的人物与商品描述，5 段会出 5 个不同的人、5 个不同颜色的商品。人物写清年龄段/性别/发型/衣着，商品写清颜色/材质/外观，各段必须完全一致。

【每组的"内容类型"】
每组要给出 type字段，从 剧情/痛点/场景/种草/促销/证据 里选一个，不能 8 组全用同一种。
理由：剧情靠冲突留人最容易起量，痛点最直接，场景让人想起自己用过的时刻，种草专治"信不信"，
促销逼单，证据收口。8 组要摊开用，让品牌策略有不同分工。
提醒："先看证据才下单"的人群（成分党、代买孝心、中老年、商务决策）不要配剧情类，容易投不动，改走证据类或痛点类。
【promptEn 字段 —— 英文画面提示词】
Sora / Runway / Veo 这类模型对英文提示词的响应明显好于中文，必须额外输出一份英文画面提示词。
- promptEn 是四段式，段标用英文：【① VOICEOVER】【② SHOT PROMPTS — EN】【③ GLOBAL STYLE — EN】【④ CONSISTENCY ANCHOR — EN】。
- ②③④ 全部用英文写，这是视频模型真正读取的部分，要用地道英文而不是逐字翻译：Medium close-up / slow push-in / soft natural daylight from the front-left。
- ① 配音稿保持中文（可交给中文 TTS 或做字幕），但要在段标里说明它不属于画面提示词。
- 商品名保留原样不翻译（Dior 999、SK-II 这类品牌和规格翻译会失真），但商品的外观描述用英文：matte finish / nude-pink shade / glossy tube。
- 画面里出现的文字仍写中文并注明 On-screen text (Chinese)，因为国内观众看中文。
- ④ 的英文锚点要包含：Character（年龄段英文说法用 early 30s / mid 40s 这类，不要写 a 33-year-old）+ Product + Lighting + Look，并提示可复用同一 seed 或角色参考图。

现在开始输出 JSON。`;

    if (!shots.length) {
      return [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ];
    }
    return [
      { role: 'system', content: sys },
      {
        role: 'user',
        content: [{ type: 'text', text: user }].concat(
          shots.map(s => ({ type: 'image_url', image_url: { url: s.s } }))
        )
      }
    ];
  },

  /* 主图优先（最能代表产品），详情页补足；总数封顶以控制 token 成本 */
  pickImages(input, max) {
    const lim = max || MAX_VISION_IMAGES;
    const imgs = (input && input.images) || {};
    const clean = arr => (Array.isArray(arr) ? arr : []).filter(s => typeof s === 'string' && s.startsWith('data:image/'));
    const takeMain = clean(imgs.main).slice(0, lim);
    const takeDetail = clean(imgs.detail).slice(0, Math.max(0, lim - takeMain.length));
    return takeMain.map(s => ({ s, t: '主图' })).concat(takeDetail.map(s => ({ s, t: '详情' })));
  },

  /* ---------- 模型名归一化：把常见别名映射到接口真实支持的模型 ---------- */
  normalizeModel(name) {
    const raw = String(name || '').trim();
    if (!raw) return raw;
    const base = (this.cfg && this.cfg.base || '').toLowerCase();
    const key = raw.toLowerCase().replace(/[\s_-]+/g, '');

    // 各厂商真实模型名
    const TABLE = [
      { host: 'deepseek', map: {
        deepseekv4pro: 'deepseek-chat', deepseekv4: 'deepseek-chat', v4pro: 'deepseek-chat', v4: 'deepseek-chat',
        deepseekv3: 'deepseek-chat', v3: 'deepseek-chat', pro: 'deepseek-chat', chat: 'deepseek-chat',
        reasoner: 'deepseek-reasoner', r1: 'deepseek-reasoner', deepseekr1: 'deepseek-reasoner'
      }},
      { host: 'moonshot', map: { kimi: 'moonshot-v1-8k', k2: 'kimi-k2-0711-preview' }},
      { host: 'dashscope', map: { qwen: 'qwen-plus', tongyi: 'qwen-plus' }},
      { host: 'bigmodel', map: { glm: 'glm-4-plus', zhipu: 'glm-4-plus' }}
    ];
    const hit = TABLE.find(t => base.includes(t.host));
    if (hit && hit.map[key]) return hit.map[key];

    // 通用兜底：去掉不常见后缀写法
    if (/^deepseek-v?\d+(\.\d+)?(pro|plus|max)?$/i.test(raw)) {
      return /reason|r1/i.test(raw) ? 'deepseek-reasoner' : 'deepseek-chat';
    }
    return raw;
  },

  /* 从接口报错信息里抠出它支持的模型名 */
  parseSupportedModels(errText) {
    const s = String(errText || '');
    // 兼容 "supported API model names are A, B, but you passed C" / "supported models are ..."
    const m = s.match(/supported\s+api\s+models?(?:\s+names?)?\s*(?:are|is|:)\s*([^"\\\]}]+)/i)
           || s.match(/available\s+models?\s*(?:are|is|:)\s*([^"\\\]}]+)/i);
    if (!m) return null;
    const list = m[1]
      .split(/,|\bor\b|\band\b/i)
      .map(x => x.trim().replace(/[.。;；]+$/, ''))
      .filter(x => /^[\w.\-:/]+$/.test(x) && x.length >= 2 && x.length <= 60);
    return list.length ? list : null;
  },

  /* 返回全部可用模型名（用于报错提示） */
  parseAllModels(errText) {
    const l = this.parseSupportedModels(errText);
    return l ? l.join('、') : '';
  },

  /* 从可用列表里挑最适合对话生成的模型：优先 chat / pro / plus，避开 flash / mini / lite / embed / vision */
  pickModel(list) {
    if (!list || !list.length) return null;
    const bad = /flash|mini|lite|small|tiny|embed|vision|audio|image|tts|whisper|rerank/i;
    const good = /chat|pro|plus|max|turbo|instruct/i;
    return list.find(m => good.test(m) && !bad.test(m))
        || list.find(m => !bad.test(m))
        || list[0];
  },

  /* ---------- 请求 ---------- */
  /* verbatim：模型名直接原样发送，不再走归一化。
     自动换名时用 —— 换来的名字来自接口自己返回的可用列表，接口认它，不需要再映射 */
  async chat(messages, timeout = 120000, verbatim = false) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(this.endpoint(), {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.cfg.key
        },
        body: JSON.stringify({
          model: verbatim ? this.cfg.model : this.normalizeModel(this.cfg.model),
          messages,
          temperature: 0.8,
          stream: false,
          // 不设上限的话模型可能回超长内容，既拖慢也把 MAX_TEXT 撑满
          max_tokens: 8000
        })
      });
      if (!res.ok) {
        // 错误正文只要用来认模型名和提示用户；读整个 body 会被异常端点灌爆内存
        const t = (await res.text().catch(() => '')).slice(0, 4000);
        const err = new Error('接口返回 ' + res.status + ' ' + t.slice(0, 300));
        err.raw = t;
        err.status = res.status;
        // 模型名不被支持时，按接口返回的可用列表换名重试一次
        const alts = this.parseSupportedModels(t) || [];
        const tried = String(this.cfg.model || '');
        // 优先挑与用户所填最接近的那个可用模型
        const pick = this.pickModel(alts);
        if (res.status === 400 && /model/i.test(t) && pick && pick.toLowerCase() !== tried.toLowerCase() && !this._retried) {
          this._retried = true;
          const old = this.cfg.model;
          this.cfg.model = pick;
          this.save({ model: pick });
          try {
            const retry = await this.chat(messages, timeout, true);
            this._lastSwitched = { from: old, to: pick };
            return retry;
          } finally {
            this._retried = false;
          }
        }
        throw err;
      }
      const data = await res.json();
      const txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!txt) throw new Error('接口未返回内容');
      return txt;
    } finally {
      clearTimeout(timer);
    }
  },

  async test() {
    const r = await this.chat([
      { role: 'user', content: '只回复两个字：正常' }
    ], 30000);
    return r.trim().slice(0, 50);
  },

  /* ---------- 生成报告 ---------- */
  /* historyBrief：由 insights.js 聚合出的历史复盘结论。
     有它就把"已被数据验证过的组合"告诉模型，让它优先沿用而不是重新猜 */
  async generate(input, historyBrief) {
    const brief = String(historyBrief || '');
    const wantVision = this.supportsVision() && this.pickImages(input).length > 0;
    if (wantVision) {
      try {
        const txt = await this.chat(this.buildMessages(input, true, brief));
        return normalizeReport(extractJSON(txt), input);
      } catch (e) {
        // 接口不支持图片输入：记住这件事，本会话不再白试，直接按纯文本重生成
        if (isVisionError(e)) {
          this._visionDisabled = true;
          this._visionNote = '当前模型不支持图片输入，已改用纯文本分析（图片仍会显示在报告里）';
        } else throw e;
      }
    }
    const txt = await this.chat(this.buildMessages(input, false, brief));
    return normalizeReport(extractJSON(txt), input);
  }
};

/* 接口对"发图片"这一行为的常见报错特征 */
function isVisionError(e) {
  if (!e) return false;
  if (e.status !== 400 && e.status !== 415 && e.status !== 422 && e.status !== 500) return false;
  const t = String((e.raw || '') + ' ' + (e.message || '')).toLowerCase();
  return /image|vision|visual|multimodal|multi-modal|content type|image_url|不支持.*图|图片/.test(t);
}

/* ---------------- 故事脚本收敛 ----------------
   无论接哪个模型、返回什么形态，最终必须是一整段纯文本口播稿。
   这里依次处理：字符串直接清干净 → 数组/对象拆成句子再拼 → 都没有就用分镜台词拼。 */
function coerceStory(v, ctx) {
  // 1) 字符串：清掉换行、编号、分点符号，压成单段
  if (typeof v === 'string' && v.trim()) {
    const s = flattenStory(v);
    // 太短说明模型只是给了个标题；含内部话术说明模型写成了策略说明。都判定为不可用
    if (s.length >= 40 && !INNER_WORDS_RE.test(s)) return s;
  }
  // 2) 数组或对象（模型把段落塞进数组/分段对象的情况）
  const parts = [];
  const push = t => { if (typeof t === 'string' && t.trim()) parts.push(t.trim()); };
  if (Array.isArray(v)) v.forEach(it => typeof it === 'string' ? push(it) : (it && (push(it.l) || push(it.text) || push(it.content) || push(it.script))));
  else if (v && typeof v === 'object') { push(v.text); push(v.story); push(v.content); if (Array.isArray(v.parts)) v.parts.forEach(push); }
  if (parts.length) {
    const s = flattenStory(parts.join(''));
    if (s.length >= 40 && !INNER_WORDS_RE.test(s)) return s;
  }
  // 3) 兜底：把 5 段分镜台词串成一段
  return storyFromScript(ctx);
}

/* 故事脚本是给用户念的，不能出现写给内部看的话。复用 engine.js 的定义；
   那份不存在时（本文件被单独引用）再退回本地定义 */
const INNER_WORDS_RE = (typeof INNER_WORDS_ENGINE !== 'undefined') ? INNER_WORDS_ENGINE
  : /本组|这条视频|这条内容|矩阵|策略重心|测试组合|脚本|分镜|卖点拆解/;

/* 压成单段：去掉换行、项目符号、编号、"钩子："这类阶段标记 */
function flattenStory(s) {
  return String(s)
    .replace(/```[\s\S]*?```/g, ' ')            // 误包在代码块里
    .replace(/<br\s*\/?>/gi, ' ')
    // 行首缩进只能用空格/制表符。用 \s 会跨过换行，配合 m 在每个行首重扫整段空白，
    // 变成 O(N²)：模型回 20 万个换行能把标签页卡死 20 秒
    .replace(/^[ \t]*(?:[-*•·]|\d+[.、)]|[（(]\d+[)）])[ \t]*/gm, '')
    .replace(/^[ \t]*(?:钩子|痛点|演示|证据|行动|第一段|第二段|第三段|第四段|第五段)[ \t]*[:：]?[ \t]*/gm, '')
    .replace(/^【[^】]{0,20}】[ \t]*/gm, '')
    .replace(/[\r\n]+/g, '')
    .replace(/[—–-]\s*(?=[。！？]|$)/g, '')   // 剥掉阶段名后剩下的空壳破折号
    .replace(/\s{2,}/g, ' ')
    .replace(/^[，,。、；;\s]+/, '')           // 开头可能残留的标点
    .trim();
}

/* 用分镜台词兜底拼一段故事，结构与本地引擎一致 */
function storyFromScript(ctx) {
  const c = ctx || {};
  // '—' / '待补充' / '（未生成）' 这类占位台词不能进故事
  const usable = s => {
    const t = String(s || '').trim();
    if (!t || t.length < 4) return '';
    if (/^[—–\-\s]+$/.test(t) || /^[(（]?(待补充|未生成|暂无|无)[)）]?$/.test(t)) return '';
    return t;
  };
  const at = i => {
    const row = (c.script || [])[i] || {};
    return usable(row.l).replace(/[。！？!?]+$/, '');
  };
  const priceSeg = c.price ? c.price + '这个价位' : '这个价位';
  const hookRaw = at(0);
  const painRaw = at(1);
  const gain = usable(c.gain).replace(/[。！？!?]+$/, '');
  const parts = [
    hookRaw ? hookRaw + '。' : '',
    c.scene && painRaw ? `如果你也遇到过这种情况：${painRaw.replace(/^.*?，最常卡住的就是/, '').replace(/^.*?就是/, '')}，那种感觉不用我多说你肯定懂。` : '',
    c.sell ? `我的解法其实很简单——${c.sell}${gain ? '，说白了就是' + gain : ''}。` : '',
    `我知道你在想什么，所以这次我没打算只靠嘴说：实测数据、检测报告都在这儿，${priceSeg}能做到这个的，真不多。`,
    `${c.price ? '现在' + c.price + '这个档位' : '这个价位'}，先按最小规格试一次，不合适还能退。想看实测的，评论区扣个「1」，我把细节发你。`
  ];
  return flattenStory(parts.filter(Boolean).join(''));
}

/* 视频提示词：AI 给了就用 AI 的（它可能基于图片），但必须把故事梗概补进去；
   没给就用本地那套由 story 反推画面的模板 */
/* 模型没给 prompt 时的兜底。
   这里原本自己抄了一份四段式模板，是全项目第三份同样的文案 ——
   长度上限、色调字段、画面文字截断规则三处都和本地引擎各写一份，
   迟早对不上。直接复用引擎的 buildPrompt，两条路格式天然一致。 */
function buildVideoPrompt(aiPrompt, story, x) {
  const head = `【① 剧情梗概（配音稿，可直接念）】\n${story}\n`;
  if (aiPrompt && String(aiPrompt).trim()) {
    // AI 已经写成四段式的就直接用，别重复加配音稿
    if (/锚点|一致性/.test(aiPrompt)) return aiPrompt;
    return head + '\n' + aiPrompt;
  }
  if (typeof buildPrompt !== 'function') return head;
  const scene = String((x && x.scene) || '').split('｜').pop();
  const aud = String((x && x.audience) || '');
  const prod = String((x && x.prod) || '产品');
  const sell = String((x && x.sellPoint) || '');
  const arg = {
    aud, scene, prod, props: [], story,
    sell, painScene: scene,
    proofItem: String((x && x.proofItem) || '产品参数页'),
    shotText: String((x && x.shotText) || ''),
    shotTextSell: String((x && x.shotTextSell) || x && x.shotText || ''),
    person: (typeof personAnchor === 'function') ? personAnchor(aud) : '',
    personEn: (typeof personAnchorEn === 'function') ? personAnchorEn(aud) : '',
    prodAnchor: (typeof productAnchor === 'function') ? productAnchor(prod) : '',
    styleTone: '暖调'
  };
  if (typeof enProofVisual === 'function') arg.proofItemEn = enProofVisual(arg.proofItem);
  return buildPrompt(arg);
}

/* 从返回文本中抠出 JSON（兼容被 ```json 包裹的情况） */
function extractJSON(txt) {
  let s = String(txt).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('返回内容不是合法 JSON');
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); }
  catch (e) { throw new Error('JSON 解析失败：' + e.message); }
}

/* 补齐/修正字段，保证渲染层不会崩。
   大模型返回的 JSON 完全不可信：数组里可能混入 null / 数字 / 字符串，
   直接 .scores 会抛 TypeError，进而被上层当成"AI 失败"静默降级到本地引擎 */
function normalizeReport(o, input) {
  if (!o || typeof o !== 'object') throw new Error('返回结构异常');
  const cat = (typeof matchCategory === 'function') ? matchCategory(input.category) : null;
  const g = (typeof GENERAL !== 'undefined') ? GENERAL : null;

  // 只取数组里的真对象（null / 数字 / 字符串一律丢掉），杜绝 .x 访问崩溃
  const objs = (v, max) => {
    if (!Array.isArray(v)) return [];
    const a = v.filter(x => x && typeof x === 'object' && !Array.isArray(x));
    return max ? a.slice(0, max) : a;
  };
  // 模型返回的文本长度不设上限：几 MB 的字符串会一路流进渲染和正则，
  // 既能拖垮界面，也放大各种 ReDoS。上限放宽到 20k，足够写口播稿和提示词。
  const MAX_TEXT = 20000;
  const str = (v, d) => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, MAX_TEXT) : d;
  const arr = (v, min, d) => {
    const a = Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => String(x).trim()) : [];
    while (a.length < min) a.push(d[a.length % d.length]);
    return a;
  };

  const dims = {};
  ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
    dims[k] = arr(o.dims && o.dims[k], 3, (cat && cat.dims && cat.dims[k]) || (g && g.dims[k]) || ['待补充']);
    dims[k] = dims[k].slice(0, 4);
  });

  /* dimGuide：AI 可能漏给或给错下标，缺的部分直接用本地引擎那套讲解语兜底 */
  const localDims = cat && cat.name ? null : null;
  const dimGuide = {};
  const localGuide = (typeof DIM_TASK !== 'undefined') ? DIM_TASK : null;
  ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
    const g = (o.dimGuide && typeof o.dimGuide === 'object') ? o.dimGuide[k] : null;
    const t = localGuide ? localGuide[k] : null;
    const how = dims[k].map((_, i) => {
      const fromAI = Array.isArray(g && g.how) ? String(g.how[i] || '').trim() : '';
      if (fromAI) return fromAI;
      return t ? t.how[i % t.how.length] : '用真实画面证明这一点';
    });
    dimGuide[k] = { task: str(g && g.task, t ? t.task : ''), how };
  });

  let audiences = objs(o.audiences, 3).map((a, i) => {
    const s = (a.scores && typeof a.scores === 'object') ? a.scores : {};
    const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.min(100, Math.round(v))) : d;
    return {
      name: str(a.name, '未命名人群'),
      tag: ['主攻', '次攻', '观察'][i],
      why: str(a.why, '—'),
      notFor: str(a.notFor, ''),
      chain: str(a.chain, ''),
      scores: { match: num(s.match, 80), pain: num(s.pain, 75), ease: num(s.ease, 35), pay: num(s.pay, 70), size: num(s.size, 65) }
    };
  });
  if (audiences.length < 3 && cat) {
    cat.audiences.slice(audiences.length).forEach(a => audiences.push({
      name: a.name, tag: ['主攻', '次攻', '观察'][audiences.length], why: a.why, notFor: '', chain: '',
      scores: Object.assign({}, a.base)
    }));
  }
  // 本地引擎那套"不要拍给谁 / 决策链路"补进来（AI 漏了也能有内容）
  audiences.forEach((a, i) => {
    if (!a.notFor) {
      const others = audiences.filter((_, j) => j !== i).map(x => String(x.name).split(/[，,、]/)[0]);
      a.notFor = `不要用同一条视频去打动另外两类（${others.join('、')}）——他们的问题和这个产品不匹配，口径混了会让算法也看不懂该推给谁`;
    }
    if (!a.chain) {
      const hard = a.scores.ease > 45 || a.scores.pay < 65;
      a.chain = hard
        ? `决策链路长（付费意愿 ${a.scores.pay}%、表达难度 ${a.scores.ease}%）：需要 3 次以上触达才敢下单，内容要拆成系列反复讲`
        : `决策链路短（付费意愿 ${a.scores.pay}%、表达难度 ${a.scores.ease}%）：看到就能判断要不要买，一次触达就可能转化`;
    }
  });

  let scenes = objs(o.scenes, 6).map(s => ({
    k: str(s.k, '场景'),
    level: str(s.level, '中'),
    tone: str(s.tone, '暖调'),
    why: str(s.why, ''),
    items: objs(s.items, 8).map(it => ({
      n: str(it.n, '场景'), ins: String(it.ins || '—'), use: str(it.use, '—')
    })).filter(it => it.n)
  })).filter(s => s.items.length);
  // 场景组不足 4 组就拿品类库补齐（只给 1 组会让 03 场景区几乎空白）
  if (cat) {
    for (const s of cat.scenes) {
      if (scenes.length >= 4) break;
      if (scenes.some(x => x.k === s.k)) continue;
      const r = (typeof sceneRule === 'function') ? sceneRule(s.k) : { level: '中', tone: '暖调', why: '' };
      scenes.push({ k: s.k, level: r.level, tone: r.tone, why: r.why, items: s.items });
    }
  }
  scenes.forEach(s => {
    if (!s.why) s.why = '按常规画面处理，注意画面里要有具体动作';
  });

  const proofOf = (typeof PROOF_OF !== 'undefined') ? PROOF_OF : {};
  const riskFn = (typeof riskOf === 'function') ? riskOf : null;
  let buyPoints = objs(o.buyPoints, 8).map(b => {
    const dim = ['func', 'effect', 'emotion', 'trust', 'diff'].includes(b.dim) ? b.dim : 'func';
    const buy = str(b.buy, '—');
    return {
      sell: str(b.sell, '—'), buy, gain: buy, dim,
      proof: str(b.proof, proofOf[dim] || ''),
      risk: str(b.risk, '')
    };
  }).filter(b => b.sell !== '—');
  while (buyPoints.length < 5 && cat) {
    const c = cat.buy[buyPoints.length % cat.buy.length];
    buyPoints.push({ sell: c.s, buy: c.b, gain: c.b, dim: 'func', proof: proofOf.func || '', risk: '' });
  }
  buyPoints.forEach(b => {
    if (!b.proof) b.proof = proofOf[b.dim] || '可验证的实测素材';
    if (!b.risk) b.risk = (riskFn && riskFn(b.sell)) || '别在文案里叠加绝对化用语';
  });

  const kpiOf = (typeof KPI_OF !== 'undefined' && KPI_OF[input.pain]) || (typeof DEFAULT_KPI !== 'undefined' ? DEFAULT_KPI : ['3秒完播率', '商品点击率']);
  let matrix = objs(o.matrix, 8).map((x, i) => {
    const defT = ['0-3s', '3-8s', '8-15s', '15-22s', '22-28s'];
    const defS = ['钩子', '痛点', '演示', '证据', '行动'];
    let script = objs(x.script, 5).map(s => ({
      t: str(s.t, defT[0]), stage: str(s.stage, defS[0]), l: str(s.l, ''), v: str(s.v, '')
    }));
    // 补齐 5 段：时间轴与阶段按位置取默认值，不依赖模型是否给了正确的 t/stage
    while (script.length < 5) script.push({ t: defT[script.length], stage: defS[script.length], l: '—', v: '—' });
    const bp = buyPoints.length ? buyPoints[i % buyPoints.length] : null;
    const kpi = (Array.isArray(x.kpi) ? x.kpi.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : []).slice(0, 3);
    const prodName = (input.prodName && String(input.prodName).trim())
      || (cat && cat.prod) || (input.category || '产品');
    /* 画面里的大字要短。直接用整句卖点会出现"底部一行「产地直发 冷链发货」"这种
       把参数标签当画面文字的情况。截断规则统一走引擎的 shortShotText ——
       两边各写一套的话，长度上限不一样，报告和导出就会对不上。 */
    const shotTextOf = (typeof shortShotText === 'function')
      ? s => shortShotText(s)
      : s => {
        const t = String(s == null ? '' : s).trim();
        const head = t.split(/[，,。！？、]/)[0] || t;
        return head.length <= 12 ? head : head.slice(0, 12) + '…';
      };
    // story 是一整段口播稿。AI 可能不给、给成数组、给成分点，都在这里收敛成一段纯文本
    const story = coerceStory(x.story, {
      script, scene: str(x.scene, ''), sell: str(x.sellPoint, bp ? bp.sell : ''),
      gain: bp ? bp.gain : '', painScene: '', price: input.price
    });
    return {
      idx: i + 1,
      audience: str(x.audience, audiences[0] ? audiences[0].name : '主攻人群'),
      scene: str(x.scene, scenes[0] ? scenes[0].k + '｜' + scenes[0].items[0].n : '核心场景'),
      sellPoint: str(x.sellPoint, bp ? bp.sell : '—'),
      buyPoint: str(x.buyPoint, bp ? bp.buy : '—'),
      priority: str(x.priority, i < 3 ? '优先测试' : (i < 6 ? '次轮测试' : '观察测试')),
      why: str(x.why, ''),
      kpi: kpi.length ? kpi : kpiOf.slice(),
      story,
      script,
      prompt: buildVideoPrompt(str(x.prompt, ''), story, {
        scene: str(x.scene, ''),
        audience: str(x.audience, ''),
        prod: prodName,
        sellPoint: str(x.sellPoint, ''),
        proofItem: (typeof proofVisualOf === 'function' && bp) ? proofVisualOf(bp.dim, bp.sell) : '产品参数页',
        shotText: shotTextOf(str(x.sellPoint, '')),
        shotTextSell: shotTextOf(str(x.sellPoint, '')),
        // 一致性锚点：与本地引擎同一套推导逻辑
        person: (typeof personAnchor === 'function') ? personAnchor(str(x.audience, '')) : ''
      }),
      promptEn: str(x.promptEn, '')
    };
  });
  // 模型给了 promptEn 就用模型的（它能把商品名/人设真正译成英文）；
  // 没给就退回本地英文模板，保证 UI 和导出里英文版永远不为空
  const prodEn = (input.prodName && String(input.prodName).trim())
    || (cat && cat.prod) || (input.category || 'product');
  // buildPromptEn 内部会再过一遍 enProofVisual，这里只给中文证据画面
  // 证据画面：直接查已经归一化好的 buyPoints（带 dim），
  // 别去 cat.buy 里找 —— 那是 {s,b} 结构，没有 dim 字段
  const proofOfEn = sell => {
    const bp = buyPoints.find(b => b && b.sell === sell);
    return (typeof proofVisualOf === 'function' && bp) ? proofVisualOf(bp.dim, bp.sell) : '产品参数页';
  };
  matrix.forEach(m => {
    if (!m.promptEn && typeof buildPromptEn === 'function') {
      m.promptEn = buildPromptEn({
        aud: m.audience, scene: str(m.scene, '').split('｜').pop(), prod: prodEn,
        props: [], story: m.story, sell: m.sellPoint,
        proofItem: proofOfEn(m.sellPoint),
        shotText: (typeof shortShotText === 'function') ? shortShotText(m.sellPoint) : str(m.sellPoint, ''),
        shotTextSell: (typeof shortShotText === 'function') ? shortShotText(m.sellPoint) : str(m.sellPoint, ''),
        personEn: (typeof personAnchorEn === 'function') ? personAnchorEn(m.audience) : '',
        styleTone: '暖调'
      });
    }
  });
  if (matrix.length < 8) {
    const local = generateReport(input);
    local.matrix.slice(matrix.length).forEach(m => matrix.push(m));
    matrix.forEach((m, i) => m.idx = i + 1);
  }
  /* 内容策略字段：模型没给就用本地同一套逻辑补。
     不补的话 AI 报告的 type/typeRole/hookKind 全是 undefined，
     界面只能兜底成"剧情"，8 组会全部标成同一类，
     而且整份报告缺 typePlan，「内容策略分工」卡片根本不出现。
     本地补齐还有一个额外好处：钩子里有没有露出产品，
     可以在本地重算一遍，把模型写偏的开头兜回来。 */
  if (typeof assignStrategy === 'function') {
    assignStrategy(matrix, {
      hooks: (cat && cat.hooks) || [],
      prodName: prodEn,
      audienceOf: i => {
        const a = audiences[i % Math.max(1, audiences.length)];
        return a ? a.name : (matrix[i] ? matrix[i].audience : '');
      },
      hookOf: i => (matrix[i] && typeof hookFromPrompt === 'function') ? hookFromPrompt(matrix[i].prompt) : ''
    });
  }
  // AI 没给 why / kpi 的组合用本地推出来的补上
  matrix.forEach((m, i) => {
    if (!m.why) m.why = `${m.audience} × ${m.scene}：先验证这个人群在这个场景下的反应，${m.priority}`;
    if (!Array.isArray(m.kpi) || !m.kpi.length) m.kpi = kpiOf.slice();
  });

  /* 行动清单：AI 没给就从矩阵前 3 组推出来 */
  let actions = objs(o.actions, 3).map((a, i) => ({
    no: i + 1,
    what: str(a.what, ''),
    how: str(a.how, ''),
    when: str(a.when, '')
  })).filter(a => a.what);
  if (!actions.length) {
    actions = matrix.slice(0, 3).map((m, i) => ({
      no: i + 1,
      what: `拍第${m.idx}组：${m.audience} × ${m.scene}`,
      how: `盯${m.kpi.slice(0, 2).join(' 和 ')}，${m.priority === '优先测试' ? '这组跑通再扩量' : '作为对照'}`,
      when: '本周内，和另外两组同期发布，避免互相干扰'
    }));
  }

  const summary = (o.summary && typeof o.summary === 'object' && !Array.isArray(o.summary)) ? o.summary : {};
  return {
    meta: {
      category: input.category || '未填写',
      price: input.price || '未选择',
      aov: input.aov || '未填写',
      selling: input.selling || '未填写',
      pain: input.pain || '未选择',
      catName: cat ? cat.name : (input.category || '商品'),
      prodName: (input.prodName && String(input.prodName).trim()) || (cat && cat.prod) || (input.category || '商品'),      date: input.date
    },
    play: PAIN_PLAYBOOK[input.pain] || {
      focus: '卖点清晰化 + 场景落地',
      rule: '先讲清卖点，再把卖点放进具体场景，让用户看到自己',
      tactics: ['先讲一个用户认得出的场景', '再给具体解决方案', '结尾给明确行动指令']
    },
    summary: {
      audience: str(summary.audience, audiences[0] ? audiences[0].name : '主攻人群'),
      audienceWhy: str(summary.audienceWhy, audiences[0] ? audiences[0].why : '—'),
      buyPoint: str(summary.buyPoint, buyPoints[0] ? buyPoints[0].buy : '—'),
      scene: str(summary.scene, scenes[0] ? scenes[0].k + '｜' + scenes[0].items[0].n : '核心场景'),
      sceneIns: str(summary.sceneIns, scenes[0] ? scenes[0].items[0].ins : '—')
    },
    actions, dimGuide,
    dims, audiences, scenes, buyPoints, matrix,
    typePlan: (typeof buildTypePlan === 'function') ? buildTypePlan(matrix) : [],
    source: 'ai'
  };
}