/* ===========================================================
   AI电商短视频内容策略 · 交互与渲染
   =========================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
// 转义必须覆盖引号：很多字段会进 placeholder="..." / data-f="..." 这类属性，
// 只转 & < > 的话，模型返回 ' autofocus onfocus=...' 就能拼出新的属性。
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// 场景洞察允许引擎自带的 <b> 强调，其余一律转义，避免大模型返回的 HTML 直接进 DOM
const safeIns = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/&lt;\/?b&gt;/gi, t => t.toLowerCase() === '&lt;/b&gt;' ? '</b>' : '<b>');

/* ---------------- 本地存储：历史 / 草稿 ---------------- */
const MAX_HISTORY = 20;

/* 报告 id 必须唯一。Date.now() 是毫秒级，同一毫秒内生成两份会撞 id，
   撞了会让后一份覆盖前一份的复盘数据。加随机后缀兜住。 */
let idSeq = 0;
function newId() {
  idSeq = (idSeq + 1) % 1000;
  return 'r' + Date.now().toString(36) + idSeq.toString(36).padStart(2, '0') +
    Math.random().toString(36).slice(2, 6);
}

const Store = {
  H: 'ai_ecom_history',
  D: 'ai_ecom_draft',
  getHistory() {
    try { return JSON.parse(localStorage.getItem(this.H) || '[]'); } catch (e) { return []; }
  },
  /* localStorage 满了就裁剪历史重试。
     返回 { rec, dropped, failed }：dropped 表示丢过旧报告，failed 表示连一条都存不下。
     报告本身不受影响，界面上会提示用户 */
  saveReport(report, input) {
    const list = this.getHistory();
    const rec = {
      id: newId(),
      date: report.meta.date,
      category: report.meta.category,
      catName: report.meta.catName,
      buyPoint: report.summary.buyPoint,
      source: report.source || 'local',
      report,
      input: { category: input.category, prodName: input.prodName, price: input.price, aov: input.aov, selling: input.selling, pain: input.pain, detail: input.detail, date: input.date }
    };
    list.unshift(rec);
    const trimmed = list.slice(0, MAX_HISTORY);
    const write = arr => { localStorage.setItem(this.H, JSON.stringify(arr)); return arr; };
    // 先记下被裁掉的 id：无论是条数上限还是配额不够，都会留下孤儿图片
    const orphan = this._takeDropped(trimmed);
    try { write(trimmed); this._dropImages(orphan); return { rec, dropped: false }; }
    catch (e) {
      // 二分找出当前配额最多能存下多少条，尽量少丢历史（逐条丢会一路丢到只剩 1 条）
      let lo = 1, hi = trimmed.length, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        try { write(trimmed.slice(0, mid)); best = mid; lo = mid + 1; }
        catch (e2) { hi = mid - 1; }
      }
      if (best > 0) {
        this._dropImages(this._takeDropped(trimmed.slice(0, best)).concat(orphan));
        return { rec, dropped: true };
      }
      // 连最新一条都存不下：清空历史再试，仍失败则放弃保存（不抛错）
      try {
        localStorage.removeItem(this.H);
        write([rec]);
        this._dropImages(this.getHistory().map(x => x.id).filter(id => id !== rec.id));
        return { rec, dropped: true };
      }
      catch (e3) { return { rec, dropped: true, failed: true }; }
    }
  },
  /* 异步清孤儿图片，失败就算了：这是回收空间，不该阻断存历史 */
  _dropImages(ids) {
    if (!ids || !ids.length || typeof ImgDB === 'undefined') return;
    Promise.all(ids.map(id => ImgDB.del(id))).catch(() => {});
  },
  /* 被挤出历史、或写入失败的报告 id。
   配额不够时上面的二分会把历史一路裁到只剩 1 条，那些报告的图还在
   IndexedDB 里躺着 —— 用户既看不到也删不掉，存储只增不减。
   返回出来让调用方顺手清掉。 */
  _takeDropped(arr) {
    const kept = new Set(this.getHistory().map(x => x.id));
    return arr.map(x => x.id).filter(id => id && !kept.has(id));
  },
  delReport(id) {
    const list = this.getHistory().filter(x => x.id !== id);
    localStorage.setItem(this.H, JSON.stringify(list));
  },
  /* ---------------- 复盘数据 ----------------
     复盘表是报告里唯一"用户要往回填"的部分，必须跟着报告一起存，
     否则填完一刷新就白填了，数据闭环断在最后一步。
     数据量很小（8 行 × 几个字段），直接挂在报告记录上，不另开存储 */
  getReview(id) {
    const rec = this.getHistory().find(x => x.id === id);
    return (rec && rec.review) || {};
  },
  /* values: { '1': { a:'12.3%', b:'4.1%', note:'钩子不行，换结果前置' } } */
  saveReview(id, values) {
    const list = this.getHistory();
    const rec = list.find(x => x.id === id);
    if (!rec) return false;
    // 只留有内容的格子，避免把几十个空串写进 localStorage
    const clean = {};
    Object.keys(values || {}).forEach(k => {
      const v = values[k] || {};
      const a = String(v.a || '').slice(0, 40);
      const b = String(v.b || '').slice(0, 40);
      const note = String(v.note || '').slice(0, 300);
      if (a || b || note) clean[k] = { a, b, note };
    });
    if (Object.keys(clean).length) rec.review = clean;
    else delete rec.review;
    try { localStorage.setItem(this.H, JSON.stringify(list)); return true; }
    catch (e) { return false; }   // 配额不足时静默失败，不影响报告本身
  },
  clearReview(id) {
    const list = this.getHistory();
    const rec = list.find(x => x.id === id);
    if (rec) { delete rec.review; try { localStorage.setItem(this.H, JSON.stringify(list)); } catch (e) {} }
  },
  getDraft() {
    try { return JSON.parse(localStorage.getItem(this.D) || 'null'); } catch (e) { return null; }
  },
  saveDraft(d) {
    // 草稿很小，但仍可能因为历史占满而写不进去，不能让它打断输入
    try { localStorage.setItem(this.D, JSON.stringify(d)); } catch (e) { /* 忽略 */ }
  },
  clearDraft() { localStorage.removeItem(this.D); }
};

let lastReport = null, lastInput = null, curId = null;

/* ---------------- 滚动渐显 ---------------- */
// 只装饰浏览型页面（首页 / 知识库）。报告与表单保持立即可读，不让动效挡内容。
let revealObserver = null;
function initReveal(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-reveal-group]').forEach(g => {
    Array.from(g.children).forEach((c, i) => {
      c.classList.add('reveal');
      c.style.transitionDelay = (i * 0.07).toFixed(2) + 's';
    });
  });
  scope.querySelectorAll('.reveal').forEach(el => {
    if (el.dataset.revealBound) return;
    el.dataset.revealBound = '1';
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add('in');   // 浏览器不支持时直接显示，避免内容永久隐藏
  });
}
function setupObserver() {
  if (!('IntersectionObserver' in window)) { initReveal(); return; }
  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        revealObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  initReveal();
}
function showInView(root) {   // 兜底：当前视口内的元素立即显示
  (root || document).querySelectorAll('.reveal').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92) el.classList.add('in');
  });
}

/* ---------------- 数字滚动 ---------------- */
function countUp(el) {
  const target = Number(el.dataset.count);
  if (!isFinite(target) || el.dataset.counted) return;
  el.dataset.counted = '1';
  if (target === 0 || !('requestAnimationFrame' in window)) return;
  const dur = 1100, t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = '0';
  requestAnimationFrame(step);
}

/* ---------------- 视图切换 + URL 路由 ----------------
   hash 形如 #/create、#/report/r1756...，好处：
   刷新停在原地、浏览器后退可用、报告链接可以直接收藏 */
const ROUTES = ['home', 'create', 'kb', 'report'];
let curView = 'home';
let suppressHash = false;      // 程序内部改 hash 时不要再触发 hashchange 回调

function parseHash() {
  const h = String((location.hash || '')).replace(/^#\/?/, '');
  const [view, arg] = h.split('/');
  return { view: ROUTES.includes(view) ? view : 'home', arg: arg || '' };
}
function pushHash(view, id) {
  const next = '#/' + view + (id ? '/' + id : '');
  if (location.hash !== next) {
    suppressHash = true;
    try { history.pushState(null, '', next); }   // file:// 下 pushState 也可用，但兜底用 hash
    catch (e) { location.hash = next; }
    setTimeout(() => { suppressHash = false; }, 0);
  }
}
function go(view, opt) {
  const o = opt || {};
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.go === view));
  curView = view;
  if (view === 'home') {
    renderRecent();
    initReveal($('#view-home'));
    requestAnimationFrame(() => showInView($('#view-home')));
    $$('#view-home .stat b[data-count]').forEach(countUp);
  }
  if (view === 'kb') {
    initReveal($('#view-kb'));
    requestAnimationFrame(() => showInView($('#view-kb')));
  }
  if (!o.silent) pushHash(view, view === 'report' ? curId : '');
  window.scrollTo({ top: 0, behavior: o.noScroll ? 'auto' : 'smooth' });
}
window.addEventListener('hashchange', () => {
  if (suppressHash) return;
  const { view, arg } = parseHash();
  if (view === 'report') {
    // 深链接到某份报告：报告只存在本机浏览器里，取不到就回首页并说明
    if (arg && Store.getHistory().some(x => x.id === arg)) openReport(arg);
    else if (curId) go('report', { silent: true });
    else {
      go('home', { silent: true });
      setTimeout(() => alert('链接里的报告在当前浏览器里找不到。\n报告只存在这台电脑上，换设备或清理缓存后需要重新生成，或先「导入恢复」备份。'), 80);
    }
    return;
  }
  if (view !== curView) go(view, { silent: true });
});
let curLang = 'zh';   // 提示词语言开关：zh = 中文模型（可灵/即梦），en = 英文模型（Sora/Runway/Veo）

