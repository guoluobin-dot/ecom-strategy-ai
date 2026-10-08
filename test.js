/* ===========================================================
   自检脚本：node test.js
   覆盖 引擎 / 结构 / 确定性 / AI容错 / 模型名 / 导出
   =========================================================== */
const fs = require('fs');
const path = require('path');

// 浏览器环境替身
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
  removeItem(k) { delete this._d[k]; }
};

const src = ['engine.js', 'llm.js', 'export.js', 'db.js', 'insights.js']
  .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))
  .join('\n;\n');
eval(src + `
globalThis.generateReport = generateReport;
globalThis.matchCategory = matchCategory;
globalThis.normalizeReport = normalizeReport;
globalThis.extractJSON = extractJSON;
globalThis.toMarkdown = toMarkdown;
globalThis.toWordHtml = toWordHtml;
globalThis.LLM = LLM;
globalThis.ImgDB = ImgDB;
globalThis.parseMetric = parseMetric;
globalThis.buildInsights = buildInsights;
globalThis.applyInsights = applyInsights;
globalThis.insightsBrief = insightsBrief;
globalThis.median = median;
globalThis.KB = KB;
globalThis.personAnchor = personAnchor;
globalThis.productAnchor = productAnchor;
globalThis.personAnchorEn = personAnchorEn;
globalThis.enProofVisual = enProofVisual;
globalThis.enProp = enProp;
globalThis.mentionsProduct = mentionsProduct;
globalThis.shotTextThatReveals = shotTextThatReveals;
globalThis.isSlowHeat = isSlowHeat;
globalThis.typeAlt = typeAlt;
globalThis.hookFromPrompt = hookFromPrompt;
globalThis.assignStrategy = assignStrategy;
`);

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + '  ' + extra); }
};
const sec = t => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(2, 46 - t.length)));

const mkInput = (o = {}) => Object.assign({
  category: '零食', price: '50-100元', aov: '89元',
  selling: '零添加配方', pain: '有播放，但没转化',
  detail: '0防腐剂、0甜味剂、0焦糖色、0味精，低温烘焙工艺，儿童与老人可食用，独立小包装，原料产地可溯源',
  date: '2026/9/23'
}, o);

/* ---------- T1 品类匹配 ---------- */
sec('T1 品类知识库匹配');
const catCases = [
  ['零食', '零食'], ['婴童零食', '零食'], ['护肤品', '护肤品'], ['精华', '护肤品'],
  ['小家电', '小家电'], ['空气炸锅', '小家电'], ['女装', '服饰'], ['纸尿裤', '母婴'],
  ['洗洁精', '家清日化'], ['茶叶', '茶饮咖啡'], ['益生菌', '保健品'], ['猫砂', '宠物用品'],
  ['耳机', '数码3C'], ['口红', '美妆'], ['收纳', '家居百货'], ['渔具', '通用商品']
];
catCases.forEach(([inp, exp]) => {
  const got = matchCategory(inp).name;
  ok(got === exp, `品类「${inp}」`, `→ ${got}${got === exp ? '' : ' (期望 ' + exp + ')'}`);
});

/* ---------- T2 报告结构完整性 ---------- */
sec('T2 报告结构（全部品类 × 7 困境 全量）');
const PAINS = [
  '播放量低，起不来量', '有播放，但没转化', '不知道该拍什么内容',
  '人群不精准，流量太泛', '内容同质化，没记忆点', '不会写脚本，拍出来干巴巴', '容易违规限流，不敢说'
];
const CATS = ['零食', '护肤品', '小家电', '服饰', '母婴', '家清日化', '茶饮咖啡', '保健品', '宠物用品', '数码3C', '美妆', '家居百货', '办公文具', '食品生鲜', '汽车用品', '户外运动', '渔具'];
let structBad = [];
CATS.forEach(c => {
  PAINS.forEach(p => {
    const r = generateReport(mkInput({ category: c, pain: p }));
    const errs = [];
    if (!r.summary.audience || !r.summary.buyPoint || !r.summary.scene) errs.push('summary');
    ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
      if (!Array.isArray(r.dims[k]) || r.dims[k].length < 3) errs.push('dims.' + k);
    });
    if (r.audiences.length !== 3) errs.push('audiences=' + r.audiences.length);
    r.audiences.forEach(a => {
      ['match', 'pain', 'ease', 'pay', 'size'].forEach(k => {
        const v = a.scores[k];
        if (typeof v !== 'number' || v < 0 || v > 100) errs.push('score.' + k);
      });
    });
    if (r.scenes.length < 4) errs.push('scenes=' + r.scenes.length);
    r.scenes.forEach(g => { if (!g.items.length) errs.push('scene.items'); });
    if (r.buyPoints.length < 5) errs.push('buyPoints=' + r.buyPoints.length);
    if (r.matrix.length !== 8) errs.push('matrix=' + r.matrix.length);
    r.matrix.forEach(m => {
      if (m.script.length !== 5) errs.push('script=' + m.script.length);
      if (!m.prompt) errs.push('prompt');
      if (!m.audience || !m.scene || !m.buyPoint) errs.push('mx.field');
    });
    if (!r.play.focus) errs.push('play');
    if (errs.length) structBad.push(`${c}/${p}: ${[...new Set(errs)].join(',')}`);
  });
});
ok(structBad.length === 0, `${CATS.length} 品类 × 7 困境 = ${CATS.length * PAINS.length} 份报告结构`, structBad.slice(0, 3).join(' | '));

/* ---------- T2b 内容质量 ---------- */
sec('T2b 内容质量');
const q = generateReport(mkInput());
const buys = q.buyPoints.map(b => b.buy);
ok(new Set(buys).size === buys.length, '04 买点翻译无重复', buys.length + ' 条');
CATS.slice(0, 5).forEach(c => {
  const rr = generateReport(mkInput({ category: c, detail: '材质好、工艺好、效果好、检测认证、独家专利', selling: '主打卖点' }));
  const bs = rr.buyPoints.map(b => b.buy);
  ok(new Set(bs).size === bs.length, `「${c}」买点不重复`);
});
const scriptLines = q.matrix[0].script.map(s => s.l).join(' ');
ok(!/策略重心|这也是这条内容|本轮/.test(scriptLines), '口播台词不含内部策略说明');

/* ---------- T3 确定性 ---------- */
sec('T3 同输入同输出');
const a1 = JSON.stringify(generateReport(mkInput()));
const a2 = JSON.stringify(generateReport(mkInput()));
ok(a1 === a2, '两次生成完全一致');
const b1 = JSON.stringify(generateReport(mkInput({ detail: '换个描述' })));
ok(a1 !== b1, '不同输入产生不同结果');

/* ---------- T4 AI 返回容错 ---------- */
sec('T4 大模型返回容错');
const bad = [
  ['完全空对象', {}],
  ['只有 summary', { summary: { audience: '宝妈' } }],
  ['字段类型错误', { dims: 'x', audiences: 'x', scenes: 5, matrix: {} }],
  ['矩阵只有 1 组', { matrix: [{ audience: 'a', scene: 's', script: [{ t: '0-3s', l: 'x' }] }] }],
  ['人群超 3 个', { audiences: [1, 2, 3, 4, 5].map(i => ({ name: '人群' + i })) }]
];
bad.forEach(([name, obj]) => {
  try {
    const r = normalizeReport(obj, mkInput());
    const good = r.matrix.length === 8 && r.audiences.length === 3 &&
      r.scenes.length >= 4 && r.buyPoints.length >= 5 &&
      r.matrix.every(m => m.script.length === 5) &&
      Object.keys(r.dims).length === 5;
    ok(good, name, `matrix=${r.matrix.length} aud=${r.audiences.length} scenes=${r.scenes.length} buy=${r.buyPoints.length}`);
  } catch (e) {
    ok(false, name, '抛错：' + e.message);
  }
});
ok(extractJSON('```json\n{"a":1}\n```').a === 1, 'JSON 被代码块包裹');
ok(extractJSON('前缀{"a":2}后缀').a === 2, 'JSON 前后有废话');
try { extractJSON('不是JSON'); ok(false, '非法输入应抛错'); } catch (e) { ok(true, '非法输入正确抛错'); }

/* ---------- T5 模型名 ---------- */
sec('T5 模型名映射与报错解析');
LLM.load();
LLM.cfg.base = 'https://api.deepseek.com/v1';
[['deepseek-V4Pro', 'deepseek-chat'], ['V4Pro', 'deepseek-chat'], ['deepseek-R1', 'deepseek-reasoner'], ['deepseek-chat', 'deepseek-chat']]
  .forEach(([i, e]) => ok(LLM.normalizeModel(i) === e, `映射 ${i}`, '→ ' + LLM.normalizeModel(i)));
