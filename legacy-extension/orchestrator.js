// orchestrator.js  v3.1
// ============================================================
// v3.1 変更点（v3.0 からの差分のみ）
//   [FIX-1] content.js 未注入時の "Could not establish connection" エラー対策
//           → navigateTabTo 後に content.js への ping リトライを挟み
//             注入完了を確認してから startScraping を送信する
//   [FIX-2] waitForComboDone にタイムアウト（10分）を追加し無限待機を防止
//   [FIX-3] v3Drive() 重複実行防止フラグ (driveRunning) を追加
//   [FIX-4] SW 再起動後の自動再開で既存ドライブと衝突しないよう制御
//   [SPEED-1] waitForTabComplete: DOM 完了後の固定待ち 1500ms → 800ms
//   [SPEED-2] content.js ping リトライ間隔を 200ms に短縮
//   [SPEED-3] navigateTabTo: waitForTabComplete のタイムアウト 30s → 20s
// ============================================================

// ---- storage key 名前空間 ----------------------------------
const V3K = {
  state: 'v3_state',           // 'idle' | 'running' | 'paused' | 'done'
  city: 'v3_city',
  areas: 'v3_areas',
  genres: 'v3_genres',
  totalAreas: 'v3_totalAreas',
  totalGenres: 'v3_totalGenres',
  areaIdx: 'v3_areaIdx',
  genreIdx: 'v3_genreIdx',
  currentArea: 'v3_currentArea',
  currentGenre: 'v3_currentGenre',
  currentUrl: 'v3_currentUrl',
  currentKw: 'v3_currentKeyword',
  logs: 'v3_logs',
  collected: 'v3_collectedData',
  startTime: 'v3_startTime',
  comboDurations: 'v3_comboDurations',
  tabId: 'v3_tabId',
  maxItems: 'v3_maxItems',
  comboStart: 'v3_comboStart'
};

const V3_LOG_MAX = 500;

// ---- [FIX-3] 重複ドライブ防止 ------------------------------
let driveRunning = false;

// ---- 共通ユーティリティ ------------------------------------
function v3Get(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}
function v3Set(obj) {
  return new Promise(r => chrome.storage.local.set(obj, r));
}

function v3Timestamp() {
  const d = new Date();
  const z = n => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

async function v3Log(message) {
  const r = await v3Get([V3K.logs]);
  const logs = Array.isArray(r[V3K.logs]) ? r[V3K.logs] : [];
  logs.push({ t: v3Timestamp(), msg: message });
  if (logs.length > V3_LOG_MAX) logs.splice(0, logs.length - V3_LOG_MAX);
  await v3Set({ [V3K.logs]: logs });
  try { chrome.runtime.sendMessage({ action: 'v3_logPush', entry: logs[logs.length - 1] }); } catch (_) { }
}

// ---- offscreen document ------------------------------------
const OFFSCREEN_PATH = 'offscreen.html';
let creatingOffscreen = null;

async function hasOffscreen() {
  if (!chrome.offscreen || !chrome.runtime.getContexts) return false;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    });
    return contexts.length > 0;
  } catch (e) {
    return false;
  }
}

async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  if (await hasOffscreen()) return true;
  if (creatingOffscreen) { await creatingOffscreen; return true; }
  try {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS'],
      justification: 'v3 バックグラウンド継続実行のためのキープアライブ／タイマー'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
    return true;
  } catch (e) {
    creatingOffscreen = null;
    console.warn('[v3] offscreen create error:', e);
    return false;
  }
}

async function closeOffscreen() {
  if (!chrome.offscreen) return;
  if (await hasOffscreen()) {
    try { await chrome.offscreen.closeDocument(); } catch (_) { }
  }
}

// ---- areas.json / genres.json ロード -----------------------
async function loadJson(path) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  return res.json();
}

async function getAreasForCity(rawCity) {
  const data = await loadJson('config/areas.json');
  if (!data || !data.cities) return [];
  const cities = data.cities;
  if (cities[rawCity]) return cities[rawCity].slice();
  const noSuffix = rawCity.replace(/[市区]$/, '');
  for (const key of Object.keys(cities)) {
    if (key === rawCity || key.replace(/[市区]$/, '') === noSuffix) return cities[key].slice();
  }
  for (const key of Object.keys(cities)) {
    if (key.includes(rawCity) || rawCity.includes(key.replace(/[市区]$/, ''))) return cities[key].slice();
  }
  return [];
}

