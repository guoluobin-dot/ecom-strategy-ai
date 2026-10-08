/* ===========================================================
   导出：Markdown / Word(.doc)
   =========================================================== */

const DIM_LABEL = { func: '功能', effect: '效果', emotion: '情绪', trust: '信任', diff: '差异化' };

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function safeName(s) {
  return String(s || '报告').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
}

/* ---------------- Markdown ---------------- */
/* 去掉所有 HTML 标签：AI 返回内容不可信，导出文本里只应保留纯文案。
   只靠 /<[^>]*>/g 不够：没闭合的 "<img src=x onerror=..." 会整段留下，
   而且 Markdown 语法（图片、链接、标题）和换行都原样透传，
   别人预览这份 .md 时会远程加载图片、把文档结构撑乱。所以一起中性化。 */
const plain = s => String(s == null ? '' : s)
  .replace(/<[^>]*>/g, '')
  .replace(/[<>\n\r]/g, ' ')          // 未闭合标签残留的尖括号 + 换行（表格单元格用 cell 另行处理）
  .replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');   // 转义 Markdown 标记，阻断链接/图片/标题注入
/* 表格单元格：竖线要转义，否则会把单元格劈开 */
const cell = s => plain(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
/* 数字字段强制成数字再输出。正常路径上这些已经被夹在 0~100，
   但导入的备份能绕过夹取，写进 .doc 的就成了一段可执行标记。 */
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n)) : '0';
};