document.addEventListener('click', e => {
  // 提示词语言切换
  const lb = e.target.closest('[data-lang]');
  if (lb) {
    curLang = lb.dataset.lang === 'en' ? 'en' : 'zh';
    if (lastReport) renderReport(lastReport);
    const sec = lb.closest('.mx');
    if (sec) sec.scrollIntoView({ block: 'nearest' });
    return;
  }
  // 复制提示词时复制当前语言的那一版
  const pb = e.target.closest('[data-copy-prompt]');
  if (pb && lastReport) {
    const m = lastReport.matrix.find(x => String(x.idx) === pb.dataset.copyPrompt);
    if (m) {
      const txt = curLang === 'en' ? (m.promptEn || m.prompt) : m.prompt;
      const done = () => { pb.textContent = '已复制'; setTimeout(() => { pb.textContent = '复制提示词'; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
      } else fallbackCopy(txt, done);
    }
    return;
  }
  const cb = e.target.closest('[data-copy-story]');
  if (cb && lastReport) {
    const m = lastReport.matrix.find(x => String(x.idx) === cb.dataset.copyStory);
    if (m && m.story) {
      const done = () => { cb.textContent = '已复制'; setTimeout(() => { cb.textContent = '复制'; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(m.story).then(done, () => fallbackCopy(m.story, done));
      } else fallbackCopy(m.story, done);
    }
    return;
  }
  const t = e.target.closest('[data-go]');
  if (t) go(t.dataset.go);
});

/* 键盘操作：非 button 的可点区域（最近报告卡片、图标的删除按钮）
   要能被 Enter/Space 触发，鼠标点击对它们无效 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'a' || tag === 'summary') return;
  const card = e.target.closest('.recent');
  if (card) { e.preventDefault(); openReport(card.dataset.open); return; }
  const del = e.target.closest('.del');
  if (del) { e.preventDefault(); del.click(); return; }
});

/* ---------------- 图片上传 ---------------- */
const imgs = { main: [], detail: [] };
const LIMIT = { main: 3, detail: 5 };
const MAX_EDGE = 1400;          // 报告里只做展示，1400px 足够
const MAX_EDGE_AI = 1024;       // 发给大模型的图，token 成本随分辨率线性上涨
const JPEG_Q = 0.82;

function renderThumbs(slot) {
  const grid = $('#grid-' + slot);
  grid.innerHTML = '';
  grid.classList.toggle('empty', imgs[slot].length === 0);
  imgs[slot].forEach((src, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = `<img src="${src}" alt="${slot === 'main' ? '产品主图' : '详情页截图'} ${i + 1}"><span class="del" data-slot="${slot}" data-i="${i}" role="button" tabindex="0" aria-label="移除这张${slot === 'main' ? '主图' : '详情图'}">×</span>`;
    grid.appendChild(d);
  });
}
document.addEventListener('click', e => {
  const del = e.target.closest('.del');
  if (del) {
    const { slot, i } = del.dataset;
    imgs[slot].splice(Number(i), 1);
    renderThumbs(slot);
  }
});
function upMsg(slot, text, warn) {
  const el = $('#msg-' + slot);
  if (!el) return;
  el.textContent = text;
  el.className = 'up-msg' + (warn ? ' warn' : '');
}

/* 等比缩到 maxEdge 以内并转 JPEG。
   不压缩的话，手机一张原图就 3-5MB，8 张进 IndexedDB 是几 MB 的纯浪费，
   发给大模型更是按分辨率计费，token 成本直接翻几倍 */
function shrinkImage(dataUrl, maxEdge) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';                 // PNG 转 JPEG 需要垫白底，否则透明区变黑
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', JPEG_Q));
      } catch (e) {
        resolve(dataUrl);                        // 画不出来就用原图，别让用户白传
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

['main', 'detail'].forEach(slot => {
  $('#file-' + slot).addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    let over = 0, bad = 0, added = 0;
    const jobs = [];
    files.forEach(f => {
      if (imgs[slot].length + added >= LIMIT[slot]) { over++; return; }
      if (!/^image\/(jpeg|png)$/i.test(f.type)) { bad++; return; }
      if (f.size > 12 * 1024 * 1024) { bad++; return; }
      added++;
      jobs.push(new Promise(res => {
        const r = new FileReader();
        r.onload = ev => shrinkImage(ev.target.result, MAX_EDGE).then(url => { imgs[slot].push(url); renderThumbs(slot); res(); });
        r.onerror = () => res();
        r.readAsDataURL(f);
      }));
    });
    // 被拒掉的文件要明确告知，避免用户以为已经传上去了
    const errs = [];
    if (over) errs.push(`超出上限 ${over} 个（${slot === 'main' ? '主图' : '详情页'}最多 ${LIMIT[slot]} 张）`);
    if (bad) errs.push(`${bad} 个不是 JPG/PNG 或超过 12MB，已跳过`);
    upMsg(slot, errs.length ? errs.join('；') : (added ? `已添加 ${added} 张，已自动压缩` : ''), errs.length > 0);
    if (jobs.length) Promise.all(jobs).then(() => upMsg(slot, errs.length ? errs.join('；') : `已添加 ${added} 张，已自动压缩`, errs.length > 0));
  });
});

/* ---------------- 草稿 ---------------- */
const DRAFT_FIELDS = ['f-prodname', 'f-category', 'f-price', 'f-aov', 'f-selling', 'f-pain', 'f-detail'];
function saveDraft() {
  const d = {};
  DRAFT_FIELDS.forEach(id => d[id] = $('#' + id).value);
  Store.saveDraft(d);
}
DRAFT_FIELDS.forEach(id => {
  $('#' + id).addEventListener('input', saveDraft);
  $('#' + id).addEventListener('change', saveDraft);
});
function restoreDraft() {
  const d = Store.getDraft();
  if (!d) return;
  let has = false;
  DRAFT_FIELDS.forEach(id => {
    if (d[id]) { $('#' + id).value = d[id]; has = true; }
  });
  if (has) {
    const tip = document.createElement('div');
    tip.className = 'draft-tip';
    tip.innerHTML = `已恢复上次未提交的草稿 <button id="draft-clear" class="link-btn">清空</button>`;
    $('.form-card').prepend(tip);
    $('#draft-clear').onclick = () => {
      Store.clearDraft();
      DRAFT_FIELDS.forEach(id => $('#' + id).value = '');
      tip.remove();
    };
  }
}

/* ---------------- AI 设置 ---------------- */
let lastFocused = null;
function openSettings() {
  const c = LLM.load();
  lastFocused = document.activeElement;
  $('#set-enabled').checked = !!c.enabled;
  $('#set-base').value = c.base || '';
  $('#set-key').value = c.key || '';
  $('#set-model').value = c.model || '';
  $('#set-vision').checked = c.vision !== false;
  syncState();
  $('#set-result').textContent = '';
  $('#settings').classList.add('on');
  refreshImgDbInfo();
  const first = $('#set-enabled');
  if (first && first.focus) first.focus();
}
function closeSettings() {
  $('#settings').classList.remove('on');
  // 关掉后把焦点还给触发它的按钮，键盘用户不会凭空丢失位置
  if (lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch (e) {} }
  lastFocused = null;
}
function syncState() {
  const on = $('#set-enabled').checked;
  const model = $('#set-model').value.trim();
  const base = $('#set-base').value.trim().toLowerCase();
  $('#set-state').textContent = on ? (model ? `已启用：${model}` : '已启用（未填模型名）') : '未启用（使用内置规则引擎）';

  const visionOn = $('#set-vision').checked;
  const noVision = base.includes('deepseek');
  const sw = $('#set-vision');
  const st = $('#set-vision-state');
  if (!visionOn) { st.textContent = '未开启（只分析文字信息）'; return; }
  if (noVision) { st.textContent = '已开启，但当前接口无视觉模型，将按纯文本生成'; return; }
  st.textContent = LLM._visionDisabled ? '已开启（上次实测该模型不支持图片，已按纯文本处理）' : `已开启（最多 4 张图，模型：${model || '未填'}）`;
  sw.disabled = false;
}
function refreshImgDbInfo() {
  const el = $('#set-imgdb');
  if (!el) return;
  ImgDB.usage().then(u => {
    if (!u || !u.quota) { el.textContent = ImgDB._failed ? '当前浏览器不支持（图片仅本次展示）' : '可用（容量由浏览器分配）'; return; }
    el.textContent = `可用 · 已用 ${(u.used / 1048576).toFixed(1)}MB / 可用约 ${(u.quota / 1048576).toFixed(0)}MB`;
  });
  const st = $('#backup-stat');
  if (st) {
    const list = Store.getHistory();
    const reviewed = list.filter(x => x.review && Object.keys(x.review).length).length;
    st.textContent = `当前 ${list.length} 份报告` + (reviewed ? `，其中 ${reviewed} 份填过复盘数据` : '') +
      `，约 ${(new Blob([JSON.stringify(list)]).size / 1024).toFixed(0)}KB`;
  }
}

/* ---------------- 数据备份：导出/导入全部 ----------------
   报告只存在 localStorage，换设备、清缓存、无痕退出都会丢。
   导出成一个 JSON（不含 API Key），换台机器导入即可恢复。 */
const BACKUP_TAG = 'ai_ecom_backup_v1';

$('#btn-export-all').addEventListener('click', async () => {
  const list = Store.getHistory();
  if (!list.length) { alert('还没有任何报告可以导出'); return; }
  const pack = {
    tag: BACKUP_TAG,
    app: 'AI电商短视频内容策略',
    exportedAt: new Date().toISOString(),
    count: list.length,
    history: list,
    draft: Store.getDraft() || null
  };
  // 图片在 IndexedDB 里，单独收集成 base64 一起带走
  const shots = {};
  let withShots = 0;
  for (const rec of list) {
    const im = await ImgDB.get(rec.id);
    if (im && ((im.main || []).length || (im.detail || []).length)) { shots[rec.id] = im; withShots++; }
  }
  pack.shots = shots;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadFile(`电商内容策略备份_${stamp}.json`, JSON.stringify(pack), 'application/json');
  setTimeout(() => {
    $('#set-result').textContent = `已导出 ${list.length} 份报告` + (withShots ? `（含 ${withShots} 份产品图）` : '（无产品图）') +
      '。文件里不含 API Key，导入后需要重新填写接口。';
  }, 60);
});

$('#btn-import-all').addEventListener('click', () => $('#file-import').click());

$('#file-import').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    let pack;
    try { pack = JSON.parse(String(fr.result)); }
    catch (err) { alert('这个文件不是有效的备份文件（JSON 解析失败）'); return; }
    if (!pack || pack.tag !== BACKUP_TAG || !Array.isArray(pack.history)) {
      alert('这不是本工具导出的备份文件\n\n请选择文件名形如「电商内容策略备份_YYYYMMDD.json」的文件。');
      return;
    }
    const incoming = pack.history.filter(r => r && r.id && r.report && r.report.meta);
    if (!incoming.length) { alert('备份文件里没有可用的报告'); return; }
    // 备份里若自带重复 id（老版本或手工改过），先去重，否则后一条会盖掉前一条的复盘
    const seenIn = new Set();
    const dedup = incoming.filter(r => {
      if (seenIn.has(r.id)) return false;
      seenIn.add(r.id);
      return true;
    });
    if (dedup.length !== incoming.length) {
      console.warn('备份中有重复 id，已去重', incoming.length, '→', dedup.length);
    }

    const cur = Store.getHistory();
    const curIds = new Set(cur.map(x => x.id));
    const fresh = dedup.filter(r => !curIds.has(r.id));
    const dupe = dedup.length - fresh.length;

    const mode = confirm(
      `备份里有 ${dedup.length} 份报告（导出于 ${(pack.exportedAt || '').slice(0, 10)}）。\n` +
      (dupe ? `其中 ${dupe} 份已存在会被跳过。\n` : '') +
      `\n【确定】合并导入 ${fresh.length} 份（保留现有历史）\n` +
      `【取消】清空现有历史，只留备份里的 ${dedup.length} 份`
    );
    try {
      const merged = mode ? fresh.concat(cur).slice(0, 60) : dedup;
      // 导入同样会裁掉记录，被裁的那些图片要一起清掉
      Store._dropImages(Store._takeDropped(merged));
      localStorage.setItem(Store.H, JSON.stringify(merged));
      if (pack.draft) Store.saveDraft(pack.draft);
    } catch (err) {
      alert('导入失败：浏览器存储空间不足。\n可以先删除一些旧报告再试。');
      return;
    }
    // 图片是异步的，存完再刷界面
    const shots = pack.shots || {};
    const jobs = Object.keys(shots).map(id => ImgDB.put(id, shots[id]));
    Promise.all(jobs).then(() => {
      refreshHistory(); renderRecent(); refreshImgDbInfo();
      alert(`导入完成：${mode ? '新增' : '恢复'} ${mode ? fresh.length : dedup.length} 份报告。\n可在「历史报告」下拉里打开查看。`);
      closeSettings();
    });
  };
  fr.onerror = () => alert('读取文件失败');
  fr.readAsText(f);
});
$('#btn-settings').addEventListener('click', openSettings);
$('#set-close').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });
// Esc 关闭弹窗
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#settings').classList.contains('on')) closeSettings();
});
$('#set-enabled').addEventListener('change', syncState);
$('#set-model').addEventListener('input', syncState);
$('#set-base').addEventListener('input', syncState);
$('#set-vision').addEventListener('change', syncState);
$('#set-save').addEventListener('click', () => {
  LLM.save({
    enabled: $('#set-enabled').checked,
    base: $('#set-base').value.trim() || 'https://api.deepseek.com/v1',
    key: $('#set-key').value.trim(),
    model: $('#set-model').value.trim(),
    vision: $('#set-vision').checked
  });
  LLM._visionDisabled = false;      // 改了配置就重新允许试一次视觉
  const visionMsg = $('#set-vision').checked && !$('#set-base').value.trim().toLowerCase().includes('deepseek')
    ? ' 视觉分析已开启。' : '';
  $('#set-result').textContent = '已保存。' + (LLM.ready() ? '下次生成将调用大模型。' : '当前仍使用内置规则引擎。') + visionMsg;
});
$('#set-test').addEventListener('click', async () => {
  LLM.save({
    enabled: true,
    base: $('#set-base').value.trim() || 'https://api.deepseek.com/v1',
    key: $('#set-key').value.trim(),
    model: $('#set-model').value.trim()
  });
  const box = $('#set-result');
  const typed = $('#set-model').value.trim();
  const fixed = LLM.normalizeModel(typed);
  box.textContent = fixed && fixed !== typed ? `模型名将按「${fixed}」调用，正在测试…` : '正在测试连接…';
  try {
    const r = await LLM.test();
    if ($('#set-model').value.trim() === typed && fixed && fixed !== typed) $('#set-model').value = fixed;
    box.textContent = `连接成功（模型：${LLM.cfg.model}）返回：` + r;
  } catch (e) {
    const all = LLM.parseAllModels(e.raw || '');
    box.textContent = '连接失败：' + e.message + (all ? `\n\n该接口可用模型：${all}` : '');
  }
});