async function getGenres() {
  const data = await loadJson('config/genres.json');
  return (data && Array.isArray(data.genres)) ? data.genres.slice() : [];
}

// ---- タブ管理 ----------------------------------------------
async function ensureMapTab() {
  const r = await v3Get([V3K.tabId]);
  let tabId = r[V3K.tabId];
  if (tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t) return tabId;
    } catch (_) { /* タブが閉じられていた */ }
  }
  const tab = await chrome.tabs.create({ url: 'https://www.google.co.jp/maps', active: true });
  await v3Set({ [V3K.tabId]: tab.id });
  return tab.id;
}

// [SPEED-1] DOM 完了後の待ち 1500ms → 800ms → 600ms
function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => {
      if (!done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(ok);
      }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    function listener(updatedId, changeInfo) {
      if (updatedId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        // [SPEED-1] React/Maps 描画待ち: 800ms → 600ms
        setTimeout(() => finish(true), 600);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigateTabTo(tabId, url) {
  await chrome.tabs.update(tabId, { url, active: false });
  return waitForTabComplete(tabId);
}

// ---- [FIX-1] content.js 注入確認（ping リトライ付き） -----
// content.js が DOM に注入されるまで最大 retryMs を待つ。
// 「Receiving end does not exist」エラーはここで吸収する。
async function waitForContentScript(tabId, retryMs = 12000, intervalMs = 150) {
  const deadline = Date.now() + retryMs;
  while (Date.now() < deadline) {
    try {
      const res = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, resp => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(resp);
        });
      });
      if (res && res.alive) return true;
    } catch (_) {
      // content.js 未注入 or SW との接続なし → [SPEED-2] 200ms 待って再試行
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// ---- [FIX-2] waitForComboDone: タイムアウト付き ----------
function waitForComboDone(area, genre, timeoutMs = 600000) { // 10分
  return new Promise(resolve => {
    let lastReportedCount = 0;
    let timedOut = false;

    const timeoutTimer = setTimeout(async () => {
      timedOut = true;
      chrome.storage.onChanged.removeListener(handler);
      await v3Log(`⚠ ${area} ${genre} タイムアウト（10分経過）`);
      resolve([]);
    }, timeoutMs);

    const handler = async (changes, ns) => {
      if (ns !== 'local' || timedOut) return;

      // 進捗通知
      if (changes.scrapedData) {
        const newVal = Array.isArray(changes.scrapedData.newValue) ? changes.scrapedData.newValue : [];
        if (newVal.length !== lastReportedCount) {
          lastReportedCount = newVal.length;
          await v3Log(`取得件数 ${newVal.length}件`);
          chrome.runtime.sendMessage({ action: 'v3_progress' }).catch(() => { });
        }
      }

      // 完了通知
      if (changes.scrapingState && changes.scrapingState.newValue === 'done') {
        clearTimeout(timeoutTimer);
        chrome.storage.onChanged.removeListener(handler);

        const r = await v3Get(['scrapedData', V3K.collected]);
        const fresh = Array.isArray(r.scrapedData) ? r.scrapedData : [];
        const collected = Array.isArray(r[V3K.collected]) ? r[V3K.collected] : [];

        const enriched = fresh.map(it => ({ ...it, sourceGenre: genre, area }));
        const merged = collected.concat(enriched);
        await v3Set({ [V3K.collected]: merged });
        await v3Log(`${genre} 完了 (本コンボ ${enriched.length}件 / 累計 ${merged.length}件)`);
        chrome.runtime.sendMessage({ action: 'v3_progress' }).catch(() => { });
        resolve(enriched);
      }
    };
    chrome.storage.onChanged.addListener(handler);
  });
}

// ---- 1コンボ実行 -------------------------------------------
async function runCombo(area, genre) {
  const keyword = `${area} ${genre}`.trim();
  const url = `https://www.google.co.jp/maps/search/${encodeURIComponent(keyword)}`;

  await v3Set({
    [V3K.currentArea]: area,
    [V3K.currentGenre]: genre,
    [V3K.currentKw]: keyword,
    [V3K.currentUrl]: url,
    [V3K.comboStart]: Date.now(),
    scrapedData: [],
    scrapingState: 'inactive'
  });

  await v3Log(`${area} ${genre} 開始`);

  const tabId = await ensureMapTab();
  const ok = await navigateTabTo(tabId, url);
  if (!ok) {
    await v3Log(`⚠ ${area} ${genre} ページ読み込みタイムアウト`);
    return { count: 0, items: [] };
  }

  // ページ遷移直後はcontent.js再注入に時間がかかるため待機
  // [修正8] waitForContentScript が 150ms 間隔リトライ済みのため固定待ちを 800ms → 300ms に短縮
  await new Promise(r => setTimeout(r, 1500));

  const contentReady = await waitForContentScript(tabId, 15000, 200);
  if (!contentReady) {
    await v3Log(`⚠ ${area} ${genre} content.js 未応答（スキップ）`);
    return { count: 0, items: [] };
  }

  const maxItemsR = await v3Get([V3K.maxItems]);
  const maxItems = maxItemsR[V3K.maxItems] || 100;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
          action: 'startScraping',
          maxItems,
          targetGenres: [],
          filterConfig: { enabled: false },
          searchArea: area
        }, response => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(response);
        });
      });
      break; // 成功したらループを抜ける
    } catch (e) {
      await v3Log(`⚠ ${area} ${genre} startScraping 失敗(試行${attempt}): ${e?.message || e}`);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000));
        const retryReady = await waitForContentScript(tabId, 5000, 150);
        if (!retryReady) {
          await v3Log(`⚠ ${area} ${genre} content.js 再注入タイムアウト → スキップ`);
          return { count: 0, items: [] };
        }
      } else {
        return { count: 0, items: [] };
      }
    }
  }

  const items = await waitForComboDone(area, genre);
  return { count: items.length, items };
}