function toMarkdown(r) {
  const m = r.meta;
  const L = [];
  const H = n => L.push('', '#'.repeat(n) + ' ');
  const h = (n, t) => { H(n); L[L.length - 1] += t; };

  h(1, `${plain(m.category)}${m.prodName && m.prodName !== m.category ? ' ' + plain(m.prodName) : ''} · 短视频内容策略报告`);
  L.push(`> ${m.prodName && m.prodName !== m.category ? '产品：' + plain(m.prodName) + '｜' : ''}品类：${plain(m.catName)}｜价格带：${plain(m.price)}｜客单价：${plain(m.aov)}｜${m.selling && m.selling !== '未填写' ? '卖点：' + plain(m.selling) + '｜' : ''}内容困境：${plain(m.pain)}｜生成日期：${plain(m.date)}`, '');

  h(2, '策略摘要');
  L.push(`- **主攻人群**：${plain(r.summary.audience)}`, `  - ${plain(r.summary.audienceWhy)}`,
    `- **核心买点**：${plain(r.summary.buyPoint)}`, `  - 对应卖点：${cell(r.buyPoints[0] ? r.buyPoints[0].sell : '—')}`,
    `- **核心场景**：${plain(r.summary.scene)}`, `  - ${plain(r.summary.sceneIns)}`);

  h(2, '00 本轮先做这三件事');
  (r.actions || []).forEach(a => {
    L.push('', `${num(a.no) || '1'}. **${plain(a.what)}**`, `   - 怎么算做成：${plain(a.how)}`, `   - 时间：${plain(a.when)}`);
  });

  h(2, '01 产品卖点拆解：从功能卖点到用户收益');
  ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
    const g = (r.dimGuide && r.dimGuide[k]) || null;
    const how = (g && Array.isArray(g.how)) ? g.how : [];
    L.push('', `**${DIM_LABEL[k]}**${g && g.task ? `　—— ${plain(g.task)}` : ''}`);
    r.dims[k].forEach((x, i) => L.push(`- ${plain(x)}${how[i] ? `　\`怎么讲：${plain(how[i])}\`` : ''}`));
  });

  h(2, '02 人群拆解：不是所有人都是你的用户');
  r.audiences.forEach(a => {
    L.push('', `### ${plain(a.name)}（${plain(a.tag)}）`);
    L.push(`- 卖点匹配度 ${num(a.scores.match)}%｜痛点强度 ${num(a.scores.pain)}%｜短视频表达难度 ${num(a.scores.ease)}%（越低越好）｜付费意愿 ${num(a.scores.pay)}%｜市场规模 ${num(a.scores.size)}%`);
    L.push(`- 推荐理由：${plain(a.why)}`);
    if (a.chain) L.push(`- 决策链路：${plain(a.chain)}`);
    if (a.notFor) L.push(`- 不要拍给：${plain(a.notFor)}`);
  });

  h(2, '03 场景拆解：让产品进入用户真实生活');
  r.scenes.forEach(g => {
    L.push('', `**${plain(g.k)}**${g.level ? `｜优先级 ${cell(g.level)}` : ''}${g.tone ? `｜色调 ${cell(g.tone)}` : ''}`);
    if (g.why) L.push(`- ${plain(g.why)}`);
    g.items.forEach(it => {
      L.push(`- ${plain(it.n)}`);
      L.push(`  - 核心洞察：${plain(it.ins)}`);
      L.push(`  - 怎么拍：${plain(it.use)}`);
    });
  });

  h(2, '04 买点翻译：把卖点翻译成用户想买的理由');
  L.push('', '| 卖点（商家想说的） | 买点（用户愿意掏钱的理由） | 需要什么证据 | 合规风险 |', '| --- | --- | --- | --- |');
  r.buyPoints.forEach(b => L.push(`| ${cell(b.sell)} | ${cell(b.buy)} | ${cell(b.proof || '—')} | ${cell(b.risk || '—')} |`));

  h(2, '05 人群 × 场景 × 买点测试矩阵');
  L.push('', `策略重心（针对「${plain(m.pain)}」）：**${plain(r.play.focus)}** —— ${plain(r.play.rule)}`, `执行要点：${plain(r.play.tactics.join(' / '))}`);
  if (r.typePlan && r.typePlan.length) {
    L.push('', '**内容策略分工**', '', '| 类型 | 角色 | 对应组 | 为什么 | 注意 |', '| --- | --- | --- | --- | --- |');
    r.typePlan.forEach(t => {
      const note = t.warns.length ? plain(t.warns[0]) : (t.noReveal ? `${num(t.noReveal)} 条开头没让人认出产品` : '开头都认得出产品');
      L.push(`| ${plain(t.type)}类 | ${plain(t.role)} | 第 ${t.items.join('、')} 组 | ${plain(t.why)} | ${note} |`);
    });
  }
  r.matrix.forEach(x => {
    L.push('', `### 组合 ${num(x.idx)}：${plain(x.audience)} × ${plain(x.scene)}（${plain(x.priority)}）`);
    L.push(`- 类型分工：${plain(x.type || '剧情')}类 · ${plain(x.typeRole || '')} · 开头靠「${plain(x.hookKind || '产品露出')}」抓人` + (x.fitWarn ? ` — ⚠ ${plain(x.fitWarn)}` : ''));
    if (x.why) L.push(`- 为什么先拍这组：${plain(x.why)}`);
    if (x.kpi && x.kpi.length) L.push(`- 这条只盯：${plain(x.kpi.join(' / '))}`);
    L.push('', '**故事脚本（可直接念）**', '', `> ${plain(x.story || '')}`, '');
    L.push('', '**分段口播与画面**', '', '| 时间 | 阶段 | 口播台词 | 画面 |', '| --- | --- | --- | --- |');
    x.script.forEach(s => L.push(`| ${cell(s.t)} | ${cell(s.stage)} | ${cell(s.l)} | ${cell(s.v)} |`));
    L.push('', '**视频生成提示词**', '', '```', plain(x.prompt), '```');
  if (x.promptEn) {
    L.push('', '**视频生成提示词（EN — 喂 Sora / Runway / Veo / 可灵国际版）**', '', '```', plain(x.promptEn), '```');
  }
  });

  h(2, '数据复盘表（拍完填回来）');
  L.push('', '| # | 组合 | 优先级 | 要看的数据 | 结论 / 下一步 |', '| --- | --- | --- | --- | --- |');
  r.matrix.forEach(x => L.push(`| ${num(x.idx)} | ${cell(x.audience + ' × ' + x.scene)} | ${cell(x.priority)} | ${cell((x.kpi || []).join(' / ') || '—')} | |`));

  L.push('', '---', `AI 只固定内容策略与提示词结构，不接管发布渠道 —— 生成日期 ${plain(m.date)}，每条视频只盯一条主指标。`);
  return L.join('\n');
}