/* ---------------- 生成流程 ---------------- */
const STEPS = [
  '解析产品信息与卖点描述',
  '匹配品类人群与场景库',
  '拆解卖点五维结构',
  '计算人群画像评分',
  '翻译卖点为购买理由',
  '生成测试矩阵与拍摄脚本'
];

/* ---------------- 数据沉淀 ---------------- */
function currentInsights() {
  return buildInsights(Store.getHistory());
}

/* 生成前把历史结论带进引擎与提示词，让报告"越用越准" */
function insightsForNextRun() {
  const ins = currentInsights();
  return { ins, brief: insightsBrief(ins) };
}

$('#form').addEventListener('submit', e => {
  e.preventDefault();
  const category = $('#f-category').value.trim();
  if (!category) {
    $('#f-category').focus();
    alert('请填写品类（必填）');
    return;
  }
  const input = {
    category,
    prodName: $('#f-prodname').value.trim(),
    price: $('#f-price').value,
    aov: $('#f-aov').value.trim(),
    selling: $('#f-selling').value.trim(),
    pain: $('#f-pain').value,
    detail: $('#f-detail').value.trim(),
    images: { main: imgs.main.slice(), detail: imgs.detail.slice() },
    date: new Date().toLocaleDateString('zh-CN')
  };
  runLoading(input);
});