// ---- メインドライバ ----------------------------------------
async function v3Drive() {
  // [FIX-3] 重複起動防止
  if (driveRunning) {
    console.warn('[v3] v3Drive() は既に実行中です。重複起動をスキップします。');
    return;
  }
  driveRunning = true;

  try {
    const r = await v3Get([
      V3K.state, V3K.areas, V3K.genres, V3K.areaIdx, V3K.genreIdx,
      V3K.totalAreas, V3K.totalGenres, V3K.comboDurations
    ]);
    if (r[V3K.state] !== 'running') return;

    const areas = r[V3K.areas] || [];
    const genres = r[V3K.genres] || [];
    let areaIdx = r[V3K.areaIdx] || 0;
    let genreIdx = r[V3K.genreIdx] || 0;
    const durations = Array.isArray(r[V3K.comboDurations]) ? r[V3K.comboDurations] : [];

    while (true) {
      const cur = await v3Get([V3K.state]);
      if (cur[V3K.state] !== 'running') { await v3Log('停止しました'); return; }

      if (areaIdx >= areas.length) break;

      const area = areas[areaIdx];
      if (genreIdx >= genres.length) {
        areaIdx++;
        genreIdx = 0;
        await v3Set({ [V3K.areaIdx]: areaIdx, [V3K.genreIdx]: 0 });
        continue;
      }
      const genre = genres[genreIdx];

      await v3Set({ [V3K.areaIdx]: areaIdx, [V3K.genreIdx]: genreIdx });
      const t0 = Date.now();
      await runCombo(area, genre);
      const dt = (Date.now() - t0) / 1000;
      durations.push(dt);
      await v3Set({ [V3K.comboDurations]: durations });

      genreIdx++;
    }

    await v3Set({ [V3K.state]: 'done' });
    await v3Log(`🎉 全エリア × 全ジャンル 取得完了`);
    chrome.runtime.sendMessage({ action: 'v3_done' }).catch(() => { });
    await closeOffscreen();

  } catch (e) {
    console.error('[v3] drive error:', e);
    await v3Log(`致命的エラー: ${e?.message || e}`);
    await v3Set({ [V3K.state]: 'idle' });
  } finally {
    driveRunning = false;
  }
}

