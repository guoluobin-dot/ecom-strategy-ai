/* ===========================================================
   数据沉淀：把各份报告的复盘数据汇总成可复用的结论
   ===========================================================
   复盘表填的数字是散落的，只有汇总起来才能回答三个问题：
     - 哪类人群的内容跑得动
     - 哪类场景更容易起量
     - 哪种买点翻译真的打动了人
   结论会反哺下一次生成：命中历史胜出的组合就标成"已验证"，
   明显跑不动的组合会被降优先级。样本太少的结论不下判断。
   =========================================================== */

/* 用户填的是自由文本：12.3% / 35％ / 1.2万 / 3,200 / abc。
   解析不出来就当没填，绝不猜 */
function parseMetric(raw) {
  if (raw == null) return null;
  let t = String(raw)
    .trim()
    .replace(/[,，\s]/g, '')
    .replace(/[０-９．％]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))  // 全角
    .replace(/%+$/, '')
    .replace(/(个百分点|个点)$/, '')
    .replace(/\+$/, '');
  if (!t) return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?)(万|w|k|千)?$/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (!isFinite(v)) return null;
  const u = (m[2] || '').toLowerCase();
  if (u === '万' || u === 'w') v *= 10000;
  else if (u === 'k' || u === '千') v *= 1000;
  return v;
}

/* 场景组名归一：报告里存的是"日常场景｜孩子放学回家喊饿"，
   聚合时只取前半截的场景类型 */
function sceneGroup(scene) {
  return String(scene || '').split('｜')[0].trim();
}
function audienceShort(name) {
  return String(name || '').split(/[，,、]/)[0].trim();
}

/* 一条复盘记录算不算"有效样本"：两个指标都填了才可比 */
function reviewSample(rec, idx) {
  const row = rec && rec.review && rec.review[String(idx)];
  if (!row) return null;
  const a = parseMetric(row.a);
  const b = parseMetric(row.b);
  if (a === null || b === null) return null;
  return { a, b, note: String(row.note || '').trim() };
}

/* 用中位数而不是平均值：一条爆款（1.2万播放）会把均值拉飞，
   中位数更能代表"这个组合通常跑成什么样" */
function median(list) {
  if (!list.length) return null;
  const s = list.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const INSIGHT_MIN = 2;      // 少于 2 个样本不下结论，否则一次侥幸就被当规律

function buildInsights(history) {
  // key 来自大模型返回的人群/场景/买点文本。必须用无原型对象：
  // 普通 {} 遇到 'toString' / '__proto__' 这类 key 时 map[key] 会取到原型成员，
  // 短路后 b 是原型对象本身，b.a.push 直接抛错。
  const buckets = { audience: Object.create(null), scene: Object.create(null), buy: Object.create(null) };
  let samples = 0, reports = 0;

  (history || []).forEach(rec => {
    if (!rec || !rec.report || !rec.report.matrix) return;
    const rev = rec.review || {};
    if (!Object.keys(rev).length) return;
    let used = 0;
    rec.report.matrix.forEach(m => {
      const s = reviewSample(rec, m.idx);
      if (!s) return;
      used++; samples++;
      const add = (map, key, label) => {
        if (!key) return;
        let b = map[key];
        if (!b) { b = map[key] = { key, label: label || key, a: [], b: [], notes: [] }; }
        b.a.push(s.a); b.b.push(s.b);
        if (s.note) b.notes.push(s.note);
      };
      add(buckets.audience, audienceShort(m.audience), audienceShort(m.audience));
      add(buckets.scene, sceneGroup(m.scene), sceneGroup(m.scene));
      add(buckets.buy, String(m.buyPoint || '').slice(0, 40), String(m.buyPoint || '').slice(0, 40));
    });
    if (used) reports++;
  });

  const rank = (map) => {
    const list = Object.values(map).filter(b => b.a.length >= INSIGHT_MIN);
    list.forEach(b => {
      b.n = b.a.length;
      b.medA = median(b.a);
      b.medB = median(b.b);
      // 表现分：两个指标都按中位数归一后平均。只看相对排名，不看绝对值，
      // 因为不同指标量纲不同（完播率 vs 播放量）
      b.score = b.medA * 0.6 + b.medB * 0.4;
    });
    list.sort((x, y) => y.score - x.score);
    return list;
  };

  const top = rank(buckets.audience);
  const topScene = rank(buckets.scene);
  const topBuy = rank(buckets.buy);

  // 构造查表用的 key 集合，给生成阶段快速判断"这个组合历史上跑不跑得动"
  const winSet = new Set();
  const loseSet = new Set();
  [top, topScene, topBuy].forEach(list => {
    list.forEach(b => {
      if (list.length >= 3 && b.n >= INSIGHT_MIN) {
        // 同类里进前 1/3 视为胜出，垫底 1/3 视为跑不动
        const r = list.indexOf(b) / Math.max(1, list.length - 1);
        if (r <= 1 / 3) winSet.add(b.key);
        else if (r >= 2 / 3) loseSet.add(b.key);
      }
    });
  });

  return {
    samples, reports,
    audience: top.slice(0, 6),
    scene: topScene.slice(0, 6),
    buy: topBuy.slice(0, 6),
    win: winSet, lose: loseSet,
    enough: reports >= 2 && samples >= 6
  };
}

/* 生成报告时给每个矩阵组合打上历史标签 */
function applyInsights(ins, matrix) {
  if (!ins || !ins.enough) return { hits: 0, misses: 0 };
  let hits = 0, misses = 0;
  matrix.forEach(m => {
    const a = ins.win.has(audienceShort(m.audience));
    const s = ins.win.has(sceneGroup(m.scene));
    const b = ins.win.has(String(m.buyPoint || '').slice(0, 40));
    const aLose = ins.lose.has(audienceShort(m.audience));
    const sLose = ins.lose.has(sceneGroup(m.scene));
    const bLose = ins.lose.has(String(m.buyPoint || '').slice(0, 40));

    const winHits = [a, s, b].filter(Boolean).length;
    const loseHits = [aLose, sLose, bLose].filter(Boolean).length;

    if (winHits >= 2) { m.proven = { level: 'win', hits: winHits }; hits++; }
    else if (loseHits >= 2) { m.proven = { level: 'lose', hits: loseHits }; misses++; }
    else m.proven = null;
  });
  return { hits, misses };
}

/* 给大模型的文字版结论 */
function insightsBrief(ins) {
  if (!ins || !ins.enough) return '';
  const line = (label, list, fmt) => list.length
    ? `${label}：` + list.slice(0, 3).map(fmt).join('；')
    : '';
  const fmt = b => `${b.label}（${b.n}次，中位 ${b.medA}/${b.medB}）`;
  const parts = [
    line('历史跑得动的', ins.audience, fmt),
    line('有效场景', ins.scene, fmt),
    line('有效买点', ins.buy, fmt)
  ].filter(Boolean);
  if (!parts.length) return '';
  return `\n【你自己的历史数据（共 ${ins.reports} 份报告、${ins.samples} 组有效数据）】\n` +
    parts.map(p => '· ' + p).join('\n') +
    `\n这些组合已被你的账号数据验证过，优先沿用；反之避开明显垫底的组合。不要编造未出现的数据。\n`;
}