const err = JSON.stringify({ error: { message: 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-V4Pro' } });
const list = LLM.parseSupportedModels(err) || [];
ok(list.length === 2, '解析接口可用模型', list.join('、'));
ok(LLM.pickModel(list) === 'deepseek-v4-pro', '挑出对话模型（跳过 flash）', LLM.pickModel(list));
ok(LLM.parseSupportedModels('{"error":"rate limit"}') === null, '无关报错不误判');

/* ---------- T6 导出 ---------- */
sec('T6 导出 Markdown / Word');
const rep = generateReport(mkInput());
const md = toMarkdown(rep);
const doc = toWordHtml(rep);
ok(md.length > 3000, 'Markdown 长度', md.length + ' 字符');
['# ', '## 01', '## 05', '| 卖点（商家想说的）', '组合 8', '```'].forEach(k => ok(md.includes(k), 'Markdown 含 ' + k));
ok(doc.length > 5000, 'Word 长度', doc.length + ' 字符');
ok(doc.includes('urn:schemas-microsoft-com'), 'Word 命名空间');
ok(doc.includes('<table>') && doc.includes('</table>'), 'Word 含表格');
ok(doc.includes('组合 8') || doc.includes('组合 8：'), 'Word 含 8 组矩阵');
ok(!/<script/i.test(doc), 'Word 无脚本注入');

/* ---------- T7 模型名 400 自动重试（回归：alt 未定义导致重试链路崩溃） ---------- */
sec('T7 模型名 400 自动换名重试');
(async () => {
  // 用一个无法被归一化、接口也不认的模型名，强制走 400 → 自动换名 → 重试成功这条路径
  LLM.cfg = { enabled: true, key: 'sk-test', model: 'my-fake-model-xyz', base: 'https://api.deepseek.com/v1' };
  const callOrder = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    callOrder.push(body.model);
    if (body.model === 'deepseek-chat') {          // 换名后重试 → 成功
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"summary":{"audience":"主攻人群"}}' } }] }) };
    }
    // 第一次用错模型名 → 400 并回传可用模型列表
    return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'The supported API model names are deepseek-chat, but you passed my-fake-model-xyz' } }) };
  };
  try {
    const r = await LLM.generate(mkInput());
    ok(callOrder[0] === 'my-fake-model-xyz', '首次请求原样发出用户填的模型名', '→ ' + callOrder[0]);
    ok(callOrder.length === 2, '400 后自动重试一次（未抛 alt 未定义）', '共 ' + callOrder.length + ' 次请求');
    ok(callOrder[1] === 'deepseek-chat', '重试改用接口回传的可用模型', '→ ' + callOrder[1]);
    ok(LLM._lastSwitched && LLM._lastSwitched.from === 'my-fake-model-xyz' && LLM._lastSwitched.to === 'deepseek-chat',
      '记录了自动换名', JSON.stringify(LLM._lastSwitched));
    ok(r && r.source === 'ai' && r.matrix.length === 8, '重试成功后返回完整 AI 报告', 'matrix=' + (r && r.matrix.length));
  } catch (e) {
    ok(false, '重试链路不应抛错', e.message);
  } finally {
    globalThis.fetch = realFetch;
    LLM._lastSwitched = null;
    LLM._retried = false;
  }

  /* ---------- T8 HTML 注入防护 ---------- */
  sec('T8 HTML 注入防护');
  const evil = mkInput();
  const evilRep = generateReport(evil);
  // 模拟大模型返回内容里带 HTML（scenes.ins / summary.sceneIns 原本未转义）
  evilRep.summary.sceneIns = '<img src=x onerror=alert(1)><script>alert(2)</script>洞察文字';
  evilRep.scenes[0].items[0].ins = '<script>alert(3)</script><b>强调</b>洞察';
  evilRep.summary.audience = '<script>alert(4)</script>人群';
  const evilMd = toMarkdown(evilRep);
  const evilDoc = toWordHtml(evilRep);
  ok(!/<script/i.test(evilMd), 'Markdown 无 script 标签');
  // Word 里允许出现 onerror 这种字样（已被转义成纯文本），只要求没有可执行的原始标签
  ok(!/<script[\s>]/i.test(evilDoc), 'Word 无可执行 script 标签');
  ok(!/<img[\s>]/i.test(evilDoc), 'Word 无可执行 img 标签');
  ok(evilDoc.includes('&lt;script&gt;'), 'Word 已转义注入内容');
  ok(evilMd.includes('洞察文字'), 'Markdown 保留正常文字');
  ok(evilDoc.includes('洞察文字'), 'Word 保留正常文字');

  /* ---------- T9 AI 返回里混入 null / 脏子对象（回归：曾抛 TypeError 导致静默降级） ---------- */
  sec('T9 AI 返回脏数据容错');
  const dirty = {
    'audiences 混入 null':        { audiences: [null, { name: 'x' }, null] },
    'audiences 全 null':          { audiences: [null, null, null] },
    'matrix 子对象为 null':        { matrix: [null] },
    'matrix.script 混入 null':     { matrix: [{ script: [null, undefined, { l: 'x' }] }] },
    'scenes.items 混入 null':      { scenes: [{ k: 'a', items: [null, { n: 'ok' }] }] },
    'scenes 混入 null':            { scenes: [null] },
    'buyPoints 混入 null':         { buyPoints: [null, null, null, null, null, null] },
    'summary 为 null':            { summary: null },
    'summary 为字符串':            { summary: 'x' },
    'scores 全字符串 / 越界':       { audiences: [{ name: 'a', scores: { match: 'x', pain: null, ease: {}, pay: [], size: 1e9 } }] },
    '嵌套全 null':                { summary: null, scenes: [null], matrix: [null], buyPoints: [null], audiences: [null], dims: null }
  };
  const checkFull = r => {
    const e = [];
    if (r.audiences.length !== 3) e.push('aud=' + r.audiences.length);
    r.audiences.forEach((a, i) => {
      if (!a.name) e.push('aud' + i + '.name');
      ['match', 'pain', 'ease', 'pay', 'size'].forEach(k => {
        const v = a.scores[k];
        if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) e.push('aud' + i + '.' + k);
      });
    });
    if (r.scenes.length < 4) e.push('scenes=' + r.scenes.length);
    r.scenes.forEach(g => { if (!g.k || !Array.isArray(g.items) || !g.items.length) e.push('scene.bad'); });
    if (r.buyPoints.length < 5) e.push('buy=' + r.buyPoints.length);
    if (r.matrix.length !== 8) e.push('matrix=' + r.matrix.length);
    r.matrix.forEach((m, i) => {
      if (!m.audience || !m.scene || !m.buyPoint) e.push('mx' + i + '.field');
      if (m.script.length !== 5) e.push('mx' + i + '.script');
      m.script.forEach((s, j) => { if (typeof s.l !== 'string' || typeof s.v !== 'string') e.push('mx' + i + '.' + j + '.type'); });
      if (typeof m.prompt !== 'string' || !m.prompt) e.push('mx' + i + '.prompt');
    });
    ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
      if (!Array.isArray(r.dims[k]) || r.dims[k].length < 3) e.push('dims.' + k);
      r.dims[k].forEach(x => { if (typeof x !== 'string' || !x) e.push('dims.' + k + '.type'); });
    });
    if (!r.play || !r.play.focus || !Array.isArray(r.play.tactics) || !r.play.tactics.length) e.push('play');
    // 导出层同样不能崩
    try { toMarkdown(r); toWordHtml(r); } catch (x) { e.push('导出崩溃:' + x.message); }
    return [...new Set(e)];
  };
  Object.entries(dirty).forEach(([name, obj]) => {
    try {
      const errs = checkFull(normalizeReport(obj, mkInput()));
      ok(!errs.length, name, errs.join(', '));
    } catch (e) {
      ok(false, name, '抛错 ' + e.constructor.name + ': ' + e.message);
    }
  });

  /* ---------- T10 表单极端输入 ---------- */
  sec('T10 表单极端输入');
  const wild = {
    '全空输入':        {},
    'null 字段':       { category: null, price: null, aov: null, selling: null, pain: null, detail: null, date: null },
    '数字字段':        { category: 123, price: 50, aov: 89, selling: 0, pain: 1, detail: 2 },
    '对象字段':        { category: {}, selling: [], detail: new Date(0) },
    '超长品类':        { category: 'A'.repeat(50000) },
    '超长详述':        { detail: '卖点'.repeat(50000) },
    '大量标点':        { detail: '、。！？；;\n\n\t，，，'.repeat(2000) },
    '正则元字符':      { category: '([a-z]+)*', selling: '$1$2$$' },
    'HTML 注入':       { category: '<script>alert(1)</script>', selling: '"\'`\\', detail: '</style><img>' },
    '纯空白':          { category: '   ', selling: '  ', detail: '  \n ' },
    'emoji 与生僻字':  { category: '🍪零食', selling: '𠮷𩸽限定', detail: '𠮷🍪🧁' },
    '零宽 / RTL':      { selling: '零\u200b添加\u200d配方', detail: 'שלום' }
  };
  Object.entries(wild).forEach(([name, patch]) => {
    try {
      const r = generateReport(Object.assign(mkInput(), patch));
      const errs = checkFull(r);
      if (typeof r.meta.category !== 'string' || typeof r.meta.date !== 'string') errs.push('meta 非字符串');
      ok(!errs.length, name, errs.join(', '));
    } catch (e) {
      ok(false, name, '抛错 ' + e.constructor.name + ': ' + e.message);
    }
  });

  /* ---------- T11 多模态：提示词组装 ---------- */
  sec('T11 多模态提示词');
  const dataImg = n => 'data:image/jpeg;base64,' + 'A'.repeat(20 * n);
  const withImgs = Object.assign(mkInput(), {
    images: { main: [dataImg(1), dataImg(2), dataImg(3)], detail: [dataImg(4), dataImg(5)] }
  });
  LLM.load();
  LLM.cfg = { enabled: true, key: 'sk-x', model: 'qwen-vl-max', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };
  ok(LLM.supportsVision() === true, '通义接口判定为支持视觉');

  const mVis = LLM.buildMessages(withImgs, true);
  ok(Array.isArray(mVis[1].content), '视觉模式 user.content 是数组', typeof mVis[1].content);
  const imgsIn = mVis[1].content.filter(c => c.type === 'image_url');
  ok(imgsIn.length === 4, '图片数量封顶 4 张', imgsIn.length + ' 张');
  ok(imgsIn.every(c => typeof c.image_url.url === 'string'), 'image_url.url 是字符串（回归：曾被套成对象）');
  ok(imgsIn.every(c => /^data:image\//.test(c.image_url.url)), '图片格式为 data:image/*');
  ok(mVis[1].content[0].type === 'text' && mVis[1].content[0].text.includes('【产品信息】'), '文本块在前且完整');
  ok(mVis[1].content[0].text.includes('主图 3 张、详情页 1 张'), '提示词正确区分主图/详情页数量', (mVis[1].content[0].text.match(/主图 \d+ 张、详情页 \d+ 张/) || [''])[0]);
  ok(mVis[0].content.includes('产品图片'), 'system 提示也提到图片');

  const picked = LLM.pickImages(withImgs);
  ok(picked.length === 4 && picked[0].t === '主图' && picked[3].t === '详情', '主图优先，标签正确', picked.map(p => p.t).join('→'));

  const mNo = LLM.buildMessages(withImgs, false);
  ok(typeof mNo[1].content === 'string', '纯文本模式 content 是字符串');
  ok(!mNo[1].content.includes('已附'), '纯文本模式不提图片');

  LLM.cfg.base = 'https://api.deepseek.com/v1';
  ok(LLM.supportsVision() === false, 'DeepSeek 判定为不支持视觉');
  LLM.cfg.base = 'https://example.com/v1';
  LLM.cfg.vision = false;
  ok(LLM.supportsVision() === false, '用户手动关闭后不发图');
  LLM.cfg.vision = undefined;

  ok(LLM.pickImages({ images: null }).length === 0, '无图时返回空');
  ok(LLM.pickImages({ images: { main: ['http://x/a.jpg'] } }).length === 0, '非 data URL 不发送');
  ok(LLM.pickImages(withImgs, 2).length === 2, '可自定义数量上限');

  /* ---------- T12 视觉不支持时自动降级 ---------- */
  sec('T12 视觉降级');
  LLM.cfg = { enabled: true, key: 'sk-x', model: 'text-only-model', base: 'https://example.com/v1' };
  LLM._visionDisabled = false; LLM._visionNote = null;
  const seen = [];
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    const hasImg = Array.isArray(body.messages[1].content);
    seen.push(hasImg ? 'img' : 'text');
    if (hasImg) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "This model does not support image input" } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"summary":{"audience":"降级后人群"}}' } }] }) };
  };
  try {
    const r = await LLM.generate(withImgs);
    ok(seen[0] === 'img' && seen[1] === 'text', '先发图失败后退回纯文本', seen.join('→'));
    ok(LLM._visionDisabled === true, '已记住该接口不支持图');
    ok(!!LLM._visionNote, '记录了降级说明供界面提示');
    ok(r.source === 'ai' && r.matrix.length === 8, '降级后仍返回完整报告', 'matrix=' + r.matrix.length);
    // 第二次生成不应再试图片
    seen.length = 0;
    await LLM.generate(withImgs);
    ok(seen.length === 1 && seen[0] === 'text', '再次生成直接走纯文本（不再浪费一次请求）', seen.join('→'));
  } catch (e) {
    ok(false, '视觉降级不应抛错', e.message);
  } finally {
    globalThis.fetch = realFetch2;
    LLM._visionDisabled = false; LLM._visionNote = null; LLM._retried = false;
  }

  /* ---------- T13 图片仓库存取 ---------- */
  sec('T13 图片仓库');
  ok(typeof ImgDB.put === 'function' && typeof ImgDB.get === 'function' && typeof ImgDB.del === 'function', 'ImgDB 接口完整');
  ok(await ImgDB.put('r-empty', { main: [], detail: [] }) === false, '无图时不写入');
  ok(await ImgDB.put(null, { main: [dataImg(1)], detail: [] }) === false, '无 IndexedDB 时如实报失败（不再假装存成功）');
  ok(await ImgDB.get(null) === null, '无 id 读取返回 null');
  // 备份导入是主要入口：非 data:image 的地址和错类型必须被挡掉
  ok(await ImgDB.put('r-evil', { main: '" onerror="alert(1)', detail: 'javascript:alert(1)' }) === false, '挡掉非 data:image 的图片地址');
  ok(await ImgDB.put('r-evil2', { main: 'not-an-array', detail: null }) === false, '挡掉非数组的图片列表');
  ok(await ImgDB.get(null) === null, '空 id 读取返回 null');
  // Node 无 IndexedDB，应走降级分支而不是抛异常
  ok(ImgDB._failed === true, '无 IndexedDB 时标记为不可用（图片仅本次展示）');
  const dbSrc31 = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
  ok(/_failed\s*=\s*true/.test(dbSrc31) && /setTimeout\(bail/.test(dbSrc31), '含不可用兜底与超时保护');

  /* ---------- T14 深度层：每个模块都要有"所以呢" ---------- */
  sec('T14 深度层字段');
  const dep = generateReport(mkInput());
  // 01 维度：任务说明 + 每条卖点怎么讲（且与 dims 下标严格对齐）
  ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
    const g = dep.dimGuide[k];
    const errs = [];
    if (!g || !g.task) errs.push('缺 task');
    if (!Array.isArray(g.how)) errs.push('how 非数组');
    else {
      if (g.how.length !== dep.dims[k].length) errs.push(`how(${g.how.length})≠dims(${dep.dims[k].length})`);
      if (g.how.some(x => !x || typeof x !== 'string')) errs.push('how 有空值');
      if (new Set(g.how).size !== g.how.length) errs.push('how 有重复');
    }
    ok(!errs.length, `维度 ${k} 的任务说明与讲解语`, errs.join(','));
  });

  // 02 人群：不要拍给谁 + 决策链路
  ok(dep.audiences.every(a => a.notFor && a.chain), '三类人群都有 notFor 与 chain');
  ok(dep.audiences[0].notFor !== dep.audiences[1].notFor, '不同人群的 notFor 有区分');
  ok(dep.audiences.every(a => a.notFor.includes('不要用同一条视频')), 'notFor 说清了放弃谁');

  // 03 场景：优先级 / 拍摄成本 / 为什么值得拍
  ok(dep.scenes.every(s => s.level && s.tone && s.why), '每组场景都有 level/tone/why');
  ok(dep.scenes.some(s => s.level === '高'), '存在高优先级场景', dep.scenes.map(s => s.level).join(','));
  ok(dep.scenes.some(s => s.tone === '冷调') && dep.scenes.some(s => s.tone === '暖调'),
    '场景带色调标记（用于 AI 生成）', dep.scenes.map(s => s.tone).join(','));
  ok(dep.scenes.every(s => s.cost === undefined), '已移除拍摄成本字段（纯 AI 生成，不需要）');

  // 04 买点：证据 + 合规风险
  ok(dep.buyPoints.every(b => b.proof && b.risk), '每条买点都有 proof 与 risk');
  const risky = generateReport(mkInput({ selling: '全网最好 100% 有效', detail: '第一品牌 永久 彻底根治' }));
  ok(risky.buyPoints.some(b => /绝对化|违规|改成|条件/.test(b.risk)), '命中绝对化用语时给出具体替换建议',
    risky.buyPoints.find(b => /绝对化|违规|改成/.test(b.risk)) ? risky.buyPoints.find(b => /绝对化/.test(b.risk)).risk.slice(0, 30) : '未命中');

  // 05 矩阵：为什么先拍 + 盯什么指标
  ok(dep.matrix.every(x => x.why && Array.isArray(x.kpi) && x.kpi.length), '每组矩阵都有 why 与 kpi');
  const conv = generateReport(mkInput({ pain: '有播放，但没转化' }));
  const view = generateReport(mkInput({ pain: '播放量低，起不来量' }));
  ok(conv.matrix[0].kpi.join() !== view.matrix[0].kpi.join(), '不同困境盯不同指标',
    `转化→${conv.matrix[0].kpi[0]} / 起量→${view.matrix[0].kpi[0]}`);
  ok(view.matrix[0].kpi.some(k => /完播/.test(k)), '播放量低时盯完播率', view.matrix[0].kpi.join(','));
  ok(conv.matrix[0].kpi.some(k => /点击|转化/.test(k)), '没转化时盯点击率', conv.matrix[0].kpi.join(','));

  // 00 行动清单
  ok(Array.isArray(dep.actions) && dep.actions.length === 3, '行动清单 3 条', dep.actions.length);
  ok(dep.actions.every(a => a.what && a.how && a.when), '每条行动都有做什么/怎么算做成/什么时候');
  ok(dep.actions[0].what.includes('第1组'), '指向矩阵第 1 组', dep.actions[0].what);

  /* ---------- T15 AI 缺深度字段时兜底 ---------- */
  sec('T15 AI 深度字段兜底');
  [['完全空对象', {}], ['只有 summary', { summary: { audience: '宝妈' } }],
   ['维度只有部分 how', { dimGuide: { func: { task: 'AI给的任务', how: ['只有一条'] } } }],
   ['场景无 level/tone', { scenes: [{ k: '日常场景', items: [{ n: 'x' }] }] }],
   ['买点无 proof/risk', { buyPoints: [{ sell: 'a', buy: 'b' }] }],
   ['矩阵无 kpi', { matrix: [{ audience: 'a', scene: 's', script: [{ t: '0-3s', l: 'x' }] }] }],
   ['actions 为 null', { actions: [null] }]
  ].forEach(([name, obj]) => {
    try {
      const r = normalizeReport(obj, mkInput());
      const errs = [];
      ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
        if (!r.dimGuide[k].task) errs.push('dimGuide.' + k + '.task');
        if (r.dimGuide[k].how.length !== r.dims[k].length) errs.push('dimGuide.' + k + '.how');
        if (r.dimGuide[k].how.some(x => !x)) errs.push('dimGuide.' + k + '.how 空');
      });
      r.audiences.forEach((a, i) => { if (!a.notFor) errs.push('aud' + i + '.notFor'); if (!a.chain) errs.push('aud' + i + '.chain'); });
      r.scenes.forEach((s, i) => { if (!s.level || !s.tone || !s.why) errs.push('scene' + i); });
      r.buyPoints.forEach((b, i) => { if (!b.proof) errs.push('buy' + i + '.proof'); if (!b.risk) errs.push('buy' + i + '.risk'); });
      r.matrix.forEach((m, i) => {
        if (!m.why) errs.push('mx' + i + '.why');
        if (!Array.isArray(m.kpi) || !m.kpi.length) errs.push('mx' + i + '.kpi');
      });
      if (!r.actions.length) errs.push('actions');
      try { toMarkdown(r); toWordHtml(r); } catch (x) { errs.push('导出崩溃:' + x.message); }
      ok(!errs.length, name, [...new Set(errs)].join(','));
    } catch (e) {
      ok(false, name, '抛错 ' + e.message);
    }
  });
  // AI 给了部分 how 时要尊重 AI 的内容
  const partial = normalizeReport({ dimGuide: { func: { task: 'AI写的任务', how: ['AI的讲法一', 'AI的讲法二'] } } }, mkInput());
  ok(partial.dimGuide.func.task === 'AI写的任务', '优先采用 AI 给的任务说明');
  ok(partial.dimGuide.func.how[0] === 'AI的讲法一', '优先采用 AI 给的讲解语');
  ok(partial.dimGuide.func.how.length === partial.dims.func.length, '缺失部分自动补齐到与 dims 对齐',
    partial.dimGuide.func.how.length + '/' + partial.dims.func.length);

  /* ---------- T16 导出包含新字段 ---------- */
  sec('T16 导出深度字段');
  const dmd = toMarkdown(dep), ddoc = toWordHtml(dep);
  ['本轮先做这三件事', '怎么讲：', '决策链路：', '不要拍给：', '需要什么证据', '合规风险', '为什么先拍这组', '这条只盯', '数据复盘表']
    .forEach(k => ok(dmd.includes(k), 'Markdown 含 ' + k));
  ['本轮先做这三件事', '决策链路', '合规风险', '数据复盘表'].forEach(k => ok(ddoc.includes(k), 'Word 含 ' + k));
  ok(dmd.length > 13000, 'Markdown 明显变长', dmd.length + ' 字符');
  ok(ddoc.length > 16000, 'Word 明显变长', ddoc.length + ' 字符');
  ok(!/<script/i.test(ddoc), 'Word 仍无脚本注入');

  /* ---------- T17 故事型脚本（无论接哪个模型都必须是单段口播稿） ---------- */
  sec('T17 故事型脚本');
  const isSingleParagraph = s => typeof s === 'string' && s.trim().length >= 60
    && !/[\r\n]/.test(s)                                   // 单段
    && !/^\s*[-*•·]/.test(s)                              // 无列表符
    && !/^\s*\d+[.、)]/.test(s)                            // 无编号
    && !/第一段|第二段|钩子：|痛点：|演示：|证据：|行动：/.test(s)   // 无阶段标记
    && !/\*\*|##/.test(s);                                 // 无 markdown 残留
  const storyOK = s => {
    const errs = [];
    if (!isSingleParagraph(s)) {
      if (typeof s !== 'string') errs.push('非字符串');
      else if (s.trim().length < 60) errs.push('过短' + s.trim().length);
      else if (/[\r\n]/.test(s)) errs.push('含换行');
      else if (/第一段|钩子：/.test(s)) errs.push('残留阶段标记');
      else errs.push('非单段');
    }
    // 不能出现内部术语
    if (/本组|这条视频|矩阵|策略重心/.test(s)) errs.push('含内部术语');
    // 不能出现两个破折号连用（拼接痕迹）
    if (/[—–]\s*说白/.test(s)) errs.push('破折号拼接');
    // "说白了就是"后面不能是把卖点原样重说一遍
    const m = s.match(/我的解法其实很简单——(.*)，说白了就是([^。]+)/);
    if (m) {
      const bare = x => String(x).replace(/[\s，。！？、；：·—–-]/g, '');
      if (bare(m[1]) === bare(m[2])) errs.push('收益句与卖点相同');
      if (m[2].length < 4) errs.push('收益句过短');
    }
    return errs;
  };

  // 本地引擎：全品类 × 全困境都要合规
  const storyBad = [];
  CATS.forEach(c => PAINS.forEach(p => {
    const r = generateReport(mkInput({ category: c, pain: p }));
    r.matrix.forEach(m => {
      const e = storyOK(m.story);
      if (e.length) storyBad.push(`${c}/${p}/#${m.idx}: ${e.join(',')}`);
    });
  }));
  ok(storyBad.length === 0, `本地引擎 ${CATS.length * PAINS.length * 8} 段故事全部合规`, storyBad.slice(0, 3).join(' | '));

  // 收益句不能自己带"说白了"，否则拼出"说白了就是说白了"（回归：曾在新品类上出现）
  CATS.concat(['通用商品']).forEach(c => {
    ['零添加配方', '核心卖点', '免打孔安装 专用尺寸', '3秒速热', '专车专用', '55%'].forEach(s => {
      generateReport(mkInput({ category: c, selling: s, detail: '细节一、细节二、细节三' })).matrix.forEach(m => {
        if (/说白了就是说白了|说白了，/.test(m.story)) storyBad.push(c + '/' + s.slice(0, 6) + ': 说白了重复');
      });
    });
  });
  ok(!storyBad.some(x => /说白了重复/.test(x)), '收益句无"说白了"自重复', storyBad.filter(x => /说白了重复/.test(x)).slice(0, 2).join(' | '));

  // 提示词必须由故事驱动
  const p0 = generateReport(mkInput()).matrix[0];
  ok(p0.prompt.includes(p0.story.slice(0, 25)), '视频提示词包含故事梗概');
  ok(/【① 剧情梗概】/.test(p0.prompt), '第一段：剧情梗概（配音稿）');
  ok(/【② 分镜画面提示】/.test(p0.prompt), '第二段：分镜画面提示');
  ok(/【③ 整体风格】/.test(p0.prompt), '第三段：整体风格');
  ok(/9:16/.test(p0.prompt) && /1080/.test(p0.prompt), '整体风格含画幅与分辨率');
  ok(/禁止：/.test(p0.prompt), '整体风格含负面词');
  ['0-3s', '3-8s', '8-15s', '15-22s', '22-28s'].forEach(sp => {
    ok(p0.prompt.includes(sp), '分镜含时间片 ' + sp);
  });
  ok(/画面文字/.test(p0.prompt), '分镜含画面文字说明');

  // AI 返回各种形态都要收敛
  const storyCases = {
    'AI 完全没给 story': { matrix: [{ audience: '宝妈', scene: '日常场景｜放学接娃', script: [
      { t: '0-3s', l: '娃放学一进门就喊饿' }, { t: '3-8s', l: '宝妈，最常卡住的就是「翻柜子」——买的那堆零食配料表长得比说明书还长。' },
      { t: '8-15s', l: '后来我只挑配料表短的买' }, { t: '15-22s', l: '检测报告在这儿' }, { t: '22-28s', l: '想要的评论区扣1' }] }] },
    'AI 把 story 写成数组': { matrix: [{ story: ['第一段：钩子', '第二段：痛点', '第三段：演示', '第四段：证据', '第五段：行动收尾'], audience: '宝妈', scene: 'x' }] },
    'AI 把 story 写成对象': { matrix: [{ story: { text: '娃放学一进门就喊饿，我翻遍柜子。买的零食配料表长得比说明书还长。后来我只挑配料表短的买，现在给他吃我不操心。检测报告在这儿，50-100这个档位能做到这个的真不多。想要的评论区扣个1。' }, audience: '宝妈', scene: 'x' }] },
    'AI 的 story 带换行编号 markdown': { matrix: [{ story: '**第一段：** 娃放学喊饿\n\n- 第二段：翻遍柜子\n- 第三段：换成零添加\n- 第四段：检测报告在这儿\n- 第五段：评论区扣1', audience: '宝妈', scene: 'x' }] },
    'story 全是占位符': { matrix: [{ story: ['第一段：钩子', '第二段：痛点'], audience: '宝妈', scene: '日常场景｜放学接娃', script: [{ t: '0-3s', l: '—' }, { t: '3-8s', l: '待补充' }, { t: '8-15s', l: '（未生成）' }, { t: '15-22s', l: '—' }, { t: '22-28s', l: '—' }] }] },
    'story 太短被丢弃': { matrix: [{ story: '买它就对了', audience: '宝妈', scene: '日常场景｜放学接娃', script: [{ t: '0-3s', l: '娃放学一进门就喊饿，我翻遍柜子' }, { t: '3-8s', l: '买的那堆零食配料表长得比说明书还长' }, { t: '8-15s', l: '后来我就只挑配料表短的买' }] }] }
  };
  Object.entries(storyCases).forEach(([n, o]) => {
    try {
      const m = normalizeReport(o, mkInput()).matrix[0];
      const e = storyOK(m.story);
      ok(!e.length, n, e.join(','));
      ok(m.prompt.includes(m.story.slice(0, 20)), n + ' → 提示词带上故事');
    } catch (x) { ok(false, n, '抛错 ' + x.message); }
  });
  // AI 给了合规 story 时必须原样采用，不能被覆盖
  const keep = normalizeReport({ matrix: [{ story: '如果你家也有这个困扰：娃放学回家喊饿，翻遍零食柜全是添加剂。我就把配料表全换了一遍，现在拿给他吃我不操心。检测报告就在这儿，50-100这个档位能做到这个的真不多。想要链接的评论区扣个1。', audience: '宝妈', scene: 'x' }] }, mkInput());
  ok(keep.matrix[0].story.startsWith('如果你家也有这个困扰'), 'AI 写的合规故事被原样保留');

  // 收益句不能是卖点的原样复述（"说白了就是X"里 X 换了说法才算翻译）
  const repBad = [];
  CATS.slice(0, 6).forEach(c => {
    const r = generateReport(mkInput({ category: c, detail: '', selling: '核心卖点' }));
    r.matrix.forEach(m => {
      const mm = m.story.match(/我的解法其实很简单——(.*)，说白了就是([^。]+)/);
      if (!mm) { repBad.push(c + '/#' + m.idx + ':结构缺失'); return; }
      const bare = x => String(x).replace(/[\s，。！？、；：·—–-]/g, '');
      if (bare(mm[1]) === bare(mm[2])) repBad.push(c + '/#' + m.idx + ':' + mm[2]);
    });
  });
  ok(repBad.length === 0, '收益句是卖点的换说法而非复述', repBad.slice(0, 3).join(', '));

  // 导出必须带故事
  const smd = toMarkdown(dep), sdoc = toWordHtml(dep);
  ok(smd.includes('故事脚本（可直接念）'), 'Markdown 含故事脚本段');
  ok(sdoc.includes('故事脚本（可直接念）'), 'Word 含故事脚本段');
  ok(dep.matrix.every(x => sdoc.includes(x.story.slice(0, 20))), 'Word 8 组故事齐全');

  /* ---------- T18 矩阵覆盖与导出/打印完整性 ---------- */
  sec('T18 矩阵覆盖');
  // 场景索引曾用 floor(i/人数)%场景组数，导致第 4 组"情绪场景"永远进不了矩阵
  const coverBad = [];
  CATS.forEach(c => {
    const r = generateReport(mkInput({ category: c, detail: '卖点一、卖点二、卖点三、卖点四' }));
    // 三要素组合必须 8 组全不重复
    const triples = new Set(r.matrix.map(m => m.audience + '|' + m.scene + '|' + m.buyPoint));
    if (triples.size !== 8) coverBad.push(c + ':组合' + triples.size + '/8');
    // 场景组必须全部被用到（4 组）
    const groups = new Set(r.matrix.map(m => m.scene.split('｜')[0]));
    const totalGroups = r.scenes.length;
    if (groups.size < Math.min(4, totalGroups)) coverBad.push(c + ':场景组' + groups.size + '/' + totalGroups);
    // 场景项种类不能太少
    if (new Set(r.matrix.map(m => m.scene)).size < 6) coverBad.push(c + ':场景项' + new Set(r.matrix.map(m => m.scene)).size + '/8');
  });
  ok(coverBad.length === 0, `${CATS.length - 1} 品类矩阵覆盖：4 组场景全用到 + 8 组不重复`, coverBad.slice(0, 3).join(' | '));

  // 打印/PDF 时折叠的分镜表必须强制展开，否则整块内容不进 PDF
  // 注意：CSS 里有多个 @media print 块（复盘表、主体各一个），要全部合并后再匹配
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  const printBlocks = (css.match(/@media print\s*\{[\s\S]*?\n\}/g) || []).join('\n');
  ok(printBlocks.length > 0, '存在打印样式');
  ok(/details\.beat\s*>\s*table\{[^}]*display:table/.test(printBlocks), '打印时强制展开折叠的分镜表');
  ok(/\.beat summary\{[^}]*display:none/.test(printBlocks), '打印时隐藏折叠标题');
  // 长文本必须允许跨页（否则一页放不下就整块下移，页尾留大片空白）
  ok(/\.mx,\s*\.sec,\s*\.tb,\s*\.rev\{break-inside:auto/.test(printBlocks), '长块允许跨页（避免大片空白）');
  ok(/orphans:2/.test(printBlocks) && /widows:2/.test(printBlocks), '设了孤行寡行控制');
  // 标题不能单独留在页尾
  ok(/break-after:avoid/.test(printBlocks), '标题不会与正文分离到两页');
  ok(/display:table-header-group/.test(printBlocks), '跨页表格重复表头');
  ok(/print-color-adjust:exact/.test(printBlocks), '强制打印背景色（黑框提示词会变一片黑）');
  ok(/@page\{margin:/.test(printBlocks), '设置了页边距');

  // 买点表 5 列在窄屏要卡片化
  ok(/table\.tb-buy/.test(css) && /max-width:820px/.test(css), '买点表有窄屏适配');
  ok(/td\[data-l\]|attr\(data-l\)|content:attr\(data-l\)/.test(css), '窄屏用 data-l 作字段标签');
  const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const dlCount = (appSrc.match(/data-l="/g) || []).length;
  ok(dlCount === 4, '买点表 4 个字段都有 data-l 标签', dlCount + ' 个');

  /* ---------- T19 复盘数据 / 备份 / 路由（代码层静态核对） ---------- */
  sec('T19 复盘·备份·路由');
  // 复盘：必须挂到历史记录上，且有输入框与实时小结
  ok(/saveReview\s*\(/.test(appSrc) && /getReview\s*\(/.test(appSrc), 'Store 提供复盘读写');
  ok(/rev-in/.test(appSrc) && /data-f="a"/.test(appSrc) && /data-f="b"/.test(appSrc) && /data-f="note"/.test(appSrc),
    '复盘表有指标1/指标2/结论 三个输入');
  ok(/updateRevSum/.test(appSrc), '复盘表有实时小结');
  // 窗口要够宽：块里现在有注释，稍微加点说明就会被截断而误报。
  // 锚定到下一次赋值/函数结束，而不是固定字符数。
  const debounceBlock = (appSrc.match(/revTimer[\s\S]*?function updateRevSum/) || [''])[0];
  ok(/revTimer\s*=\s*setTimeout/.test(debounceBlock) && /clearTimeout\(revTimer\)/.test(debounceBlock)
    && /Store\.saveReview/.test(debounceBlock), '输入写入做了防抖（clearTimeout + 延时保存）');
  ok(/rec\.review = clean/.test(appSrc) && /else delete rec\.review/.test(appSrc),
    '清空后不残留空数据（无内容就删掉字段）');
  // 备份：导出必须带 tag 校验，且不含 API Key
  ok(/ai_ecom_backup_v1/.test(appSrc), '备份文件带版本标识');
  ok(/pack\.tag !== BACKUP_TAG/.test(appSrc), '导入校验文件来源');
  ok(/prompt:.*ask|pack\.history = list/.test(appSrc) || /history: list/.test(appSrc), '备份含历史记录');
  const exportIdx = appSrc.indexOf('BACKUP_TAG =');
  const keyIdx = appSrc.indexOf('const pack = {');
  const packBlock = appSrc.slice(keyIdx, keyIdx + 400);
  ok(!/key/i.test(packBlock), '备份内容不含 API Key');
  ok(exportIdx >= 0, '备份常量已定义');
  // 路由：hash 与后退
  ok(/function parseHash\(\)/.test(appSrc) && /function pushHash/.test(appSrc), '路由有 hash 解析与写入');
  ok(/addEventListener\('hashchange'/.test(appSrc), '监听 hashchange 实现后退');
  ok(/#\/report/.test(appSrc) || /'#\/' \+ view/.test(appSrc), '报告路由带 id');
  ok(/链接里的报告在当前浏览器里找不到/.test(appSrc), '深链接取不到报告时有明确说明');
  ok(/function boot\(\)|\(function boot\(/.test(appSrc) || /parseHash\(\)[\s\S]{0,200}openReport/.test(appSrc), '启动时按 hash 落地');

  /* ---------- T20 钩子与场景多样性 ---------- */
  sec('T20 内容多样性');
  let hookWorst = 99, hookWhere = '';
  CATS.forEach(c => PAINS.forEach(p => {
    const r = generateReport(mkInput({ category: c, pain: p, detail: '细节一、细节二、细节三、细节四' }));
    const u = new Set(r.matrix.map(m => m.script[0].l)).size;
    if (u < hookWorst) { hookWorst = u; hookWhere = c + '/' + p; }
  }));
  ok(hookWorst >= 6, `钩子多样性 ${hookWorst}/8（曾只有 3）`, hookWorst + ' @ ' + hookWhere);
  const kbSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  const hookLists = (kbSrc.match(/hooks: \[([^\]]*)\]/g) || []);
  const minHooks = Math.min(...hookLists.map(s => (s.match(/'[^']*'/g) || []).length));
  ok(hookLists.length >= 13 && minHooks >= 5, `${hookLists.length} 个品类钩子均 ≥5 条`, '最少 ' + minHooks + ' 条');

  /* ---------- T21 id 唯一性（回归：Date.now() 同毫秒会撞 id） ---------- */
  sec('T21 报告 id 唯一性');
  ok(/function newId\(\)/.test(appSrc), '有独立的新 id 生成函数');
  ok(!/id:\s*'r'\s*\+\s*Date\.now\(\)/.test(appSrc), '不再用裸 Date.now() 作 id');
  const idMakers = (appSrc.match(/function newId\(\)\s*\{[\s\S]{0,320}?\n\}/) || [''])[0];
  ok(/Math\.random/.test(idMakers), 'id 含随机成分');
  ok(/Date\.now/.test(idMakers), 'id 保留时间前缀（历史按时间排序仍成立）');
  // 导入时去重
  ok(/seenIn|dedup/.test(appSrc), '导入时对重复 id 去重');

  /* ---------- T22 无障碍 + 提示条 + 首次引导 ---------- */
  sec('T22 无障碍与提示');
  const htmlSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const cssAll = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

  // 键盘可达：之前只有输入框有焦点样式，Tab 到按钮上完全看不出焦点
  ok(/:focus-visible\{[^}]*outline/.test(cssAll), '有全局 focus-visible 轮廓');
  ok(/\.btn:focus-visible/.test(cssAll) && /\.nav-btn:focus-visible/.test(cssAll), '按钮与导航有焦点样式');
  ok(/\.skip:focus/.test(cssAll) && /class="skip/.test(htmlSrc), '有跳转到主内容的快捷链接');
  ok(/id="set-close" aria-label/.test(htmlSrc), '关闭按钮有 aria-label');
  ok(/<a class="logo"[^>]*tabindex="0"/.test(htmlSrc), 'logo 可键盘聚焦');
  ok(/role="dialog" aria-modal="true" aria-labelledby/.test(htmlSrc), '设置弹窗有 dialog 语义');
  ok(/aria-haspopup="dialog"/.test(htmlSrc), '触发按钮声明弹窗类型');
  ok((htmlSrc.match(/aria-live="polite"/g) || []).length >= 2, '有 live region 供读屏播报');
  ok(!/<img(?![^>]*alt=)/.test(htmlSrc), 'HTML 里 img 都带 alt');
  // JS 侧：Esc 关闭 + 焦点归还 + 非按钮可点区域支持键盘
  ok(/addEventListener\('keydown'[\s\S]{0,200}Escape/.test(appSrc), 'Esc 关闭弹窗');
  ok(/lastFocused/.test(appSrc) && /lastFocused\.focus\(\)/.test(appSrc), '关闭弹窗后焦点归还');
  ok(/e\.key !== 'Enter'/.test(appSrc) && /closest\('\.recent'\)/.test(appSrc), '最近报告卡片支持 Enter/Space');
  ok(/role="button" tabindex="0"/.test(appSrc), '渲染时补上可聚焦属性');
  ok(/prefers-reduced-motion[\s\S]{0,260}\.spinner\{animation:none\}/.test(cssAll), '减弱动效时停掉 spinner');

  // 提示条：关键提示不再用 alert 挡住报告
  ok(/function showNotes\(/.test(appSrc), '有统一提示条函数');
  ok(/id="report-notes"/.test(htmlSrc), '提示条容器存在');
  ok(/id="report-notes"[^>]*aria-live="polite"/.test(htmlSrc), '提示条容器是 live region');
  ok(/function openReport\(id\)[\s\S]{0,300}showNotes\(\[\]\)/.test(appSrc), '切换报告时清空旧提示');
  ok(/showNotes\(\[\]\)/.test(appSrc) && /notes: \w+: false/.test(appSrc) === false, '空提示会被过滤');
  ok(/data-note-close/.test(appSrc), '提示条可手动关闭');
  // 三类提示内容都要覆盖
  ok(/大模型没调通/.test(appSrc), '含 AI 降级提示');
  ok(/这份报告没能存进历史/.test(appSrc), '含存储失败提示');
  ok(/图片没参与分析/.test(appSrc), '含视觉降级提示');
  ok(/模型名已自动更正/.test(appSrc), '含模型自动换名提示');
  // 首次引导
  ok(/id="start-guide"/.test(htmlSrc), '有首次使用引导');
  ok(/start-guide/.test(cssAll) && /\.sg-steps/.test(cssAll), '引导有样式');
  ok(/guide\.style\.display = list\.length \? 'none' : ''/.test(appSrc), '有历史时自动隐藏引导');
  // 提示条内容必须转义
  ok(/esc\(n\.title\)/.test(appSrc) && /esc\(n\.text\)/.test(appSrc), '提示条内容做了转义');

  /* ---------- T23 知识库搜索 ---------- */
  sec('T23 知识库搜索');
  const htmlAll = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(/id="kb-q"/.test(htmlAll), '有搜索输入框');
  ok(/id="kb-empty"/.test(htmlAll) && /id="kb-count"/.test(htmlAll), '有空态与结果计数');
  ok(/id="kb-chips"/.test(htmlAll), '有主题快捷筛选');
  ok(/function renderKB\(/.test(appSrc), '有渲染+筛选函数');
  ok(/function kbMatch\(/.test(appSrc) && /\.every\(t =>/.test(appSrc), '多词按 AND 匹配');
  ok(/\.map\(stripTags\)/.test(appSrc), '检索按去标签后的纯文本');
  // 高亮必须保留 b/code，同时转义其他 HTML（知识库内容将来可能被扩充）
  const hlSrc = (appSrc.match(/function kbHighlight\(text, terms\)[\s\S]{0,600}?\n\}/) || [''])[0];
  ok(/\(\?:b\|code\)/.test(hlSrc), '高亮只放行 b/code 标签');
  ok(/esc\(p\)/.test(hlSrc), '其余片段走 esc() 转义（回归：曾有 XSS）');
  // 检索词要当纯文本用，正则元字符必须先转义
  const safeLine = (hlSrc.match(/const safe = [^\n]+/) || [''])[0];
  ok(safeLine.includes('.*+?^') && safeLine.includes("'\\\\$&'"), '正则元字符被转义', safeLine.trim());
  ok(/<mark>/.test(hlSrc), '命中处用 <mark> 标注');
  ok(/\.kb-grid mark\{/.test(cssAll), 'mark 有高亮样式');
  ok(/:focus-visible\{[^}]*outline/.test(cssAll) && /\.kb-chip:focus-visible/.test(cssAll), '快捷筛选可键盘聚焦');
  ok(/type="search"/.test(htmlAll), '搜索框用 type=search（自带清除按钮）');
  // 主题标签走正则（支持 | 或关系），与搜索框的纯文本 AND 取交集
  ok(/function kbConditions\(/.test(appSrc), '有统一的检索条件构造');
  ok(/new RegExp\(chipRe, 'i'\)/.test(appSrc), '标签按正则匹配');
  ok(/conds\.every\(/.test(appSrc) && /kind === 're'/.test(appSrc), '两种条件取交集');
  ok(/kb-chip\.on\{/.test(cssAll), '选中的标签有激活样式');
  ok(/curChip = curChip === kw \? null : kw/.test(appSrc), '再次点击同一标签可取消');
  // 知识库规模与结构
  const kbArts = (appSrc.match(/const KB_ARTICLES = \[([\s\S]*?)\n\];/) || [''])[1];
  const artCount = (kbArts.match(/^    t: '/gm) || []).length;
  ok(artCount >= 14, `知识库 ${artCount} 篇（≥14）`);
  const thin = (kbArts.match(/items: \[([\s\S]*?)\n    \]/g) || []).filter(s => (s.match(/'/g) || []).length / 2 < 5);
  ok(thin.length === 0, '每篇至少 5 条要点', thin.length + ' 篇偏薄');
  const chipDefs = (appSrc.match(/const KB_CHIPS = \[([\s\S]*?)\n\];/) || [''])[1];
  const chipCount = (chipDefs.match(/\{ k:/g) || []).length;
  ok(chipCount >= 10, `主题标签 ${chipCount} 个（≥10）`);

  /* ---------- T24 数据沉淀（跨报告洞察） ---------- */
  sec('T24 数据沉淀');
  // 复盘表是自由文本，解析必须覆盖真实填法
  [['12.3%', 12.3], ['35％', 35], ['１２.３％', 12.3], ['1.2万', 12000],
   ['12.3k', 12300], ['3,200', 3200], ['12.3个百分点', 12.3], ['0.38', 0.38],
   ['5%', 5], ['', null], ['abc', null], ['--', null], ['N/A', null],
   [null, null], ['   ', null]
  ].forEach(([inp, exp]) => {
    ok(parseMetric(inp) === exp, 'parseMetric(' + JSON.stringify(inp) + ')', String(parseMetric(inp)) + ' 期望 ' + exp);
  });
  // 用中位数而不是均值：一条爆款不该改变结论
  ok(median([1, 2, 3, 100000]) === 2.5, '中位数不被爆款拉偏', String(median([1, 2, 3, 100000])));
  ok(median([]) === null && median([5]) === 5, '中位数边界');

  // 样本不足时绝不下结论
  ok(buildInsights([]).enough === false, '无历史不下结论');
  ok(buildInsights([{ review: { '1': { a: '5%', b: '2%' } }, report: { matrix: [{ idx: 1 }] } }]).enough === false,
    '仅 1 份报告不下结论');
  ok(buildInsights([{ review: { '1': { a: 'abc', b: 'xyz' } }, report: { matrix: [{ idx: 1 }] } }]).samples === 0,
    '非数字不计入样本');

  // 真实场景：好人群/坏人群跨 3 份报告聚合
  const mkRec = (id, rows) => ({
    id,
    report: { matrix: rows.map((r, i) => ({ idx: i + 1, audience: r.aud, scene: r.scene, buyPoint: r.buy })) },
    review: rows.reduce((o, r, i) => {
      const v = { a: r.a, b: r.b, note: r.note || '' };
      if (v.a || v.b || v.note) o[String(i + 1)] = v;
      return o;
    }, {})
  });
  const G_A = '25-45岁已婚有娃家庭主妇/主夫', B_A = '18-28岁追剧熬夜学生/租房青年', M_A = '22-35岁控糖控卡的办公室女性';
  const hist = [
    mkRec('h1', [{ aud: G_A, scene: '新手翻车场景｜给孩子吃被长辈说不健康', buy: '给老人孩子吃也放心', a: '45%', b: '9%' },
                 { aud: B_A, scene: '情绪场景｜深夜追剧不想有负罪感', buy: '想吃脆的但怕上火长胖', a: '12%', b: '0.8%' },
                 { aud: M_A, scene: '日常场景｜下午三点办公室犯困', buy: '不用担心开袋受潮', a: '30%', b: '4%' }]),
    mkRec('h2', [{ aud: G_A, scene: '新手翻车场景｜给孩子吃被长辈说不健康', buy: '给老人孩子吃也放心', a: '52%', b: '11%' },
                 { aud: B_A, scene: '情绪场景｜深夜追剧不想有负罪感', buy: '想吃脆的但怕上火长胖', a: '9%', b: '0.5%' },
                 { aud: M_A, scene: '日常场景｜下午三点办公室犯困', buy: '不用担心开袋受潮', a: '28%', b: '3.5%' }]),
    mkRec('h3', [{ aud: G_A, scene: '新手翻车场景｜给孩子吃被长辈说不健康', buy: '给老人孩子吃也放心', a: '48%', b: '10%' },
                 { aud: B_A, scene: '情绪场景｜深夜追剧不想有负罪感', buy: '想吃脆的但怕上火长胖', a: '14%', b: '1.1%' }])
  ];
  const ins = buildInsights(hist);
  ok(ins.enough === true, '3 份报告足够下结论', ins.reports + ' 份 / ' + ins.samples + ' 组');
  ok(ins.audience[0].key === G_A, '好人群排第一', ins.audience.map(a => a.label + ':' + a.medA).join(' | '));
  ok(ins.audience[ins.audience.length - 1].key === B_A, '差人群排最后');
  ok(ins.win.has(G_A) && ins.lose.has(B_A), '好/差人群分别进 win / lose 集');
  ok(ins.scene.length > 0 && ins.buy.length > 0, '场景与买点也有聚合结果', ins.scene.length + '/' + ins.buy.length);

  // 爆款不污染结论
  const ins2 = buildInsights(hist.concat([mkRec('h4', [{ aud: B_A, scene: '情绪场景｜深夜追剧不想有负罪感', buy: '想吃脆的但怕上火长胖', a: '99%', b: '30%' }])]));
  const bad = ins2.audience.find(a => a.key === B_A);
  ok(bad.medA <= 20, '一条爆款不改变中位数判断', bad.label + ' 中位 ' + bad.medA);

  // 应用到新报告：打标签 + 行动清单优先推荐已验证的
  const insRep = generateReport(mkInput({ category: '零食' }), { insights: ins });
  ok(insRep.matrix.every(m => 'proven' in m), '每个组合都有 proven 字段');
  const wins = insRep.matrix.filter(m => m.proven && m.proven.level === 'win');
  ok(wins.length > 0, '有组合被标为已验证', wins.length + ' 组');
  if (wins.length) {
    const topIdx = parseInt(String(insRep.actions[0].what).match(/第(\d+)组/)[1], 10);
    const topMx = insRep.matrix.find(m => m.idx === topIdx);
    ok(topMx && topMx.proven && topMx.proven.level === 'win',
      '行动清单第 1 条优先选已验证组合', insRep.actions[0].what.slice(0, 40));
    ok(insRep.actions[0].what.includes('历史已验证'), '行动项注明来自历史数据');
  }
  const plainRep = generateReport(mkInput());
  ok(plainRep.actions[0].what.indexOf('（历史') === -1, '无洞察时行动清单不含历史标注');
  ok(plainRep.insights === null || plainRep.insights.hits === 0, '无洞察参数时结果为空');

  // 给大模型的文字结论
  const brief = insightsBrief(ins);
  ok(brief.includes(G_A) && brief.includes('不要编造'), 'brief 含结论与防编造约束');
  ok(brief.includes(String(ins.samples)), 'brief 注明样本量');
  ok(insightsBrief(buildInsights([])) === '' && insightsBrief(null) === '', '无数据时 brief 为空');

  // 脏数据
  let insCrashed = false;
  [null, undefined, {}, { report: null }, { report: { matrix: null } }, { report: { matrix: [null] } }].forEach(d => {
    try { buildInsights([d]); } catch (e) { insCrashed = true; }
  });
  ok(!insCrashed, '脏历史记录不抛错');

  // 接入点
  const insHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(/<script src="insights\.js">/.test(insHtml), 'insights.js 已引入');
  ok(insHtml.indexOf('insights.js') < insHtml.indexOf('app.js'), '加载顺序：insights 在 app 之前');
  ok(/insightsBrief\(ins\)/.test(appSrc) || /brief = insightsBrief/.test(appSrc), 'app 调用了 insightsBrief');
  ok(/class="ins-grid"/.test(appSrc), '报告里有数据沉淀面板');
  ok(/class="proven/.test(appSrc), '矩阵卡有历史验证标签');
  ok(/historyBrief|historyNote/.test(fs.readFileSync(path.join(__dirname, 'llm.js'), 'utf8')), '提示词带历史结论');

  /* ---------- T25 品类库完整性 ---------- */
  sec('T25 品类库');
  ok(typeof KB !== 'undefined' && Array.isArray(KB), 'KB 可访问');
  ok(KB.length >= 16, `品类数 ${KB.length}（≥16）`);
  const catBad = [];
  KB.forEach(c => {
    const w = c.name;
    if (!c.match || c.match.length < 5) catBad.push(w + ':关键词<5');
    if (!c.audiences || c.audiences.length !== 3) catBad.push(w + ':人群≠3');
    (c.audiences || []).forEach((a, i) => {
      if (['主攻', '次攻', '观察'][i] !== a.tag) catBad.push(w + ':人群' + i + ' tag 顺序错');
      ['match', 'pain', 'ease', 'pay', 'size'].forEach(k => {
        if (typeof (a.base || {})[k] !== 'number') catBad.push(w + ':人群' + i + ' 缺 base.' + k);
      });
      if (!a.why || a.why.length < 20) catBad.push(w + ':人群' + i + ' why 太短');
    });
    ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
      if (!c.dims || !Array.isArray(c.dims[k]) || c.dims[k].length < 3) catBad.push(w + ':dims.' + k + '<3');
    });
    if (!c.scenes || c.scenes.length < 4) catBad.push(w + ':场景组<4');
    (c.scenes || []).forEach(g => {
      if (!g.k || !g.items || !g.items.length) catBad.push(w + ':场景组不完整');
      (g.items || []).forEach(it => { if (!it.n || !it.ins || !it.use) catBad.push(w + ':场景项缺字段'); });
    });
    if (!c.buy || c.buy.length < 5) catBad.push(w + ':买点<5');
    if (c.buy && new Set(c.buy.map(b => b.b)).size !== c.buy.length) catBad.push(w + ':买点文案重复');
    if (!c.hooks || c.hooks.length < 6) catBad.push(w + ':钩子<6');
    if (c.hooks && new Set(c.hooks).size !== c.hooks.length) catBad.push(w + ':钩子重复');
    if (!c.props || c.props.length < 4) catBad.push(w + ':素材<4');
  });
  ok(catBad.length === 0, `全部 ${KB.length} 个品类结构合规`, catBad.slice(0, 4).join(' | '));
  // 关键词不能被两个品类同时认领
  const allWords = KB.flatMap(c => c.match);
  ok(new Set(allWords).size === allWords.length, '品类关键词无重叠', allWords.length + ' 个');
  // 新增品类必须能被正确命中
  [['办公文具', '办公文具'], ['笔记本', '办公文具'], ['硒鼓', '办公文具'],
   ['汽车用品', '汽车用品'], ['车载脚垫', '汽车用品'], ['露营', '户外运动'], ['冲锋衣', '户外运动'],
   ['生鲜', '食品生鲜'], ['车厘子', '食品生鲜'], ['冷冻海鲜', '食品生鲜']
  ].forEach(([inp, exp]) => {
    ok(matchCategory(inp).name === exp, '「' + inp + '」→ ' + exp, matchCategory(inp).name);
  });

  /* ---------- T26 零拍摄术语（本项目只服务 AI 视频生成，不服务真人拍摄） ---------- */
  sec('T26 零拍摄术语');
  const SHOOT_WORDS = ['拍摄', '实拍', '机位', '一镜到底', '同期声', '补拍', '打光',
    '构图三分法', '浅景深', '架三脚架', '打屏', '棚拍', '素材清单', '拍摄成本'];
  // engine.js 全文不应出现（注释里作为禁用词列举的除外）
  const engSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  const engLines = engSrc.split('\n');
  const engHit = [];
  let inComment = false;
  engLines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('/*')) inComment = true;
    // 注释里提到这些词，是在说明"已移除/不使用"，属于合理保留
    if (inComment || t.startsWith('//') || t.startsWith('*')) {
      if (t.endsWith('*/')) inComment = false;
      return;
    }
    SHOOT_WORDS.forEach(w => { if (l.includes(w)) engHit.push('engine.js:' + (i + 1) + ' 「' + w + '」'); });
  });
  ok(engHit.length === 0, 'engine.js 无拍摄术语', engHit.slice(0, 3).join(' | '));

  // 生成的报告内容（prompt + 分镜画面）也不能有
  const reportHit = [];
  CATS.forEach(c => {
    const r = generateReport(mkInput({ category: c, detail: '细节一、细节二、细节三' }));
    r.matrix.forEach(m => {
      const txt = m.prompt + ' ' + m.script.map(s => s.v).join(' ');
      SHOOT_WORDS.forEach(w => { if (txt.includes(w)) reportHit.push(c + '/#' + m.idx + ' 「' + w + '」'); });
    });
    r.scenes.forEach(s => {
      SHOOT_WORDS.forEach(w => { if (String(s.why || '').includes(w)) reportHit.push(c + ' 场景why 「' + w + '」'); });
    });
  });
  ok(reportHit.length === 0, `${CATS.length} 品类生成的提示词与画面描述无拍摄术语`, reportHit.slice(0, 3).join(' | '));

  // 场景结构：tone 取代 cost
  ok(typeof dep.scenes[0].tone === 'string' && dep.scenes[0].tone, '场景带色调 tone');
  ok(dep.scenes[0].cost === undefined, '场景不再有 cost 字段');
  // 提示词结构：三段式
  const anyPrompt = dep.matrix[0].prompt;
  ['【① 剧情梗概】', '【② 分镜画面提示】', '【③ 整体风格】'].forEach(s => {
    ok(anyPrompt.includes(s), '提示词含 ' + s);
  });
  ok(!/文生图|图生视频|拍摄备注|字幕节奏/.test(anyPrompt), '已移除旧的分段标题');
  // 画面描述要含 AI 生成用得上的要素
  ok(/光线：/.test(anyPrompt) && /运镜：/.test(anyPrompt) && /环境：/.test(anyPrompt),
    '每条分镜含环境/光线/运镜三要素');
  ok(/画面文字/.test(anyPrompt), '含画面文字（叠字）');
  // v 列改成画面描述
  ok(dep.matrix[0].script.every(s => s.v && s.v.length > 10), '分镜 v 列有画面描述');
  ok(dep.matrix[0].script.some(s => /自然光|侧光|顶光|均匀|暖调|冷调/.test(s.v)), 'v 列含光线描述');

  /* ---------- T27 产品名称（画面主体要具体，不能是品类名） ---------- */
  sec('T27 产品名称');
  // 品类库里每个品类都要有具体主体
  const noProd = KB.filter(c => !c.prod || c.name === c.prod);
  ok(noProd.length === 0, `全部 ${KB.length} 个品类都有具体画面主体 prod`, noProd.map(c => c.name).join(', '));
  ok(KB.every(c => /^(一|这)/.test(c.prod || '')), 'prod 用量词开头（一箱水果 / 一支笔）');

  // 用户填了产品名就用用户的
  const named = generateReport(Object.assign(mkInput(), { category: '食品生鲜', prodName: '智利车厘子 JJ级 2斤装' }));
  ok(named.meta.prodName === '智利车厘子 JJ级 2斤装', 'meta 记录用户填的产品名', named.meta.prodName);
  ok(named.matrix.every(m => /画面主体是智利车厘子/.test(m.prompt)), '所有分镜都用该产品名做画面主体');
  ok(named.matrix.some(m => /画面主体是智利车厘子 JJ级 2斤装，静置/.test(m.prompt) || /智利车厘子 JJ级 2斤装静置/.test(m.prompt)),
    '结尾分镜也用该产品名');

  // 不填则回退到品类库的通用主体
  const fallback = generateReport(Object.assign(mkInput(), { category: '食品生鲜' }));
  ok(fallback.meta.prodName === '一箱水果/一份生鲜食材', '不填时用品类库默认主体', fallback.meta.prodName);
  ok(!/画面主体是食品生鲜/.test(fallback.matrix[0].prompt), '不再用品类名当画面主体');
  const catFallback = generateReport(mkInput({ category: '' }));
  ok(!!catFallback.meta.prodName, '空品类也有兜底主体', catFallback.meta.prodName);

  // AI 路径同样要带上
  const aiNamed = normalizeReport({ summary: {} }, Object.assign(mkInput(), { category: '美妆', prodName: 'Dior 999 哑光唇釉' }));
  ok(aiNamed.meta.prodName === 'Dior 999 哑光唇釉', 'AI 路径也记录产品名', aiNamed.meta.prodName);
  ok(/画面主体是Dior 999 哑光唇釉/.test(aiNamed.matrix[0].prompt), 'AI 兜底提示词用该产品名');

  // 品类匹配：上位词不能赢过下位词
  ok(matchCategory('食品生鲜').name === '食品生鲜', '「食品生鲜」不被「食品」抢走', matchCategory('食品生鲜').name);
  ok(matchCategory('食品').name === '零食', '单独的「食品」仍归零食');
  [['生鲜', '食品生鲜'], ['水果', '食品生鲜'], ['冷冻海鲜', '食品生鲜'], ['零食', '零食'], ['坚果', '零食'],
   ['笔记本', '办公文具'], ['车载脚垫', '汽车用品'], ['露营', '户外运动'], ['渔具', '通用商品']
  ].forEach(([inp, exp]) => ok(matchCategory(inp).name === exp, '「' + inp + '」→ ' + exp, matchCategory(inp).name));

  // 画面文字不要太长
  const longShot = generateReport(Object.assign(mkInput(), { category: '食品生鲜', selling: '产地直发当日采当日发冷链发货坏果包赔无条件退' }));
  const texts = [...longShot.matrix[0].prompt.matchAll(/「([^」]*)」/g)].map(m => m[1]);
  ok(texts.every(t => t.length <= 13), '画面文字长度受控', texts.map(t => t.length).join(','));

  // 表单字段存在
  const html27 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(/id="f-prodname"/.test(html27), '有产品名称输入框');
  ok(/f-prodname/.test(appSrc), '产品名进了草稿字段');
  ok(/prodName: \$|prodName: input\.prodName/.test(appSrc), '产品名进了提交参数');
  ok(/prodName/.test(fs.readFileSync(path.join(__dirname, 'llm.js'), 'utf8')), '产品名进了大模型提示词');
  // 导出也要带产品名
  const namedDoc = toWordHtml(named);
  ok(namedDoc.includes('智利车厘子'), 'Word 导出含产品名');
  ok(toMarkdown(named).includes('智利车厘子'), 'Markdown 导出含产品名');
  // 导出不得有拍摄术语
  const EXP_BAD = ['拍摄', '实拍', '机位', '一镜到底', '打光', '浅景深', '构图三分法', '字幕节奏', '文生图', '图生视频'];
  ok(!EXP_BAD.some(w => namedDoc.includes(w)), 'Word 导出无拍摄术语', EXP_BAD.filter(w => namedDoc.includes(w)).join(','));
  ok(!EXP_BAD.some(w => toMarkdown(named).includes(w)), 'Markdown 导出无拍摄术语', EXP_BAD.filter(w => toMarkdown(named).includes(w)).join(','));

  /* ---------- T28 跨镜头一致性（AI 逐段生成，不给锚点会出 5 个不同的人） ---------- */
  sec('T28 一致性锚点');
  const cp = generateReport(Object.assign(mkInput(), { category: '美妆', prodName: 'Dior 999 哑光唇釉 蜜桃色' })).matrix[0].prompt;
  ok(/【④ 一致性锚点】/.test(cp), '提示词含第 ④ 段一致性锚点');
  ok(/人物：/.test(cp) && /商品：/.test(cp), '锚点给出人物与商品描述');
  ok(/五官、发型、衣着/.test(cp), '明确要求人物一致');
  ok(/形状、颜色、logo/.test(cp), '明确要求商品一致');
  ok(/主光/.test(cp) && /阴影方向不变/.test(cp), '光线方向统一');
  // 三段式变四段式
  ['【① 剧情梗概】', '【② 分镜画面提示】', '【③ 整体风格】', '【④ 一致性锚点】'].forEach(s => {
    ok(cp.includes(s), '含 ' + s);
  });

  // 人物推导：年龄与身份不能自相矛盾
  const anchorBad = [];
  KB.forEach(c => c.audiences.forEach(a => {
    const p = personAnchor(a.name);
    const seniorName = /(中老年|祖辈|长辈|退休|50\s*岁以上)/.test(a.name);
    if (seniorName && /岁的年轻人/.test(p)) anchorBad.push(a.name + ' → ' + p);
    if (!seniorName && /岁的成年人/.test(p)) anchorBad.push(a.name + ' → ' + p);
    if (!/一位.+的/.test(p)) anchorBad.push(a.name + ' 年龄缺失');
    if (!/(穿|状态)/.test(p)) anchorBad.push(a.name + ' 缺衣着/状态');
    if (/不化妆.*黑色短发/.test(p)) anchorBad.push(a.name + ' 年长却写黑色短发');
  }));
  ok(anchorBad.length === 0, `${KB.length} 个品类全部人群的人设无矛盾`, anchorBad.slice(0, 3).join(' | '));

  // 有年龄区间时取中值；没有时按身份推断，不该一律 30 岁
  ok(/一位33岁左右的女性/.test(personAnchor('25-40岁成分党上班族女性')), '取年龄区间中值', personAnchor('25-40岁成分党上班族女性'));
  ok(/20-25岁/.test(personAnchor('备考学生与考公人群')), '学生按身份推 young', personAnchor('备考学生与考公人群'));
  ok(/55-70岁/.test(personAnchor('祖辈代买（爷爷奶奶）')), '长辈按身份推年长', personAnchor('祖辈代买（爷爷奶奶）'));
  ok(/穿卫衣的学生/.test(personAnchor('备考学生与考公人群')), '学生穿卫衣');
  ok(/穿衬衫的上班族/.test(personAnchor('22-35岁固定坐班的职场人')), '职场穿衬衫');
  ok(/穿家居服的母亲/.test(personAnchor('28-45岁宝妈（显瘦遮肉需求）')), '宝妈穿家居服');

  // 商品锚点：产品名里的颜色/材质要被识别
  ok(/黑色/.test(productAnchor('黑色65W氮化镓充电宝')), '识别产品名中的颜色');
  ok(/玻璃材质/.test(productAnchor('玻璃保鲜盒')), '识别产品名中的材质');
  ok(/不锈钢材质/.test(productAnchor('不锈钢保温杯')), '识别不锈钢');
  ok(/外观与包装在各段中完全一致/.test(productAnchor('任意产品')), '商品锚点含一致性要求');

  // AI 兜底路径也要有第 ④ 段
  const aiCp = normalizeReport({ summary: {} }, Object.assign(mkInput(), { category: '美妆', prodName: 'Dior 999 哑光唇釉' })).matrix[0].prompt;
  ok(/【④ 一致性锚点】/.test(aiCp), 'AI 兜底提示词也含一致性锚点');
  ok(/人物：/.test(aiCp), 'AI 兜底含人物描述');
  ok(!/拍摄/.test(aiCp), 'AI 兜底无拍摄术语');

  // 提示词层要求 AI 也输出这一段
  ok(/一致性锚点/.test(fs.readFileSync(path.join(__dirname, 'llm.js'), 'utf8')), 'llm 提示词要求输出一致性锚点');

  /* ---------- T29 英文版提示词（Sora / Runway / Veo 英文优先） ---------- */
  sec('T29 英文版提示词');
  const en = generateReport(Object.assign(mkInput(), { category: '美妆', prodName: 'Dior 999 哑光唇釉 蜜桃色' })).matrix[0].promptEn;
  ['【① VOICEOVER】', '【② SHOT PROMPTS — EN】', '【③ GLOBAL STYLE — EN】', '【④ CONSISTENCY ANCHOR — EN】'].forEach(s => {
    ok(en.includes(s), '英文版含 ' + s);
  });
  ['0-3s', '3-8s', '8-15s', '15-22s', '22-28s'].forEach(t => ok(en.includes(t), '英文版时间轴 ' + t));
  ok(/Character:/.test(en), '英文锚点有 Character');
  ok(/Product:/.test(en), '英文锚点有 Product');
  ok(/shadow direction never changes/.test(en), '英文锚点统一阴影方向');
  ok(/Negative:/.test(en) && /watermark/.test(en), '英文版有负面词');
  ok(/Vertical 9:16/.test(en), '英文版有画幅规格');
  // 画面文字要标明是中文，否则模型会渲出英文大字
  ok(/On-screen text \(Chinese\)/.test(en), '画面文字标注为中文');
  // 商品名保留不翻译
  ok(/Dior 999/.test(en), '商品名保留原样');
  ok(/CHINESE: Dior 999/.test(en), '中文残留标为 [CHINESE:] 待替换');

  // 英文正文（排除 [CHINESE:] 标注）不能残留中文拍摄术语
  const enBody = en.replace(/\[CHINESE[^\]]*\]/g, '').split('【②')[0];
  ok(!/拍摄|实拍|机位|一镜到底|补拍|打光/.test(enBody), '英文正文无拍摄术语');

  // 英文人设语法：a/an + 连字符，不能是 "a early" 或 "a 33-year-old"
  const enBad = [];
  KB.forEach(c => c.audiences.forEach(a => {
    const p = personAnchorEn(a.name);
    if (/\ba [aeiou]/.test(p)) enBad.push('冠词应为 an: ' + p);
    if (/\ban [^aeiou]/.test(p)) enBad.push('冠词应为 a: ' + p);
    if (/\d-year-old/.test(p)) enBad.push('年龄应写 early 30s: ' + p);
    if (!/^(a|an) (early|mid|late) \d+s /.test(p)) enBad.push('年龄段缺冠词: ' + p);
    if (/(中老年|祖辈|长辈|退休|50\s*岁以上)/.test(a.name) && !/no makeup/.test(p)) enBad.push('年长缺不化妆: ' + p);
    if (/(中老年|祖辈|长辈|退休|50\s*岁以上)/.test(a.name) && /young adult|woman/.test(p)) enBad.push('年长误判年轻: ' + p);
  }));
  ok(enBad.length === 0, `${KB.length} 个品类英文人设语法与年龄一致`, enBad.slice(0, 3).join(' | '));

  ok(personAnchorEn('25-40岁成分党上班族女性') === 'an early 30s woman wearing a button-up shirt, shoulder-length dark hair, natural brows, light makeup', '英文人设样例', personAnchorEn('25-40岁成分党上班族女性'));
  ok(/an early 60s adult/.test(personAnchorEn('祖辈代买（爷爷奶奶）')), '长辈英文年长');
  ok(/an early 20s young adult/.test(personAnchorEn('备考学生与考公人群')), '学生英文年轻');

  // 证据画面英译：不能出现 "Macro shot of ... shots" 这种叠加
  ['产品检测报告', '两款对比参数表', '真实买家评价截图', '使用前后对比图'].forEach(p => {
    const s = enProofVisual(p);
    ok(!!s && !/shots/.test(s) && /^[\x20-\x7E]+$/.test(s), `证据画面英译「${p}」→ ${s}`);
  });
  ok(enProp('产品特写') === 'sharp detail macro shots', '素材特写英译');
  ok(enProp('使用演示') === 'clear in-use demonstration shots', '素材演示英译');

  // AI 给了 promptEn 就用模型的；没给退回本地模板，两条路径都不为空
  const aiEn = normalizeReport({
    matrix: [{ audience: '测试人群', scene: '测试场景', sellPoint: '卖点', story: '一段故事',
      prompt: '中文四段', promptEn: '【② SHOT PROMPTS — EN】from the model' }]
  }, mkInput());
  ok(aiEn.matrix[0].promptEn === '【② SHOT PROMPTS — EN】from the model', 'AI 给的 promptEn 优先');
  const aiEn2 = normalizeReport({ matrix: [{ audience: '测试人群', scene: '核心场景', sellPoint: '卖点', story: '一段故事', prompt: '中文四段' }] }, mkInput());
  ok(/SHOT PROMPTS — EN/.test(aiEn2.matrix[0].promptEn), 'AI 没给 promptEn 时本地英文模板兜底');
  ok(/CONSISTENCY ANCHOR — EN/.test(aiEn2.matrix[0].promptEn), '兜底英文版也有锚点');

  // 导出与 UI 都要带上英文版（导出函数吃的是报告，不是输入）
  const enRep = generateReport(Object.assign(mkInput(), { category: '美妆' }));
  ok(/视频生成提示词（EN/.test(toMarkdown(enRep)), 'Markdown 导出含英文版');
  ok(/视频生成提示词/.test(toWordHtml(enRep)), 'Word 导出含提示词');
  ok(/<pre lang="en">/.test(toWordHtml(enRep)), 'Word 导出英文版带 lang 属性');
  ok(/data-copy-prompt/.test(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')), 'UI 有复制当前语言提示词按钮');
  ok(/lang-sw/.test(fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8')), 'UI 有语言切换样式');

  /* ---------- T30 内容策略类型分工（抖音六大模板 + 黄金三秒产品露出） ---------- */
  sec('T30 内容策略类型分工');
  const r30 = generateReport(Object.assign(mkInput(), { category: '食品生鲜', prodName: '零添加老抽 16块 500ml' }));

  // 六类模板齐全，且 8 组不是同一条的 8 个变体
  const types = [...new Set(r30.matrix.map(m => m.type))];
  ok(types.length >= 5, `8 组覆盖 ${types.length} 种内容类型`, types.join('/'));
  ['剧情', '痛点', '场景', '种草', '促销', '证据'].forEach(t => ok(types.includes(t), '含「' + t + '」类'));

  // 角色分层：1 个核心方向 + 辅助方向
  ok(r30.matrix.filter(m => m.typeRole === '核心方向').length === 1, '有且只有 1 个核心方向');
  ok(r30.matrix.filter(m => m.typeRole === '辅助方向').length >= 3, '辅助方向 ≥3 个');
  ok(r30.typePlan && r30.typePlan.length === types.length, 'typePlan 覆盖所有类型');

  // 黄金三秒：每组开头都必须认出产品，且 hookKind 有分类
  const kinds = ['产品露出', '痛点', '情感共鸣', '直观效果', '猎奇'];
  r30.matrix.forEach(m => {
    ok(m.hookRevealsProduct === true, `第${m.idx}组开头认出产品`);
    ok(kinds.includes(m.hookKind), `第${m.idx}组钩子分类合法：${m.hookKind}`);
  });

  // 画面大字必须带商品前缀，且 8 组不能雷同
  const bigs = r30.matrix.map(m => {
    const line = (m.prompt.split('\n').find(l => l.indexOf('画面文字') >= 0) || '');
    const mm = line.match(/「([^」]+)」/);
    return mm ? mm[1] : '';
  });
  ok(bigs.every(t => t && mentionsProduct(t, '零添加老抽 16块 500ml')), '每组画面大字都含商品名', bigs.join(' | '));
  ok(bigs.every(t => t.length <= 13), '画面大字仍受长度约束', bigs.map(t => t.length).join(','));
  ok(new Set(bigs).size >= 6, `8 组画面大字不雷同（${new Set(bigs).size} 种）`, bigs.join(' | '));

  // 拉丁品牌名不能被 2 字前缀误判（"Dior" 含 "Di"，别把 "Dior 999 哑光唇釉" 截成 "Dior"）
  ok(mentionsProduct('Dior 999 哑光唇釉 蜜桃色', 'Dior 999 哑光唇釉 蜜桃色'), '拉丁名整段算出露出');
  ok(!mentionsProduct('迪奥的哑光唇釉', 'Dior 999 哑光唇釉'), '中文别名不算认出拉丁名');
  ok(mentionsProduct('零添加老抽很好喝', '零添加老抽 16块'), '中文取前 2 字');
  ok(shotTextThatReveals('零添加老抽，这箱东西我自己先吃了一斤', '零添加老抽 16块 500ml').indexOf('零添加老抽') === 0, '商品名在句首');

  // 人群 × 类型匹配：要证据才信的人群不能被派到剧情类（老抽配搞笑婆媳跑不动那类问题）
  ok(isSlowHeat('50岁以上自用中老年'), '中老年人群判定为先看证据');
  ok(isSlowHeat('商务人群决策者'), '商务人群判定为先看证据');
  ok(isSlowHeat('25-40岁成分党上班族女性'), '成分党判定为先看证据');
  ok(isSlowHeat('35-60岁关注父母健康的子女'), '代买/孝心人群判定为先看证据');
  ok(!isSlowHeat('18-28岁追剧熬夜学生/租房青年'), '年轻人不算先看证据');
  ok(!isSlowHeat('28-45岁有孩家庭的采购者'), '普通宝妈不算先看证据');
  ok(typeAlt('25-40岁成分党上班族女性') === '证据', '成分党改走证据类', typeAlt('25-40岁成分党上班族女性'));
  ok(typeAlt('50岁以上自用中老年') === '痛点', '中老年改走痛点类', typeAlt('50岁以上自用中老年'));

  // 实际派型结果：慢热人群拿不到剧情类，且报告里写明改了什么
  const r30b = generateReport(Object.assign(mkInput(), { category: '保健品', prodName: '鱼油 90粒' }));
  const slowHeatRows = r30b.matrix.filter(m => isSlowHeat(m.audience));
  ok(slowHeatRows.length > 0, '报告里有慢热人群');
  ok(slowHeatRows.every(m => m.type !== '剧情'), '慢热人群没被派到剧情类', slowHeatRows.map(m => m.type).join('/'));
  const warned = r30b.matrix.filter(m => m.fitWarn);
  ok(warned.length > 0, '至少有一条类型改配说明', warned.map(m => m.fitWarn).join(' | '));
  ok(warned.every(m => m.audience && m.audience.length > 0 && /类/.test(m.fitWarn)), '说明里含人群与落地类型', warned.map(m => m.fitWarn).join(' | '));
  // 非慢热人群仍然要有剧情类，否则策略少了一条最容易起量的方向
  ok(r30b.matrix.some(m => m.type === '剧情'), '非慢热人群仍有剧情类');
  // 全 16 品类都不能把慢热人群派到剧情类
  const leak = [];
  KB.forEach(c => generateReport(Object.assign(mkInput(), { category: c.name, prodName: c.prod })).matrix.forEach(m => {
    if (m.type === '剧情' && isSlowHeat(m.audience)) leak.push(c.name + '→' + m.audience);
  }));
  ok(leak.length === 0, '全 16 品类慢热人群都不跑剧情类', leak.slice(0, 3).join(' | '));

  // 导出与 UI 都要带类型分工
  ok(/内容策略分工/.test(toMarkdown(r30)), 'Markdown 导出含内容策略分工表');
  ok(/类型分工/.test(toMarkdown(r30)), 'Markdown 每组带类型分工');
  const appSrc30 = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  ok(/plan-grid/.test(appSrc30) && /内容策略分工/.test(appSrc30), 'UI 有内容策略分工卡片');
  ok(/mx-strategy/.test(appSrc30), 'UI 每组矩阵有类型标签');
  ok(/tg-剧情/.test(fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8')), 'UI 有类型配色');

  // AI 路径也要带类型字段，不能因为走模型就丢了策略分工
  const ai30 = normalizeReport({ matrix: [{ audience: '测试人群', scene: '测试场景', sellPoint: '卖点', story: '故事', prompt: '中文四段' }] }, mkInput());
  ok(!!ai30.matrix[0].promptEn, 'AI 路径兜底仍给英文版');

  /* ---------- T31 安全：转义、原型键、导入数据 ---------- */
  sec('T31 安全加固');

  // esc 必须转义引号：否则 placeholder="..." 里能拼出 onfocus=
  ok(/\\u0022|&quot;/.test(appSrc) || appSrc.includes('.replace(/"/g, \'&quot;\')'), 'esc 转义双引号');
  ok(appSrc30.includes(".replace(/'/g, '&#39;')"), 'esc 转义单引号');
  // 不能出现未转义就进 innerHTML 的写法
  const rawSinks = [];
  if (/class="tg tg-\$\{esc/.test(appSrc30) === false) rawSinks.push('tg-类型未走 esc');
  if (/data-row="\$\{x\.idx\}"/.test(appSrc30)) rawSinks.push('data-row 未转义 idx');
  if (/data-open="\$\{x\.id\}"/.test(appSrc30)) rawSinks.push('data-open 未转义 id');
  if (/<option value="\$\{x\.id\}"/.test(appSrc30)) rawSinks.push('option value 未转义 id');
  if (/<img src="\$\{x\.s\}"/.test(appSrc30)) rawSinks.push('img src 未转义');
  ok(rawSinks.length === 0, '所有属性/文本插值都走 esc', rawSinks.join(' | '));

  // 原型键：insights 用无原型累加器，否则人群名叫 toString 就抛错
  ok(/Object\.create\(null\)/.test(fs.readFileSync(path.join(__dirname, 'insights.js'), 'utf8')), 'insights 桶用 Object.create(null)');
  ok(/const vals = Object\.create\(null\)/.test(appSrc30), '复盘表用 Object.create(null)');
  ['toString', '__proto__', 'constructor', 'valueOf'].forEach(k => {
    let threw = false;
    try {
      buildInsights([{ id: 'r', report: { matrix: [{ idx: 1, audience: k, scene: '场景', buyPoint: '买点' }] }, review: { 1: { a: 30, b: 1000, note: '' } } }]);
    } catch (e) { threw = true; }
    ok(!threw, `人群名为 ${k} 时不崩`);
  });
  // 复盘聚合放在 try 内，否则一次脏数据就让界面永远卡在"生成中"
  ok(/try \{[\s\S]{0,400}insightsForNextRun\(\)/.test(appSrc30), 'insightsForNextRun 在 try 块内');

  // 备份导入的图片必须是 data:image，否则能往 <img src> 塞任意地址
  ok(/Array\.isArray\(v\)/.test(dbSrc31), 'ImgDB.put 强制数组');
  ok(/then\(r => r !== null\)/.test(dbSrc31), 'ImgDB 失败时不谎报成功');

  // Markdown 导出不能留下可执行的图片/链接
  const exSrc31 = fs.readFileSync(path.join(__dirname, 'export.js'), 'utf8');
  ok(/const num = v =>/.test(exSrc31), '导出层有数字字段强制');
  ok(exSrc31.includes('plain = s =>') && exSrc31.includes('\\$1'), 'plain 同时剥标签并转义 Markdown 标记');
  const mdEvil = toMarkdown(Object.assign(generateReport(Object.assign(mkInput(), { category: '美妆' })), {
    matrix: [{ ...generateReport(Object.assign(mkInput(), { category: '美妆' })).matrix[0],
      story: '正常\n\n![b](https://evil.example/p)\n\n[l](https://evil.example) <img src=x onerror=alert(1)' }]
  }));
  ok(!/!\[[^\]]*\]\(/.test(mdEvil), '导出的 .md 不含 markdown 图片');
  ok(!/\[[^\]]*\]\([^)]*\)/.test(mdEvil), '导出的 .md 不含 markdown 链接');
  ok(!/<img/i.test(mdEvil), '导出的 .md 不含 HTML 标签');

  // 模型返回的文本要有上限，否则几 MB 字符串会灌进渲染和正则
  ok(/const MAX_TEXT = \d+/.test(fs.readFileSync(path.join(__dirname, 'llm.js'), 'utf8')), '模型文本有长度上限');
  // flattenStory 不能有跨行 \s* 导致的 O(N²)
  const llmSrc31 = fs.readFileSync(path.join(__dirname, 'llm.js'), 'utf8');
  const flattenBlock = (llmSrc31.match(/function flattenStory[\s\S]*?return /) || [''])[0];
  ok(!/\^\\s\*\*/.test(flattenBlock), 'flattenStory 行首不用 \s*（避免二次方回溯）');
  const t0 = Date.now();
  coerceStory('\n'.repeat(60000), { sell: 'x', scene: 'y' });
  ok(Date.now() - t0 < 3000, '6 万换行的 story 不卡死（' + (Date.now() - t0) + 'ms）');

  /* ---------- T33 引擎加载自检 ---------- */
  sec('T33 引擎加载自检');
  // engine.js 的顶层符号是裸全局，没有 import。文件一没加载，
  // llm.js 里 22 个、app.js 里 3 个符号会 undefined，
  // 但要等到用户点「生成」才炸，而且会被 Promise 的 reject 吞成"生成失败"。
  ok(/ENGINE_REQUIRED/.test(appSrc30), 'app.js 有启动自检');
  ok(/engineSelfCheck/.test(appSrc30), '自检有独立函数');
  ok(/#form button\[type="submit"\]/.test(appSrc30), '自检禁用的是真实提交按钮（按钮没有 id，不能凭空造）');
  ok(/console\.error\(.+engine\.js/.test(appSrc30), '自检把缺失清单打进控制台');
  const html33 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(/id="engineMissing"/.test(html33), 'index.html 有提示位');
  ok(/engine-missing/.test(fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8')), '提示位有样式');
  // 自检列的符号必须真的是 engine.js 提供的，否则会误报
  const listBlock = (appSrc30.match(/ENGINE_REQUIRED\s*=\s*\[([\s\S]*?)\]/) || ['', ''])[1];
  const listed = listBlock.match(/'(\w+)'/g).map(s => s.replace(/'/g, ''));
  ok(listed.length >= 5, `自检清单有 ${listed.length} 项`);
  ok(listed.every(n => new RegExp('^(?:function|const|let)\\s+' + n + '\\b', 'm').test(
    fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8'))), '清单里的符号都确实由 engine.js 定义',
    listed.filter(n => !new RegExp('^(?:function|const|let)\\s+' + n + '\\b', 'm').test(
      fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8'))).join(','));
  // 清单要覆盖 app.js / llm.js 真实依赖的关键符号
  ok(listed.includes('generateReport') && listed.includes('assignStrategy') && listed.includes('buildTypePlan'),
    '清单覆盖了三条路径都要用的关键符号');

/* ---------- T32 AI 路径与本地路径字段一致（内容策略不能只在本地生效） ---------- */
  sec('T32 双路径一致性');
  const inp32 = Object.assign(mkInput(), { category: '美妆', prodName: 'Dior 999 哑光唇釉' });
  const rep32 = generateReport(inp32);
  // 模型正常返回 8 组、但不给任何策略字段
  const ai32 = normalizeReport({
    matrix: rep32.matrix.map((m, i) => ({
      audience: m.audience, scene: m.scene, sellPoint: m.sellPoint,
      buyPoint: m.buyPoint, story: '故事' + i, script: [],
      prompt: '画面文字：「测试钩子」'
    }))
  }, inp32);

  const miss32 = Object.keys(rep32.matrix[0]).filter(k => !(k in ai32.matrix[0]));
  ok(miss32.length === 0, 'AI 报告字段与本地一致', miss32.join(', '));
  ['type', 'typeRole', 'typeWhy', 'hookKind', 'hookRevealsProduct', 'fitWarn'].forEach(f =>
    ok(ai32.matrix.every(m => m[f] !== undefined), 'AI 报告每行都有 ' + f));
  ok(Array.isArray(ai32.typePlan) && ai32.typePlan.length > 0, 'AI 报告也有 typePlan（否则策略分工卡片不出现）',
    Array.isArray(ai32.typePlan) ? ai32.typePlan.length + ' 条' : 'undefined');
  // 8 组不能全标成同一类（界面兜底会把 undefined 变成"剧情"）
  ok(new Set(ai32.matrix.map(m => m.type)).size >= 5, 'AI 报告 8 组类型不雷同',
    ai32.matrix.map(m => m.type).join('/'));
  ok(ai32.matrix.filter(m => m.typeRole === '核心方向').length === 1, 'AI 报告也有且只有 1 个核心方向');
  ok(new Set(ai32.matrix.map(m => m.typeRole)).size >= 2, 'AI 报告角色分层存在',
    ai32.matrix.map(m => m.typeRole).join('/'));
  // 本地与 AI 用同一个 assignStrategy，所以同样的输入应得到同样的类型序列
  ok(ai32.matrix.map(m => m.type).join('/') === rep32.matrix.map(m => m.type).join('/'),
    '本地与 AI 的类型序列一致', ai32.matrix.map(m => m.type).join('/') + ' vs ' + rep32.matrix.map(m => m.type).join('/'));
  // 慢热人群在 AI 路径上同样不该拿剧情类
  const leak32 = ai32.matrix.filter(m => m.type === '剧情' && isSlowHeat(m.audience));
  ok(leak32.length === 0, 'AI 路径慢热人群也不跑剧情类', leak32.map(m => m.audience).join(' | '));
  // hookFromPrompt 能把画面文字反解回钩子
  ok(hookFromPrompt('0-3s — ...\n画面文字：顶部居中大字「不沾杯显色度高」') === '不沾杯显色度高', '从提示词反解钩子',
    hookFromPrompt('画面文字：顶部居中大字「不沾杯显色度高」'));
  ok(hookFromPrompt('没有任何画面文字') === '', '没有画面文字时返回空');
  // 导出与 UI 都能吃 AI 报告
  ok(/内容策略分工|类型分工/.test(toMarkdown(rep32)), 'Markdown 有策略分工');

  /* ---------- 汇总 ---------- */
  console.log('\n' + '═'.repeat(52));
  console.log(`  通过 ${pass} · 失败 ${fail} · 总计 ${pass + fail}`);
  console.log('═'.repeat(52));
  process.exit(fail ? 1 : 0);
})();