async function runLoading(input) {
  const box = $('#loading');
  const steps = $('#loadingSteps');
  box.classList.add('on');
  steps.innerHTML = '';
  const useAI = LLM.ready();
  steps.innerHTML = `<div class="now">${useAI ? '正在调用大模型生成策略…' : '正在用内置规则引擎生成策略…'}</div>`;

  // 步骤动画与真实生成并行跑，等待期间也有进度反馈
  let i = 0;
  const tick = () => {
    if (i >= STEPS.length) return;
    const d = document.createElement('div');
    d.className = 'now';
    d.textContent = `${i + 1}. ${STEPS[i]} …`;
    steps.appendChild(d);
    i++;
  };
  const timer = setInterval(tick, 420);

  let report = null, errMsg = '';
  try {
    // 历史复盘结论：这轮生成要带上，报告才能沿用你账号上已经验证过的组合。
    // 放在 try 里：这一步读的是历史数据，万一某条脏数据让聚合抛错，
    // 不能连累下面那个负责移除加载层的 catch —— 否则界面会永远卡在"生成中"。
    const { ins, brief } = insightsForNextRun();
    if (ins.enough) {
      steps.innerHTML = `<div class="now">正在参考 ${ins.reports} 份历史报告的复盘数据…</div>`;
    }
    if (useAI) {
      report = await LLM.generate(input, brief);
    } else {
      await new Promise(r => setTimeout(r, 1200));
      report = generateReport(input, { insights: ins });
    }
  } catch (e) {
    errMsg = e.message || String(e);
    // 模型名不被支持时，提示用户具体可用的名字
    const all = LLM.parseAllModels(e.raw || '');
    if (all) errMsg += `\n\n提示：当前接口不支持「${LLM.cfg.model}」。\n该接口可用模型：${all}\n请在「AI 设置」里改一下模型名。`;
    report = generateReport(input, { insights: ins });
  }

  // 接口自动换过模型名 → 记下来，用 banner 提示，不打断看报告
  let autoSwitched = null;
  if (LLM._lastSwitched) {
    autoSwitched = LLM._lastSwitched;
    LLM._lastSwitched = null;
    if (!$('#set-model').value || $('#set-model').value.trim() === autoSwitched.from) $('#set-model').value = autoSwitched.to;
  }
  // 模型不支持图片 → 已经自动按纯文本重生成，说明一下，别让用户以为图被分析了
  let visionNote = null;
  if (LLM._visionNote) {
    visionNote = LLM._visionNote;
    LLM._visionNote = null;
  }

  clearInterval(timer);
  while (i < STEPS.length) { tick(); }          // 补齐剩余步骤
  $$('#loadingSteps > div').forEach(d => d.className = 'done');

  setTimeout(() => {
    // 顺序很关键：先关遮罩再存。存历史可能因配额失败，不能让它把用户卡在"生成中"
    box.classList.remove('on');
    let saved = { rec: null, dropped: false };
    try {
      saved = Store.saveReport(report, input);
    } catch (e) {
      saved = { rec: null, dropped: true, failed: true };
    }
    curId = saved.rec ? saved.rec.id : null;
    // 图片存 IndexedDB：存失败不影响报告，报告里本来就有当次的缩略图可看
    if (curId && input.images) ImgDB.put(curId, input.images);
    renderReport(report, input);
    refreshHistory();
    go('report');

    /* 提示走 banner 而不是 alert()：报告已经生成好了，
       弹窗会挡住它，用户必须点掉才能看到内容 */
    const notes = [];
    if (saved.dropped) {
      notes.push({
        level: 'warn',
        title: saved.failed ? '这份报告没能存进历史' : '本地存储已满',
        text: saved.failed
          ? '浏览器存储空间不足。请到浏览器设置里清理本站数据，或先删掉几份旧报告。当前报告可正常导出，不影响使用。'
          : '已自动删除部分最早的报告来腾出空间。当前报告可正常导出。'
      });
    }
    if (errMsg) {
      notes.push({
        level: 'warn',
        title: '大模型没调通，已改用内置规则引擎',
        text: errMsg
      });
    }
    if (visionNote) {
      notes.push({
        level: 'info',
        title: '图片没参与分析',
        text: visionNote + '。产品图仍会显示在报告里。要让模型看图，把「AI 设置」里的模型名换成支持视觉的（qwen-vl-max / glm-4v / kimi-latest 等）。'
      });
    }
    if (autoSwitched) {
      notes.push({
        level: 'info',
        title: '模型名已自动更正',
        text: `接口不支持「${autoSwitched.from}」，已改用「${autoSwitched.to}」并保存。建议在「AI 设置」里确认一下。`
      });
    }
    showNotes(notes);
  }, 300);
}

/* ---------------- 报告顶部提示条 ----------------
   非阻断：报告正文照常可读、可导出。自动消失，可手动关。 */
function showNotes(notes) {
  const host = $('#report-notes');
  if (!host) return;
  const list = (notes || []).filter(n => n && n.title);
  if (!list.length) { host.innerHTML = ''; host.style.display = 'none'; return; }
  host.style.display = '';
  host.innerHTML = list.map((n, i) => `
    <div class="note ${n.level === 'info' ? 'info' : 'warn'}" role="status">
      <div class="note-b">
        <div class="note-t">${esc(n.title)}</div>
        <div class="note-x">${esc(n.text)}</div>
      </div>
      <button class="note-close" data-note-close="${i}" aria-label="关闭提示">×</button>
    </div>`).join('');
  $$('#report-notes [data-note-close]').forEach(b => {
    b.addEventListener('click', () => { b.parentNode.remove(); });
  });
}