// ---- message handlers --------------------------------------
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || !req.action) return false;

  if (req.action === 'v3_getAreas') {
    (async () => {
      const areas = await getAreasForCity(req.city || '');
      sendResponse({ ok: true, areas });
    })();
    return true;
  }

  if (req.action === 'v3_getGenres') {
    (async () => {
      const genres = await getGenres();
      sendResponse({ ok: true, genres });
    })();
    return true;
  }

  if (req.action === 'v3_start') {
    (async () => {
      const { city, areas, genres, maxItems } = req;
      let useAreas = areas && areas.length ? areas : await getAreasForCity(city || '');
      if (!useAreas || !useAreas.length) {
        if (city) useAreas = [city];
      }
      const useGenres = genres && genres.length ? genres : await getGenres();

      await v3Set({
        [V3K.state]: 'running',
        [V3K.city]: city || '',
        [V3K.areas]: useAreas,
        [V3K.genres]: useGenres,
        [V3K.totalAreas]: useAreas.length,
        [V3K.totalGenres]: useGenres.length,
        [V3K.areaIdx]: 0,
        [V3K.genreIdx]: 0,
        [V3K.logs]: [],
        [V3K.collected]: [],
        [V3K.startTime]: Date.now(),
        [V3K.comboDurations]: [],
        [V3K.maxItems]: maxItems || 100,
        scrapedData: []
      });
      await v3Log(`v3 開始: ${city || '(エリア指定なし)'} | 区 ${useAreas.length} × ジャンル ${useGenres.length}`);

      try { chrome.power.requestKeepAwake('display'); } catch (_) { }
      try { chrome.alarms.create('v3_tick', { periodInMinutes: 0.5 }); } catch (_) { }
      await ensureOffscreen();

      sendResponse({ ok: true, totalAreas: useAreas.length, totalGenres: useGenres.length });

      // [FIX-3] driveRunning フラグ付きで起動
      v3Drive().catch(async e => {
        console.error('[v3] drive error:', e);
        await v3Log(`致命的エラー: ${e?.message || e}`);
        await v3Set({ [V3K.state]: 'idle' });
        driveRunning = false;
      });
    })();
    return true;
  }

  if (req.action === 'v3_stop') {
    (async () => {
      await v3Set({ [V3K.state]: 'idle' });
      await v3Log('🛑 STOP が押されました');
      const r = await v3Get([V3K.tabId]);
      if (r[V3K.tabId]) {
        try { chrome.tabs.sendMessage(r[V3K.tabId], { action: 'stopScraping' }); } catch (_) { }
      }
      try { chrome.power.releaseKeepAwake(); } catch (_) { }
      try { chrome.alarms.clear('v3_tick'); } catch (_) { }
      await closeOffscreen();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (req.action === 'v3_reset') {
    (async () => {
      driveRunning = false;
      await v3Set({
        [V3K.state]: 'idle',
        [V3K.areas]: [], [V3K.genres]: [],
        [V3K.areaIdx]: 0, [V3K.genreIdx]: 0,
        [V3K.totalAreas]: 0, [V3K.totalGenres]: 0,
        [V3K.currentArea]: '', [V3K.currentGenre]: '',
        [V3K.currentUrl]: '', [V3K.currentKw]: '',
        [V3K.logs]: [], [V3K.collected]: [],
        [V3K.startTime]: 0, [V3K.comboDurations]: []
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (req.action === 'v3_getStatus') {
    (async () => {
      const r = await v3Get([
        V3K.state, V3K.city, V3K.areas, V3K.genres,
        V3K.areaIdx, V3K.genreIdx, V3K.totalAreas, V3K.totalGenres,
        V3K.currentArea, V3K.currentGenre, V3K.currentUrl, V3K.currentKw,
        V3K.logs, V3K.collected, V3K.startTime, V3K.comboDurations
      ]);
      sendResponse({ ok: true, status: r });
    })();
    return true;
  }

  if (req.action === 'v3_ping') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// alarms によるキープアライブ & 状態確認
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'v3_tick') return;
  const r = await v3Get([V3K.state, V3K.tabId]);
  if (r[V3K.state] !== 'running') return;
  await ensureOffscreen();
  if (r[V3K.tabId]) {
    try { chrome.tabs.sendMessage(r[V3K.tabId], { action: 'ping' }).catch(() => { }); } catch (_) { }
  }
  // [FIX-4] SW 復帰後、v3Drive() が止まっていたら再起動
  if (!driveRunning) {
    v3Drive().catch(e => console.error('[v3 alarm] drive restart error:', e));
  }
});

// SW 起動時に "running" のままだったら自動再開
chrome.runtime.onStartup.addListener(async () => {
  const r = await v3Get([V3K.state]);
  if (r[V3K.state] === 'running') {
    await ensureOffscreen();
    // [FIX-4] driveRunning チェック付き
    if (!driveRunning) {
      v3Drive().catch(() => { });
    }
  }
});

self.addEventListener?.('activate', async () => {
  const r = await v3Get([V3K.state]);
  if (r[V3K.state] === 'running' && !driveRunning) {
    v3Drive().catch(() => { });
  }
});