/* ---------------- Word(.doc) ---------------- */
const WORD_CSS = `
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:11pt;line-height:1.6;color:#222}
h1{font-size:20pt;margin:0 0 6pt}
h2{font-size:15pt;margin:18pt 0 8pt;border-bottom:1px solid #999;padding-bottom:4pt}
h3{font-size:12.5pt;margin:12pt 0 6pt}
p{margin:4pt 0}
ul{margin:4pt 0 4pt 18pt}
table{border-collapse:collapse;width:100%;margin:8pt 0;font-size:10pt}
th,td{border:1px solid #999;padding:5pt 7pt;vertical-align:top}
th{background:#eee;font-weight:bold}
.meta{color:#666;font-size:10pt;margin-bottom:12pt}
.sum{border-left:3px solid #666;padding:6pt 10pt;background:#f6f6f6;margin:6pt 0}
.dim{font-weight:bold;margin-top:8pt}
pre{background:#f3f3f3;padding:8pt;font-size:9pt;white-space:pre-wrap}
.tag{color:#666;font-size:9pt}
`;

function toWordHtml(r) {
  const m = r.meta;
  // 引号一并转义：目前 toWordHtml 里所有属性都是静态字面量，没有插值，
// 但多转一层成本为零，以后谁在属性里插个值也不会立刻变成注入。
const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // 洞察里去掉 <b> 强调（Word 里用样式表达），其余内容按纯文本转义，防止 AI 返回的 HTML 混入文档
  const ins = s => esc(String(s == null ? '' : s).replace(/<\/?b>/gi, ''));

  let h = '';
  h += `<h1>${esc(m.category)}${m.prodName && m.prodName !== m.category ? ' ' + esc(m.prodName) : ''} · 短视频内容策略报告</h1>`;
  h += `<p class="meta">${m.prodName && m.prodName !== m.category ? '产品：' + esc(m.prodName) + '｜' : ''}品类：${esc(m.catName)}｜价格带：${esc(m.price)}｜客单价：${esc(m.aov)}｜内容困境：${esc(m.pain)}｜生成日期：${esc(m.date)}</p>`;

  h += `<h2>策略摘要</h2>`;
  h += `<div class="sum"><p><b>主攻人群</b>：${esc(r.summary.audience)}<br><span class="tag">${esc(r.summary.audienceWhy)}</span></p></div>`;
  h += `<div class="sum"><p><b>核心买点</b>：${esc(r.summary.buyPoint)}<br><span class="tag">对应卖点：${esc(r.buyPoints[0] ? r.buyPoints[0].sell : '')}</span></p></div>`;
  h += `<div class="sum"><p><b>核心场景</b>：${esc(r.summary.scene)}<br><span class="tag">${ins(r.summary.sceneIns)}</span></p></div>`;

  h += `<h2>00 本轮先做这三件事</h2>`;
  (r.actions || []).forEach(a => {
    h += `<p><b>${esc(a.no || '')}. ${esc(a.what)}</b><br><span class="tag">怎么算做成：${esc(a.how)}　|　${esc(a.when)}</span></p>`;
  });

  h += `<h2>01 产品卖点拆解：从功能卖点到用户收益</h2>`;
  ['func', 'effect', 'emotion', 'trust', 'diff'].forEach(k => {
    const g = (r.dimGuide && r.dimGuide[k]) || null;
    const how = (g && Array.isArray(g.how)) ? g.how : [];
    h += `<p class="dim">${DIM_LABEL[k]}${g && g.task ? `　<span class="tag">${esc(g.task)}</span>` : ''}</p><ul>`;
    r.dims[k].forEach((x, i) => h += `<li>${esc(x)}${how[i] ? `<br><span class="tag">怎么讲：${esc(how[i])}</span>` : ''}</li>`);
    h += `</ul>`;
  });

  h += `<h2>02 人群拆解：不是所有人都是你的用户</h2>`;
  r.audiences.forEach(a => {
    h += `<h3>${esc(a.name)}（${esc(a.tag)}）</h3>`;
    h += `<p>卖点匹配度 ${num(a.scores.match)}%｜痛点强度 ${num(a.scores.pain)}%｜短视频表达难度 ${num(a.scores.ease)}%（越低越好）｜付费意愿 ${num(a.scores.pay)}%｜市场规模 ${num(a.scores.size)}%</p>`;
    h += `<p>推荐理由：${esc(a.why)}</p>`;
    if (a.chain) h += `<p>决策链路：${esc(a.chain)}</p>`;
    if (a.notFor) h += `<p>不要拍给：${esc(a.notFor)}</p>`;
  });

  h += `<h2>03 场景拆解：让产品进入用户真实生活</h2>`;
  r.scenes.forEach(g => {
    h += `<p class="dim">${esc(g.k)}${g.level ? `　<span class="tag">优先级 ${esc(g.level)}${g.tone ? '｜色调 ' + esc(g.tone) : ''}</span>` : ''}</p>`;
    if (g.why) h += `<p class="tag">${esc(g.why)}</p>`;
    h += `<ul>`;
    g.items.forEach(it => {
      h += `<li><b>${esc(it.n)}</b><br>核心洞察：${ins(it.ins)}<br>怎么拍：${esc(it.use)}</li>`;
    });
    h += `</ul>`;
  });

  h += `<h2>04 买点翻译：把卖点翻译成用户想买的理由</h2>`;
  h += `<table><tr><th>卖点（商家想说的）</th><th>买点（用户愿意掏钱的理由）</th><th>需要什么证据</th><th>合规风险</th></tr>`;
  r.buyPoints.forEach(b => h += `<tr><td>${esc(b.sell)}</td><td>${esc(b.buy)}</td><td>${esc(b.proof || '—')}</td><td>${esc(b.risk || '—')}</td></tr>`);
  h += `</table>`;

  h += `<h2>05 人群 × 场景 × 买点测试矩阵</h2>`;
  h += `<p>策略重心（针对「${esc(m.pain)}」）：<b>${esc(r.play.focus)}</b> —— ${esc(r.play.rule)}</p>`;
  h += `<p>执行要点：${esc(r.play.tactics.join(' / '))}</p>`;
  r.matrix.forEach(x => {
    h += `<h3>组合 ${num(x.idx)}：${esc(x.audience)} × ${esc(x.scene)}（${esc(x.priority)}）</h3>`;
    if (x.why) h += `<p>为什么先拍这组：${esc(x.why)}</p>`;
    if (x.kpi && x.kpi.length) h += `<p>这条只盯：${esc(x.kpi.join(' / '))}</p>`;
    h += `<p class="sum"><b>故事脚本（可直接念）</b><br>${esc(x.story || '')}</p>`;
    h += `<p class="dim">分镜拆解</p>`;
    h += `<table><tr><th>时间</th><th>阶段</th><th>口播台词</th><th>画面</th></tr>`;
    x.script.forEach(s => h += `<tr><td>${esc(s.t)}</td><td>${esc(s.stage)}</td><td>${esc(s.l)}</td><td>${esc(s.v)}</td></tr>`);
    h += `</table>`;
  h += `<p class="dim">类型分工</p><p>${esc(x.type || '剧情')}类 · ${esc(x.typeRole || '')} · 开头靠「${esc(x.hookKind || '产品露出')}」抓人${x.fitWarn ? ' — ⚠ ' + esc(x.fitWarn) : ''}</p>`;
  h += `<p class="dim">视频生成提示词</p>`;
  h += `<pre>${esc(x.prompt)}</pre>`;
  if (x.promptEn) {
    h += `<p class="dim">视频生成提示词（EN）</p>`;
    h += `<pre lang="en">${esc(x.promptEn)}</pre>`;
  }
  });

  h += `<h2>数据复盘表（拍完填回来）</h2>`;
  h += `<table><tr><th>#</th><th>组合</th><th>优先级</th><th>要看的数据</th><th>结论 / 下一步</th></tr>`;
  r.matrix.forEach(x => h += `<tr><td>${esc(String(x.idx))}</td><td>${esc(x.audience + ' × ' + x.scene)}</td><td>${esc(x.priority)}</td><td>${esc((x.kpi || []).join(' / ') || '—')}</td><td></td></tr>`);
  h += `</table>`;

  h += `<p class="meta">AI电商短视频内容策略 · 智能生成｜${esc(m.date)}｜建议每条视频只测一个矩阵组合</p>`;

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>${WORD_CSS}</style></head>
<body>${h}</body></html>`;
}