/* ---------------- 报告渲染 ---------------- */
/* 图片是异步的：先渲染正文，再从 IndexedDB 取图补到报告顶部，避免整页等 IO */
function renderShots(images) {
  const host = $('#rp-shots');
  if (!host) return;
  const list = [
    ...((images && images.main) || []).map(s => ({ s, t: '主图' })),
    ...((images && images.detail) || []).map(s => ({ s, t: '详情' }))
  ];
  if (!list.length) { host.innerHTML = ''; return; }
  // src 必须转义 + 只收 data:image：图片来自 IndexedDB，而备份文件可以把任意字符串塞进来
  const safeShots = list.filter(x => x && typeof x.s === 'string' && /^data:image\//.test(x.s));
  host.innerHTML = `<span class="lab">产品素材（${safeShots.length} 张）</span>` +
    safeShots.map((x, i) => `<figure><img src="${esc(x.s)}" alt="${esc(x.t)}第 ${i + 1} 张"><figcaption>${esc(x.t)}</figcaption></figure>`).join('');
}

function renderReport(r, input) {
  lastReport = r; lastInput = input;
  const m = r.meta;
  // 当次生成的图直接从内存拿；打开历史报告的走 IndexedDB
  renderShots(input.images);
  // 复盘数据跟着报告走
  const review = (curId && r._review) ? r._review : (curId ? Store.getReview(curId) : {});

  const dimsHtml = ['func', 'effect', 'emotion', 'trust', 'diff'].map(k => {
    const meta = DIM_META[k];
    const gd = (r.dimGuide && r.dimGuide[k]) || null;
    const how = (gd && Array.isArray(gd.how)) ? gd.how : [];
    return `
      <div class="dim ${meta.cls}">
        <div class="dim-h"><span>${meta.label}</span><small>${meta.sub}</small></div>
        ${gd && gd.task ? `<div class="dim-task">${esc(gd.task)}</div>` : ''}
        <div class="dim-b"><ul>${r.dims[k].map((x, i) => `
          <li><span class="dt">${esc(x)}</span>${how[i] ? `<span class="dh">怎么讲：${esc(how[i])}</span>` : ''}</li>`).join('')}</ul></div>
      </div>`;
  }).join('');

  const audHtml = r.audiences.map(a => `
    <div class="au ${a.tag === '主攻' ? 'main' : ''}">
      <div class="au-h">
        <h3>${esc(a.name)}</h3>
        <span class="au-tag ${a.tag === '主攻' ? '' : 'g'}">${esc(a.tag)}</span>
      </div>
      <div class="scores">
        ${scoreBar('卖点匹配度', a.scores.match)}
        ${scoreBar('痛点强度', a.scores.pain)}
        ${scoreBar('短视频表达难度', a.scores.ease, 'low', '越低越好')}
        ${scoreBar('付费意愿', a.scores.pay)}
        ${scoreBar('市场规模', a.scores.size)}
      </div>
      <div class="au-why"><b>推荐理由：</b>${esc(a.why)}</div>
      ${a.chain ? `<div class="au-note"><b>决策链路：</b>${esc(a.chain)}</div>` : ''}
      ${a.notFor ? `<div class="au-note warn"><b>不要拍给：</b>${esc(a.notFor)}</div>` : ''}
    </div>`).join('');

  const scHtml = r.scenes.map(g => `
    <div class="sc-grp">
      <div class="sc-grp-h">
        <span class="sc-k">${esc(g.k)}</span>
        <span class="sc-badges">
          <span class="sc-b lv${g.level === '高' ? 'hi' : ''}">优先级 ${esc(g.level || '中')}</span>
          <span class="sc-b">色调 ${esc(g.tone || '暖调')}</span>
        </span>
      </div>
      ${g.why ? `<div class="sc-why">${esc(g.why)}</div>` : ''}
      <div class="sc-items">${g.items.map(it => `
        <div class="sc">
          <h4>${esc(it.n)}</h4>
          <div class="ins"><b>核心洞察：</b>${safeIns(it.ins)}</div>
          <div class="use">画面呈现：${esc(it.use)}</div>
        </div>`).join('')}</div>
    </div>`).join('');

  const buyHtml = `
    <table class="tb tb-buy">
      <thead><tr>
        <th style="width:26%">卖点（商家想说的）</th>
        <th style="width:4%"></th>
        <th style="width:26%">买点（用户愿意掏钱的理由）</th>
        <th style="width:22%">需要什么证据</th>
        <th style="width:22%">合规风险</th>
      </tr></thead>
      <tbody>
        ${r.buyPoints.map(b => `
          <tr>
            <td data-l="卖点（商家想说的）">${esc(b.sell)}</td>
            <td class="arrow-cell">→</td>
            <td class="buy" data-l="买点（用户愿意掏钱的理由）">${esc(b.buy)}</td>
            <td class="proof" data-l="需要什么证据">${esc(b.proof || '—')}</td>
            <td class="risk" data-l="合规风险">${esc(b.risk || '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  /* 内容策略：一个核心方向 + 几个辅助方向，各承担不同角色。
     8 组不是同一种视频的 8 个变体，而是策略的不同分工。 */
  const planHtml = (r.typePlan && r.typePlan.length) ? `
    <div class="plan">
      <div class="plan-h">内容策略分工</div>
      <p class="plan-tip">同一个产品，8 条视频不该是同一条的 8 个变体。每条承担不同角色：先用核心方向把量跑起来，再用辅助方向各自解决一个问题。</p>
      <div class="plan-grid">
        ${r.typePlan.map(t => `
          <div class="plan-c${t.type === '剧情' ? ' core' : ''}">
            <div class="plan-r"><span class="tg tg-${esc(t.type)}">${esc(t.type)}类</span><span class="tr">${esc(t.role)}</span></div>
            <div class="plan-w">${esc(t.why)}</div>
            <div class="plan-m">第 ${esc(t.items.join('、'))} 组</div>
            ${t.noReveal ? `<div class="plan-x">${esc(t.noReveal)} 条开头没让人认出产品，容易白投</div>` : '<div class="plan-ok">开头都认得出产品</div>'}
            ${t.warns.length ? `<div class="plan-x">⚠ ${esc(t.warns[0])}</div>` : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  const mxHtml = r.matrix.map(x => `
    <div class="mx">
      <div class="mx-h">
        <span class="idx">${x.idx}</span>
        <span class="nm">${esc(x.audience)} × ${esc(x.scene)}</span>
        <span class="tags">
          ${x.proven ? `<span class="proven ${esc(x.proven.level)}">${x.proven.level === 'win' ? '历史已验证' : '历史偏弱'}</span>` : ''}
          <span>${esc(x.priority)}</span><span>${esc(m.catName)}</span>
        </span>
      </div>
      <div class="mx-b">
        ${x.why ? `<div class="mx-why"><b>为什么先拍这组：</b>${esc(x.why)}</div>` : ''}
        <div class="mx-3col">
          <div class="mx-cell"><div class="k">人群内容</div><div class="v">${esc(x.audience)}</div></div>
          <div class="mx-cell"><div class="k">场景内容</div><div class="v">${esc(x.scene)}</div></div>
          <div class="mx-cell"><div class="k">买点内容</div><div class="v">${esc(x.buyPoint)}</div></div>
        </div>
        <div class="mx-strategy">
          <span class="tg tg-${esc(x.type || '剧情')}">${esc(x.type || '剧情')}类</span>
          <span class="tr">${esc(x.typeRole || '')}</span>
          <span class="hk">开头靠「${esc(x.hookKind || '产品露出')}」抓人</span>
          ${x.hookRevealsProduct ? '' : '<span class="tw">开头没认出产品，容易白投</span>'}
          ${x.fitWarn ? `<span class="tw">⚠ ${esc(x.fitWarn)}</span>` : ''}
        </div>
        ${(x.kpi && x.kpi.length) ? `<div class="mx-kpi"><b>这条只盯：</b>${x.kpi.map(k => `<span>${esc(k)}</span>`).join('')}</div>` : ''}
        <div class="story">
          <div class="story-h">
            <span>故事脚本</span>
            <span class="story-tip">一整段口播稿，可直接念；照着它拍就是一条完整视频</span>
            <button class="btn btn-ghost btn-xs no-print" data-copy-story="${x.idx}">复制</button>
          </div>
          <p class="story-txt">${esc(x.story || '')}</p>
        </div>
        <div class="prompt-h">
          <span>视频生成提示词 · 照这段直接粘给视频模型</span>
          <span class="lang-sw no-print" role="group" aria-label="提示词语言">
            <button class="lang-b${curLang === 'zh' ? ' on' : ''}" data-lang="zh" data-idx="${x.idx}">中文</button>
            <button class="lang-b${curLang === 'en' ? ' on' : ''}" data-lang="en" data-idx="${x.idx}">EN</button>
          </span>
          <button class="btn btn-ghost btn-xs no-print" data-copy-prompt="${x.idx}">复制提示词</button>
        </div>
        <div class="prompt" lang="${curLang === 'en' ? 'en' : 'zh-CN'}">${esc(curLang === 'en' ? (x.promptEn || x.prompt) : x.prompt)}</div>
        ${(x.promptEn) ? `<div class="prompt-tip no-print">${curLang === 'en' ? 'EN 版喂 Sora / Runway / Veo / 可灵国际版；中文画面文字保留，因为国内观众看中文' : '模型不给英文版时，用本地英文模板兜底'}</div>` : ''}
        <details class="beat">
          <summary>分段口播与画面（${x.script.length} 段）· 只念口播，画面看上面提示词</summary>
          <table>
            <thead><tr><th>时间</th><th>阶段</th><th>口播台词</th><th>画面</th></tr></thead>
            <tbody>
              ${x.script.map(s => `<tr>
                <td class="t">${esc(s.t)}</td>
                <td>${esc(s.stage)}</td>
                <td class="l">${esc(s.l)}</td>
                <td class="v">${esc(s.v)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </details>
      </div>
    </div>`).join('');

  const insHtml = (() => {
    const ins = currentInsights();
    if (!ins || !ins.enough) return '';
    const col = (label, list) => list.length ? `
      <div class="ins-col">
        <div class="ins-t">${label}</div>
        ${list.map(b => `<div class="ins-row"><span>${esc(b.label)}</span><em>${b.n}次 · 中位 ${b.medA}/${b.medB}</em></div>`).join('')}
      </div>` : '';
    return `
    <div class="sec">
      <div class="sec-h"><span class="no">★</span><div><h2>你的数据沉淀</h2><div class="sub">来自 ${ins.reports} 份报告、${ins.samples} 组有效数据</div></div></div>
      <div class="sec-desc">这些组合已经在你的账号上跑过，中位数高于同类。下方矩阵里标了「历史已验证」的会优先出现在行动清单里。</div>
      <div class="ins-grid">
        ${col('跑得动的人群', ins.audience)}
        ${col('有效场景', ins.scene)}
        ${col('有效买点', ins.buy)}
      </div>
    </div>`;
  })();

  $('#report-root').innerHTML = `
    <div class="rp-head">
      <div class="rp-kicker">AI 电商短视频内容策略报告</div>
      <h1 class="rp-title">${esc(m.category)}${m.prodName && m.prodName !== m.category ? ' · ' + esc(m.prodName) : ''} · 内容策略</h1>
      <div class="rp-meta">
        ${m.prodName && m.prodName !== m.category ? `<span class="tag b">产品：${esc(m.prodName)}</span>` : ''}
        <span class="tag b">品类：${esc(m.catName)}</span>
        <span class="tag">价格带：${esc(m.price)}</span>
        <span class="tag">客单价：${esc(m.aov)}</span>
        ${m.selling && m.selling !== '未填写' ? `<span class="tag b">卖点：${esc(m.selling)}</span>` : ''}
        <span class="tag a">内容困境：${esc(m.pain)}</span>
        <span class="tag">生成日期：${esc(m.date)}</span>
      </div>
      <div class="rp-shots" id="rp-shots"></div>
    </div>

    <div class="summary">
      <div class="sum-card c1">
        <div class="k">主攻人群</div>
        <div class="v">${esc(r.summary.audience)}</div>
        <div class="d">${esc(r.summary.audienceWhy)}</div>
      </div>
      <div class="sum-card c2">
        <div class="k">核心买点</div>
        <div class="v">${esc(r.summary.buyPoint)}</div>
        <div class="d">对应卖点：${esc(r.buyPoints[0] ? r.buyPoints[0].sell : '—')}</div>
      </div>
      <div class="sum-card c3">
        <div class="k">核心场景</div>
        <div class="v">${esc(r.summary.scene)}</div>
        <div class="d">${safeIns(r.summary.sceneIns)}</div>
      </div>
    </div>

    ${insHtml}
    ${(r.actions && r.actions.length) ? `
    <div class="sec">
      <div class="sec-h"><span class="no">00</span><div><h2>本轮先做这三件事</h2><div class="sub">看完直接开工，不用自己从 8 组里挑</div></div></div>
      <div class="act-grid">
        ${r.actions.map(a => `
          <div class="act">
            <div class="act-no">${esc(a.no || '')}</div>
            <div class="act-b">
              <div class="act-what">${esc(a.what)}</div>
              <div class="act-how">怎么算做成：${esc(a.how)}</div>
              <div class="act-when">${esc(a.when)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="sec">
      <div class="sec-h"><span class="no">01</span><div><h2>产品卖点拆解</h2><div class="sub">从功能卖点到用户收益</div></div></div>
      <div class="sec-desc">卖点不是参数罗列。同一件事，用"功能"说是商家的语言，用"收益"说才是用户的语言。下面把你提供的卖点按五个维度重新归类，并标出每一条具体怎么讲。</div>
      <div class="dim-grid">${dimsHtml}</div>
    </div>

    <div class="sec">
      <div class="sec-h"><span class="no">02</span><div><h2>人群拆解</h2><div class="sub">不是所有人都是你的用户</div></div></div>
      <div class="sec-desc">短视频最大的浪费，是把内容拍给不会买的人看。下面三个人群按五维打分，"主攻"是你这个阶段唯一要集中火力的人群。除打分外，还标了他们的决策链路和你要放弃谁。</div>
      ${audHtml}
    </div>

    <div class="sec">
      <div class="sec-h"><span class="no">03</span><div><h2>场景拆解</h2><div class="sub">让产品进入用户真实生活</div></div></div>
      <div class="sec-desc">用户不会为了"功能"下单，只会为了"某个具体时刻不再难受"下单。每组场景标了优先级与画面色调，并给出画面里该出现什么。</div>
      <div class="sc-grid">${scHtml}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><span class="no">04</span><div><h2>买点翻译</h2><div class="sub">把卖点翻译成用户想买的理由</div></div></div>
      <div class="sec-desc">卖点是商家想说的，买点是用户愿意掏钱的理由。右侧两列是最容易翻车的地方：没有证据的买点撑不住，踩了红线的卖点会限流。</div>
      ${buyHtml}
    </div>

    <div class="sec">
      <div class="sec-h"><span class="no">05</span><div><h2>人群 × 场景 × 买点测试矩阵</h2><div class="sub">${r.matrix.length} 组可拍的内容策略与脚本</div></div></div>
      <div class="sec-desc">
        每组都是"一个人群 × 一个场景 × 一个买点"的完整组合，内容策略段落可直接照拍。<br>
        <b>本轮策略重心（针对「${esc(m.pain)}」）：${esc(r.play.focus)}</b> —— ${esc(r.play.rule)}
        <br>执行要点：${r.play.tactics.map(t => esc(t)).join(' / ')}
      </div>
      ${planHtml}
      ${mxHtml}

      <div class="rev">
        <div class="rev-h">
          数据复盘表
          <span>拍完把数字填回来，自动保存 · 每条只认它自己那两个指标</span>
          <button class="btn btn-ghost btn-xs no-print" id="rev-clear">清空</button>
        </div>
        <table class="tb">
          <thead><tr>
            <th style="width:4%">#</th>
            <th style="width:24%">组合</th>
            <th style="width:8%">优先级</th>
            <th style="width:22%">要看的数据</th>
            <th style="width:11%">${esc((r.matrix[0].kpi || [])[0] || '指标一')}</th>
            <th style="width:11%">${esc((r.matrix[0].kpi || [])[1] || '指标二')}</th>
            <th style="width:20%">结论 / 下一步</th>
          </tr></thead>
          <tbody>
            ${r.matrix.map(x => {
              const rv = (review || {})[x.idx] || {};
              const k = (x.kpi || []);
              return `<tr data-row="${esc(String(x.idx))}">
                <td>${x.idx}</td>
                <td>${esc(x.audience)} × ${esc(x.scene)}</td>
                <td>${esc(x.priority)}</td>
                <td class="rev-kpi">${esc(k.join(' / ') || '—')}</td>
                <td><input class="rev-in" data-row="${esc(String(x.idx))}" data-f="a" value="${esc(rv.a || '')}" inputmode="decimal" placeholder="${esc(k[0] || '')}"></td>
                <td><input class="rev-in" data-row="${esc(String(x.idx))}" data-f="b" value="${esc(rv.b || '')}" inputmode="decimal" placeholder="${esc(k[1] || '')}"></td>
                <td><input class="rev-in note" data-row="${esc(String(x.idx))}" data-f="note" value="${esc(rv.note || '')}" placeholder="下一条改什么"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="rev-sum" id="rev-sum"></div>
      </div>
    </div>

    <div class="rp-foot">
      <span>AI电商短视频内容策略 · 智能生成</span>
      <span>报告生成于 ${esc(m.date)} · 建议每条视频只测一个矩阵组合</span>
    </div>
  `;

  // 进度条动画：先渲染成 0，再赋值触发过渡
  requestAnimationFrame(() => {
    $$('#report-root .bar i').forEach(i => { i.style.width = i.dataset.w + '%'; });
  });

  const srcTip = $('#report-src');
  if (r.source === 'ai') {
    srcTip.innerHTML = `本报告由大模型生成（${esc((LLM.cfg && LLM.cfg.model) || 'AI')}）· 已自动保存到本地历史`;
    srcTip.className = 'src-tip ai no-print';
  } else {
    srcTip.innerHTML = `本报告由内置规则引擎生成 · 已自动保存到本地历史 · 想让内容更贴合产品，可在右上角「AI 设置」里填接口`;
    srcTip.className = 'src-tip no-print';
  }
  bindReview();
  updateRevSum();
}

/* ---------------- 复盘表：输入 → 存历史 → 实时小结 ---------------- */
let revTimer = null;
function bindReview() {
  const host = $('#rev-clear');
  if (host) host.addEventListener('click', () => {
    if (!curId) return;
    if (!confirm('清空这份报告的复盘数据？')) return;
    Store.clearReview(curId);
    $$('#report-root .rev-in').forEach(i => { i.value = ''; });
    updateRevSum();
  });
  $$('#report-root .rev-in').forEach(el => {
    el.addEventListener('input', () => {
      if (revTimer) clearTimeout(revTimer);
      revTimer = setTimeout(() => {
        if (!curId) return;
        const vals = Object.create(null);
        $$('#report-root .rev-in').forEach(i => {
          const row = i.dataset.row;
          // 无原型累加器：row 来自 data-row 属性，导入的备份可以把它设成
          // __proto__，那样 vals[row] || {} 会写到 Object.prototype 上，全页对象都跟着带属性
          if (!vals[row]) vals[row] = { a: '', b: '', note: '' };
          vals[row][i.dataset.f] = i.value;
        });
        Store.saveReview(curId, vals);
        updateRevSum();
      }, 400);   // 边打字边存会频繁写 localStorage，400ms 足够防抖
    });
  });
}
function updateRevSum() {
  const box = $('#rev-sum');
  if (!box) return;
  const rows = $$('#report-root .rev-in');
  if (!rows.length) return;
  const filled = new Set(rows.filter(i => i.value.trim()).map(i => i.dataset.row)).size;
  if (!filled) { box.innerHTML = ''; return; }
  // 有完整一行的才算"测完"，两格指标都有才算一组有效数据
  const done = $$('#report-root .rev table tbody tr').filter(tr => {
    const [a, b] = tr.querySelectorAll('input');
    return a && b && a.value.trim() && b.value.trim();
  }).length;
  box.innerHTML = `已填 <b>${filled}</b>/8 组，其中 <b>${done}</b> 组两项指标完整` +
    (done >= 3 ? ' · 数据够了，可以按结论决定下一轮拍什么' : ' · 至少填满 3 组再看趋势');
}

function scoreBar(name, val, cls = '', note = '') {
  // width 交给渲染后再设（触发 CSS 过渡，进度条从 0 长出来）
  return `
    <div class="score">
      <div class="sn"><span>${name}${note ? ` <small>${note}</small>` : ''}</span><b>${val}%</b></div>
      <div class="bar ${cls}"><i data-w="${val}"></i></div>
    </div>`;
}

/* ---------------- 历史：下拉 + 首页列表 ---------------- */
function refreshHistory() {
  const list = Store.getHistory();
  const sel = $('#history-sel');
  sel.innerHTML = `<option value="">历史报告（${list.length}）</option>` +
    list.map(x => `<option value="${esc(x.id)}">${esc(x.category)} · ${esc(x.date)}${x.source === 'ai' ? ' · AI' : ''}</option>`).join('');
  if (curId) sel.value = curId;
}
/* 打开一份历史报告：先渲染正文，再异步补产品图。
   图片存在 IndexedDB 里，不进 localStorage 也不进报告 JSON */
function openReport(id) {
  const rec = Store.getHistory().find(x => x.id === id);
  if (!rec) return;
  curId = id;
  showNotes([]);          // 清掉上一份报告的提示，避免张冠李戴
  renderReport(rec.report, rec.input);
  refreshHistory();
  if (curView !== 'report') go('report');
  else pushHash('report', id);
  ImgDB.get(id).then(imgs => {
    if (curId === id) renderShots(imgs);     // 期间又切了别的报告就丢弃这次结果
  });
}

$('#history-sel').addEventListener('change', e => {
  const id = e.target.value;
  if (!id) return;
  openReport(id);
});

function renderRecent() {
  const list = Store.getHistory().slice(0, 6);
  const sec = $('#recent-sec'), box = $('#recent-list'), guide = $('#start-guide');
  // 没有任何历史时给个起点，否则新用户打开只看到空的"最近报告"区
  if (guide) guide.style.display = list.length ? 'none' : '';
  if (!list.length) { sec.style.display = 'none'; box.innerHTML = ''; return; }
  sec.style.display = '';
  box.innerHTML = list.map(x => `
    <div class="card recent" data-open="${esc(x.id)}" role="button" tabindex="0"
         aria-label="打开报告：${esc(x.category)}，${esc(x.date)}">
      <div class="card-no">${x.source === 'ai' ? 'AI' : '本地'}</div>
      <h3>${esc(x.category)}</h3>
      <p>${esc(String(x.buyPoint).slice(0, 40))}…</p>
      <div class="recent-foot">${esc(x.date)} · 点击查看</div>
    </div>`).join('');
}
document.addEventListener('click', e => {
  const c = e.target.closest('.recent');
  if (!c) return;
  openReport(c.dataset.open);
});

$('#btn-del').addEventListener('click', () => {
  if (!curId) { alert('当前报告没有可删除的记录'); return; }
  if (!confirm('确定删除这份报告？删除后无法恢复。')) return;
  const id = curId;
  Store.delReport(id);
  ImgDB.del(id);              // 同步清掉图片，否则 IndexedDB 会一直占着空间
  curId = null;
  refreshHistory();
  go('create');
});

/* ---------------- 导出 ---------------- */
$('#btn-print').addEventListener('click', () => window.print());
$('#btn-copy').addEventListener('click', () => {
  const txt = $('#report-root').innerText;
  const done = () => alert('报告全文已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
  } else fallbackCopy(txt, done);
});
function fallbackCopy(txt, done) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); }
  catch (e) { alert('复制失败，请手动选择文本'); }
  ta.remove();
}
$('#btn-md').addEventListener('click', () => {
  if (!lastReport) return;
  const name = `${safeName(lastReport.meta.category)}_内容策略_${String(lastReport.meta.date).replace(/\//g, '')}`;
  downloadFile(name + '.md', toMarkdown(lastReport), 'text/markdown');
});
$('#btn-doc').addEventListener('click', () => {
  if (!lastReport) return;
  const name = `${safeName(lastReport.meta.category)}_内容策略_${String(lastReport.meta.date).replace(/\//g, '')}`;
  downloadFile(name + '.doc', toWordHtml(lastReport), 'application/msword');
});

/* ---------------- AI 电商知识库 ---------------- */
const KB_ARTICLES = [
  {
    t: '卖点五维拆解法',
    s: '把一句"我们很好"拆成五个能被用户感知的角度',
    items: [
      '<b>功能</b>：它是什么、怎么做到的（成分/材质/工艺/参数）',
      '<b>效果</b>：用了之后发生什么具体的改变',
      '<b>情绪</b>：用户心里被触动的部分（松弛、安心、体面）',
      '<b>信任</b>：凭什么相信你（检测、资质、数据、真实反馈）',
      '<b>差异化</b>：为什么是你不是别人（同价位唯一、别人做不到）',
      '拆解标准：每个维度至少 3 条，缺哪一维就在内容里补哪一维'
    ]
  },
  {
    t: '人群拆解：不是所有人都是你的用户',
    s: '五维打分决定这一轮主攻谁',
    items: [
      '<b>卖点匹配度</b>：你的卖点是不是正好打中他',
      '<b>痛点强度</b>：他不解决会不会难受，越痛决策越快',
      '<b>短视频表达难度</b>：越低越好，难表达的人群别硬拍',
      '<b>付费意愿</b>：愿不愿意为这件事掏钱',
      '<b>市场规模</b>：这条内容天花板有多高',
      '结论：只选一个"主攻"，内容口径统一，不要同时讨好三类人'
    ]
  },
  {
    t: '场景拆解：让产品进入真实生活',
    s: '没有场景的卖点，等于没有卖点',
    items: [
      '<b>日常场景</b>：每天都会发生的那个瞬间，用来证明高频刚需',
      '<b>新手翻车场景</b>：先演踩坑再给方案，冲突自带流量',
      '<b>对比场景</b>：量化差异，是建立信任最快的手段',
      '<b>情绪场景</b>：卖状态变化，不卖产品本身',
      '写法：场景必须具体到"几点、在哪、和谁、发生了什么"'
    ]
  },
  {
    t: '买点翻译公式',
    s: '卖点是商家想说的，买点是用户愿意掏钱的理由',
    items: [
      '功能 → 收益：<code>零添加</code> → 配料表干净到能念给家人听',
      '效果 → 可见：<code>28天改善</code> → 一个月后同事问你是不是换了粉底',
      '情绪 → 状态：<code>好用</code> → 不用再为这件事操心的踏实',
      '信任 → 风险转移：<code>有检测报告</code> → 把"试试看"变成"放心买"',
      '差异化 → 值得换：<code>同价位更高浓度</code> → 同样的钱多拿到那部分才是关键'
    ]
  },
  {
    t: '五段式脚本结构',
    s: '不会写脚本就照这个填',
    items: [
      '<b>0-3s 钩子</b>：结果前置 / 反常识 / 点名人群，不做铺垫',
      '<b>3-8s 痛点</b>：演一遍翻车，越具体越容易点头',
      '<b>8-15s 演示</b>：一镜到底 + 特写，别只拍全景',
      '<b>15-22s 证据</b>：检测报告 / 实测数据 / 价格锚点',
      '<b>22-28s 行动</b>：只给一个动作，形成记忆点',
      '时长建议 21-28 秒，完播优先于信息量'
    ]
  },
  {
    t: '测试矩阵怎么用',
    s: '一条视频只测一个组合',
    items: [
      '矩阵 = <b>人群 × 场景 × 买点</b>，8 组刚好是一轮小批量测试的量',
      '前 3 组优先拍，跑完看数据再决定要不要扩量',
      '同一场景换人群，是最快扩充选题库的方法',
      '记录每条的 3 秒完播率与商品点击，只认这两个数',
      '不要一条视频讲三个卖点，用户一个都记不住'
    ]
  },
  {
    t: '困境 → 策略重心对照表',
    s: '先诊断，再拍，别用错力',
    items: [
      '播放量低 → 前 3 秒钩子优先，结果前置',
      '有播放无转化 → 信任前置 + 价格锚点 + 明确 CTA',
      '不知道拍什么 → 场景切片法，一个组合一条',
      '人群不精准 → 前 5 秒点名人群身份',
      '内容同质化 → 固定一个抄不走的记忆锚点',
      '不会写脚本 → 直接套五段式结构',
      '怕违规限流 → 效果承诺改过程描述，绝对词改数据'
    ]
  },
  {
    t: '合规表达替换词表',
    s: '少踩坑，别让一条视频毁一条链接',
    items: [
      '<code>最好 / 第一 / 百分百有效</code> → 具体数字 + 条件限定',
      '<code>治疗 / 根治 / 特效</code> → 我的使用感受 / 日常护理',
      '<code>绝对安全 / 无任何副作用</code> → 检测报告显示 / 通过某项检测',
      '<code>全网最低价</code> → 这个价格段 / 同价位对比',
      '<code>所有人适用</code> → 适合 XX 人群，敏感人群建议先测试',
      '原则：主观感受可以讲，功效承诺不要讲'
    ]
  },
  {
    t: '开头 3 秒的四种写法',
    s: '完播率的胜负在这一句，播放量起不来先改这里',
    items: [
      '<b>结果前置</b>：直接给最终画面。"用了一个月，我的脸是这样"比任何铺垫都留得住人',
      '<b>反常识</b>：说一件大家以为不成立的事。"别买贵的，先看这三个数字"',
      '<b>点名人群</b>：前 3 秒把身份喊出来。"如果你是 30 岁以上的女性，这条一定要看完"',
      '<b>代价钩子</b>：先说损失。"别再花冤枉钱买精华了"',
      '绝对不要：自我介绍、公司介绍、"大家好我是…" —— 3 秒内没有任何画面信息，用户只会划走',
      '自查：把视频前 3 秒单独截成一张图，看不懂发生了什么就重拍'
    ]
  },
  {
    t: '价格锚点：怎么把"贵"变成"值"',
    s: '有播放没转化，多半是价格没被说清楚',
    items: [
      '<b>横向比</b>：跟同价位竞品比。不用说名字，说"这个价位里只有它能做到"',
      '<b>纵向比</b>：跟长期使用成本比。"一天不到三块"比"便宜"有用得多',
      '<b>拆分比</b>：把总价拆到单次。"一瓶能用三个月，算下来一天几毛钱"',
      '<b>对比省</b>：把省下的钱算出来。"按这个用，一年比买它省 400"',
      '话术：不要主动说"贵"，要说"这个价位段里它多给了你什么"',
      '避坑：虚标原价等于给自己埋雷，划线价必须有真实成交记录'
    ]
  },
  {
    t: 'AI 画面提示词怎么写才不出废片',
    s: '同一句描述，模型能不能出对画面全看这几点',
    items: [
      '<b>主体唯一</b>：一段只说一个主体。写"产品特写"而不是"产品和人还有桌面"',
      '<b>动作要具体</b>：写"手指划过屏幕"而不是"展示产品功能"',
      '<b>光线写方位</b>：左侧自然光 / 顶部柔和光 / 均匀无阴影，别只写"好看"',
      '<b>运镜只给一个</b>：推近 / 拉远 / 横移 / 静止。写"镜头快速推近又拉远"必然糊',
      '<b>环境给参照物</b>：写"木质餐桌"比写"干净台面"出图更稳',
      '<b>负面词必写</b>：变形手指、多张脸、文字乱码、水印、塑料感',
      '原则：一段提示词控制一个镜头，多镜头要分段写'
    ]
  },
  {
    t: '评论区是第二条视频',
    s: '很多账号的爆款其实长在评论区',
    items: [
      '发布后<b>置顶一条自己的评论</b>：补关键信息、留钩子。"检测报告在评论区置顶"',
      '<b>主动引导有效标签</b>：问一个能一句话回答的问题，算法才认得出这条视频讲什么',
      '把用户的高质量提问<b>做成下一条视频</b>，署名"评论区有人问"，天然带信任',
      '差评要正面回：讲清适用边界而不是辩解，边界清楚反而加分',
      '看到"求链接"立刻回，别让人等；也可以顺势做一条"怎么选"的视频',
      '禁止：刷评、引导私下交易、留微信 —— 直接限流'
    ]
  },
  {
    t: '账号定位：先定"不做什么"',
    s: '内容不垂直的根源，是没想清楚要放弃谁',
    items: [
      '<b>一句话定位</b>：我为「谁」解决「什么问题」，只写这一句，写不出来就别开拍',
      '<b>划定边界</b>：明确不接什么品类、不拍什么客单、不做哪类内容，比"什么都做"更重要',
      '<b>统一记忆锚点</b>：固定一个开场句式、固定道具、或固定测评方式，做成辨识度',
      '<b>选择难而深的</b>：人群窄一点没关系，讲透比讲全更容易起号',
      '<b>先想变现再想流量</b>：决定你能否长期做下去的是复购和客单，不是播放量',
      '自查：把最近 10 条视频并排看，如果看不出这是同一个号，定位就是散的'
    ]
  },
  {
    t: '一条视频的复盘：该看哪几个数',
    s: '数据太多反而看不出问题，每个阶段只认两个',
    items: [
      '<b>播放低</b>：看 3 秒完播率。低于 40% 就是开头的问题，别改后面',
      '<b>有播放没转化</b>：看商品点击率。低于 3% 说明证据没给够，别怪产品',
      '<b>点击了不下单</b>：看点击后转化率。要回到详情页和评论区找原因',
      '<b>人群不准</b>：看粉丝画像和评论关键词，跑偏的内容吸来的人也不准',
      '<b>同质化</b>：看搜索指数和自然流量占比，不涨说明没做出记忆点',
      '纪律：一条视频只测一个变量，同时改三处永远不知道是哪处起的作用'
    ]
  },
  {
    t: '新手最常犯的七个错',
    s: '避过这些，至少少走三个月弯路',
    items: [
      '<b>一条视频讲三个卖点</b>：用户一个都记不住，留下的只有一个',
      '<b>先做品牌再做内容</b>：没人关心你是谁，只关心这事跟我有没有关系',
      '<b>照搬别人的爆款</b>：品类、人群、场景都不一样，抄结构不抄内容',
      '<b>只发不测</b>：不记录数据，就永远不知道哪一步有用',
      '<b>舍不得删旧内容</b>：数据明显差的视频占着篇幅，稀释账号权重',
      '<b>一条不行就换方向</b>：至少测满 8 条组合再判断，数据波动大是常态',
      '<b>不做合规检查</b>：一条限流能把前面的积累一起拖下去'
    ]
  }
];

/* ---------------- 知识库搜索 ----------------
   文章里的 <b>/<code> 是刻意排版的，检索要按纯文本匹配，渲染要保留标记。
   命中处直接标黄，扫一眼就知道是第几条对上了。 */
const stripTags = s => String(s == null ? '' : s).replace(/<[^>]+>/g, '');

/* 主题标签：k 是正则（支持 | 或关系），t 是按钮文字。
   覆盖知识库里的主要方法论名词，点一下就能筛出相关篇目 */
const KB_CHIPS = [
  { k: '钩子|开头 3 秒|开头3秒|完播', t: '开头钩子' },
  { k: '人群|定位', t: '人群定位' },
  { k: '场景', t: '场景' },
  { k: '转化|价格锚点|定价|客单', t: '转化与定价' },
  { k: '脚本|分镜|口播|五段式', t: '脚本' },
  { k: '矩阵|组合|测试', t: '矩阵测试' },
  { k: '违禁|绝对化|替换词|违规|合规', t: '合规' },
  { k: '画面|提示词|出片|运镜|光线|主体', t: '画面提示词' },
  { k: '评论', t: '评论区' },
  { k: '复盘|完播率|点击率|数据', t: '数据复盘' },
  { k: '卖点|五维|买点', t: '卖点买点' },
  { k: '新手|常见|别再|不要|绝对不', t: '避坑' }
];

function kbHighlight(text, terms) {
  // 只保留知识库自己写死的 <b>/<code>，其余段落全部按纯文本转义。
  // 直接对整串做转义会把这两个标记也毁掉，所以先按标签切段再分别处理。
  const parts = String(text == null ? '' : text).split(/(<\/?(?:b|code)>)/i);
  let out = '';
  for (const p of parts) {
    out += /^<\/?(?:b|code)>$/i.test(p) ? p : esc(p);
  }
  terms.forEach(t => {
    if (!t) return;
    const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(safe, 'gi'), m => `\u0001${m}\u0002`);
  });
  // 只把我们自己包进去的标记转成 <mark>，不碰原有的 <b>/<code>
  return out.split('\u0001').join('<mark>').split('\u0002').join('</mark>');
}

/* 检索条件有两种来源：
   1) 用户在搜索框里输入的词 —— 纯文本，空格分隔，按 AND 匹配
   2) 主题标签点选的 —— 正则串（含 | 或关系），走正则匹配
   两者混用时（搜索框有词又点了标签）取交集，符合"越筛越窄"的直觉 */
function kbConditions(q, chipRe) {
  const terms = String(q || '').trim().split(/\s+/).filter(Boolean);
  const conds = [];
  if (terms.length) conds.push({ kind: 'text', value: terms });
  if (chipRe) conds.push({ kind: 're', value: new RegExp(chipRe, 'i') });
  return conds;
}
function kbMatch(article, conds) {
  if (!conds.length) return true;
  const hay = [article.t, article.s].concat(article.items).map(stripTags).join(' ');
  const low = hay.toLowerCase();
  return conds.every(c =>
    c.kind === 're' ? c.value.test(hay) : c.value.every(t => low.indexOf(t.toLowerCase()) >= 0));
}

function renderKB(q, chipRe) {
  const conds = kbConditions(q, chipRe);
  const terms = String(q || '').trim().split(/\s+/).filter(Boolean);
  const hit = KB_ARTICLES.filter(a => kbMatch(a, conds));
  const grid = $('#kb-grid'), empty = $('#kb-empty'), count = $('#kb-count');
  // 高亮只标注搜索框里的词；标签是正则，直接标会把原文切碎
  grid.innerHTML = hit.map(a => `
    <div class="kb">
      <h3>${kbHighlight(a.t, terms)}</h3>
      <div class="kb-sub">${kbHighlight(a.s, terms)}</div>
      <ul>${a.items.map(i => `<li>${kbHighlight(i, terms)}</li>`).join('')}</ul>
    </div>`).join('');
  if (empty) {
    empty.style.display = hit.length ? 'none' : '';
    const echo = $('#kb-q-echo');
    if (echo) echo.textContent = terms.join(' ') || (chipRe ? '当前筛选' : '');
  }
  if (count) {
    count.textContent = conds.length
      ? `${hit.length} / ${KB_ARTICLES.length} 篇匹配`
      : `${KB_ARTICLES.length} 篇`;
  }
  $$('#kb-chips .kb-chip').forEach(b => {
    b.classList.toggle('on', !!chipRe && b.dataset.kbChip === chipRe);
  });
  initReveal(grid);
  return hit.length;
}

let curChip = null;
$('#kb-q').addEventListener('input', e => renderKB(e.target.value, curChip));
$('#kb-reset').addEventListener('click', () => {
  $('#kb-q').value = '';
  curChip = null;
  renderKB('', null);
  $('#kb-q').focus();
});
$('#kb-chips').innerHTML = KB_CHIPS.map(c =>
  `<button class="kb-chip" data-kb-chip="${esc(c.k)}" type="button">${esc(c.t)}</button>`).join('');
$('#kb-chips').addEventListener('click', e => {
  const b = e.target.closest('[data-kb-chip]');
  if (!b) return;
  const kw = b.dataset.kbChip;
  curChip = curChip === kw ? null : kw;   // 再次点同一主题 = 取消筛选
  renderKB($('#kb-q').value, curChip);
});

renderKB('', null);

/* ---------------- 启动 ---------------- */
LLM.load();
refreshHistory();
renderRecent();
restoreDraft();
setupObserver();

/* engine.js 提供 60 多个顶层符号，llm.js 依赖其中 22 个、app.js 依赖 3 个。
   全是裸的全局引用、没有 import：engine.js 一旦没加载成功（文件缺失、路径写错、
   被缓存挡住），只有首次点「生成」才报 ReferenceError，而且会落进 Promise 的
   reject 分支，界面只显示"生成失败"—— 真正的根因被完全掩盖。
   所以启动时先探一次，缺失就把生成按钮禁用并说明原因。

   注意必须用裸标识符 typeof，不能用 window[n]：
   脚本顶层的 const（KB、CONTENT_TYPES 等）只进全局词法环境，不是 window 的属性，
   window['KB'] 永远是 undefined，会把正常的页面也误判成引擎缺失。 */
const ENGINE_REQUIRED = ['generateReport', 'matchCategory', 'KB', 'personAnchor', 'buildPrompt',
  'shortShotText', 'proofVisualOf', 'buildTypePlan', 'assignStrategy'];
(function engineSelfCheck() {
  // typeof 对未声明的标识符不抛错，所以可以安全地逐个探测
  const missing = [
    typeof generateReport === 'undefined' ? 'generateReport' : '',
    typeof matchCategory === 'undefined' ? 'matchCategory' : '',
    typeof KB === 'undefined' ? 'KB' : '',
    typeof personAnchor === 'undefined' ? 'personAnchor' : '',
    typeof buildPrompt === 'undefined' ? 'buildPrompt' : '',
    typeof shortShotText === 'undefined' ? 'shortShotText' : '',
    typeof proofVisualOf === 'undefined' ? 'proofVisualOf' : '',
    typeof buildTypePlan === 'undefined' ? 'buildTypePlan' : '',
    typeof assignStrategy === 'undefined' ? 'assignStrategy' : ''
  ].filter(Boolean);
  if (!missing.length) return;
  console.error('[启动自检] engine.js 未加载成功，缺失：', missing);
  const kill = () => {
    // 生成按钮是 form 里的 type=submit，没有 id，按选择器拿
    const btn = $('#form button[type="submit"]');
    if (btn) { btn.disabled = true; btn.title = '引擎文件未加载，无法生成'; }
    const tip = $('#engineMissing');
    if (tip) {
      tip.hidden = false;
      tip.textContent = '引擎文件 engine.js 没有加载成功，生成功能不可用。'
        + '请确认它和 index.html 在同一个目录，然后强制刷新（Ctrl+F5）。缺失项：' + missing.join('、');
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kill);
  else kill();
})();
// 启动时按 hash 决定落地页；没 hash 就留在首页
(function boot() {
  const { view, arg } = parseHash();
  if (view === 'report' && arg && Store.getHistory().some(x => x.id === arg)) {
    openReport(arg);
  } else {
    go('home', { silent: true });
    if (!location.hash) pushHash('home');
  }
  initReveal($('#view-home'));
  requestAnimationFrame(() => showInView($('#view-home')));
  $$('#view-home .stat b[data-count]').forEach(countUp);
})();

// 导航毛玻璃：滚动后才显边框，首屏保持通透
window.addEventListener('scroll', () => {
  $('.topbar').classList.toggle('scrolled', window.scrollY > 8);
}, { passive: true });