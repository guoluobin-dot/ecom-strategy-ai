/* ===========================================================
   产品图片仓库：IndexedDB
   为什么不用 localStorage —— 5MB 上限，8 张原图就撑爆，
   配额满还会抛 QuotaExceededError 把生成流程卡死。
   IndexedDB 是浏览器为二进制/大对象准备的，容量大得多。
   报告正文仍存 localStorage，这里只存图片，按报告 id 关联。
   =========================================================== */

const ImgDB = {
  DB: 'ai_ecom_imgs',
  STORE: 'shots',
  _db: null,
  _failed: false,          // IndexedDB 不可用时置位，后续直接跳过，不再反复重试

  open() {
    if (this._db) return Promise.resolve(this._db);
    if (this._failed) return Promise.resolve(null);
    return new Promise(resolve => {
      let req;
      try { req = indexedDB.open(this.DB, 1); }
      catch (e) { this._failed = true; return resolve(null); }   // 隐私模式等场景会直接抛

      const bail = () => { this._failed = true; resolve(null); };
      // 某些环境（如无痕窗口）既不 success 也不 error，加超时兜底避免永久挂起
      const timer = setTimeout(bail, 3000);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE);
      };
      req.onsuccess = e => {
        clearTimeout(timer);
        this._db = e.target.result;
        // 别的标签页或新版本会升版本；不主动关掉的话这个句柄会一直挡着对方
        this._db.onversionchange = () => { try { this._db.close(); } catch (e) {} this._db = null; };
        resolve(this._db);
      };
      req.onerror = () => { clearTimeout(timer); bail(); };
      req.onblocked = () => { clearTimeout(timer); bail(); };
    });
  },

  _tx(mode, fn) {
    return this.open().then(db => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(this.STORE, mode); }
        catch (e) { return resolve(null); }
        const req = fn(tx.objectStore(this.STORE));
        tx.oncomplete = () => resolve(req ? req.result : null);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB 写入失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB 写入中止'));
      }).catch(() => null);   // 存储失败一律降级为"图片没存上"，不打断主流程
    });
  },

  /* 存一份报告的产品图；ids 为报告 id。
     备份导入是这条路径的主要入口，所以这里必须自己校验：
     只收 data:image/ 开头的字符串，且强制是数组 ——
     否则一个手改过的备份既能往 <img src> 里塞任意地址，
     也能让 .map 抛错导致素材区整个渲染不出来。 */
  put(id, images) {
    const pick = v => (Array.isArray(v) ? v : [])
      .filter(s => typeof s === 'string' && /^data:image\//.test(s))
      .slice(0, 20);
    const data = { main: pick(images && images.main), detail: pick(images && images.detail) };
    if (!data.main.length && !data.detail.length) return Promise.resolve(false);
    // _tx 失败时 resolve(null)，.then(() => true) 会把失败报成成功
    return this._tx('readwrite', s => s.put(data, id)).then(r => r !== null);
  },

  get(id) {
    if (!id) return Promise.resolve(null);
    return this._tx('readonly', s => s.get(id)).then(r => r || null);
  },

  del(id) {
    if (!id) return Promise.resolve(false);
    return this._tx('readwrite', s => s.delete(id)).then(r => r !== null);
  },

  clear() { return this._tx('readwrite', s => s.clear()).then(() => true); },

  /* 估算已用空间，给设置面板显示 */
  usage() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate()
        .then(e => ({ used: e.usage || 0, quota: e.quota || 0 }))
        .catch(() => null);
    }
    return Promise.resolve(null);
  }
};
