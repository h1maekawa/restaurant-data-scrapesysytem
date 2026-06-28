// content.js  v3.4.2 (共通スキーマ対応版 + 住所/原文ノイズ除去 + HP高精度判定)
// v3.3.1ベース + 共通スキーマ出力、厳格エリアフィルタ、営業時間原文・複数枠対応、HP高精度フィルタ

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function backgroundSleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getCurrentQuery() {
  return document.querySelector('input#searchboxinput')?.value?.trim() || '';
}

function extractNameFromUrl(url) {
  try {
    const match = url.match(/\/maps\/place\/([^/]+)\//);
    if (!match) return '';
    return decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
  } catch (e) { return ''; }
}

// =====================================================================
// 【新規】住所文字列から都道府県と市区町村を抽出する関数
// =====================================================================
function parseAddress(address) {
  // 「〒123-4567 」のような郵便番号や「日本、」という国名表記を除去
  let cleanAddress = address.replace(/(?:〒\d{3}-\d{4}\s*|日本、\s*)/g, '').trim();
  
  // 都道府県と市区町村を正規表現で分離
  const regex = /^((?:北海道|東京都|大阪府|京都府|.{2,3}県))?((?:.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村]))?(.+)?$/;
  const m = cleanAddress.match(regex);
  
  if (!m) return { prefecture: '', city: '' };
  return { prefecture: m[1] || '', city: m[2] || '' };
}

// =====================================================================
// 詳細パネル判定
// =====================================================================
function isDetailPanelOpen() {
  return !!document.querySelector('button[data-item-id="address"]');
}

async function waitForDetailPanel(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isDetailPanelOpen()) return true;
    await sleep(100);
  }
  return false;
}

async function waitForListPanel(timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isDetailPanelOpen()) return true;
    await sleep(100);
  }
  return false;
}

let searchPageUrl = '';

async function closeDetailPanel() {
  if (!isDetailPanelOpen()) return true;

  const backButton = Array.from(document.querySelectorAll('button[aria-label], a[aria-label]'))
    .find(el => /戻る|Back/i.test(el.getAttribute('aria-label') || ''));
  if (backButton) {
    backButton.click();
    const listReady = await waitForListPanel(5000);
    if (listReady && getScrollContainer()) return true;
  }

  try {
    window.history.back();
    const listReady = await waitForListPanel(5000);
    if (listReady && getScrollContainer()) return true;
  } catch (_) { /* ignore */ }

  try {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true
    }));
    const listReady = await waitForListPanel(2000);
    if (listReady && getScrollContainer()) return true;
  } catch (_) { /* ignore */ }

  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (!isDetailPanelOpen() && getScrollContainer()) return true;
    await sleep(200);
  }

  return false;
}

// =====================================================================
// リスト終端検知
// =====================================================================
function isEndOfList(container) {
  if (isDetailPanelOpen()) return false;
  const target = container || document.body;
  const text = target.innerText || '';
  return /リストの最後に到達しました|You've reached the end of the list/.test(text);
}

// =====================================================================
// 営業時間パース (複数枠 A/B 対応)
// =====================================================================
const WEEKDAY_IDX = { '月': 0, '火': 1, '水': 2, '木': 3, '金': 4, '土': 5, '日': 6 };
const IDX_TO_DAY = ['月', '火', '水', '木', '金', '土', '日'];
const DINNER_START_HOUR = 15;

function parseOpeningHours(rows) {
  if (!rows || !rows.length) {
    return { businessDays: '', openTimeA: '', closeTimeA: '', openTimeB: '', closeTimeB: '', regularHoliday: '' };
  }

  const blocks = [], closedIdx = [];

  for (const row of rows) {
    const dayMatch = row.match(/^([月火水木金土日])曜日/);
    if (!dayMatch) continue;
    const dayIdx = WEEKDAY_IDX[dayMatch[1]];
    if (dayIdx === undefined) continue;

    if (row.includes('定休日') || row.includes('休業')) {
      closedIdx.push(dayIdx);
      continue;
    }

    const times = [];
    let m;
    const re1 = /(\d{1,2})時(\d{2})分[〜～]\s*(\d{1,2})時(\d{2})分/g;
    while ((m = re1.exec(row)) !== null) {
      let open = parseInt(m[1]), close = parseInt(m[3]);
      if (close < open) close += 24;
      times.push({ open, close, openMinute: parseInt(m[2]), closeMinute: parseInt(m[4]) });
    }
    if (!times.length) {
      const re2 = /(\d{1,2}):(\d{2})\s*[〜～－\-]\s*(\d{1,2}):(\d{2})/g;
      while ((m = re2.exec(row)) !== null) {
        let open = parseInt(m[1]), close = parseInt(m[3]);
        if (close < open) close += 24;
        times.push({ open, close, openMinute: parseInt(m[2]), closeMinute: parseInt(m[4]) });
      }
    }
    
    if (times.length > 0) {
      const daytime = times.find(t => t.open < DINNER_START_HOUR);
      const dinner = times.find(t => t.open >= DINNER_START_HOUR)
        || times.find(t => t !== daytime);
      blocks.push({ 
        dayIdx, 
        openA: daytime ? daytime.open : '', 
        closeA: daytime ? daytime.close : '',
        openB: dinner ? dinner.open : '',
        closeB: dinner ? dinner.close : ''
      });
    }
  }

  if (!blocks.length) return {
    businessDays: '',
    openTimeA: '',
    closeTimeA: '',
    openTimeB: '',
    closeTimeB: '',
    regularHoliday: closedIdx.map(i => IDX_TO_DAY[i]).join('・')
  };

  const todayIdx = (new Date().getDay() + 6) % 7;
  const todayBlocks = blocks.filter(b => b.dayIdx === todayIdx);
  const todayBlock = todayBlocks.length > 0 ? todayBlocks[0] : (blocks[0] || {});
  const activeDays = new Set(blocks.map(b => b.dayIdx));

  let regularHoliday = '';
  if (closedIdx.length > 0) {
    regularHoliday = IDX_TO_DAY.filter((_, i) => closedIdx.includes(i)).join('・');
  } else if (activeDays.size === 7) {
    regularHoliday = '無休';
  } else if (activeDays.size > 0) {
    regularHoliday = IDX_TO_DAY.filter((_, i) => !activeDays.has(i)).join('・');
  }

  let businessDays = '';
  if (regularHoliday === '無休') {
    businessDays = '月・火・水・木・金・土・日';
  } else if (activeDays.size > 0) {
    businessDays = [...activeDays].sort((a, b) => a - b).map(i => IDX_TO_DAY[i]).join('・');
  } else if (regularHoliday) {
    const holidaySet = new Set(
      regularHoliday.split('・').map(d => IDX_TO_DAY.indexOf(d)).filter(i => i !== -1)
    );
    businessDays = IDX_TO_DAY.filter((_, i) => !holidaySet.has(i)).join('・');
  }

  return {
    businessDays,
    openTimeA: todayBlock.openA !== undefined ? String(todayBlock.openA) : '',
    closeTimeA: todayBlock.closeA !== undefined ? String(todayBlock.closeA) : '',
    openTimeB: todayBlock.openB !== undefined && todayBlock.openB !== '' ? String(todayBlock.openB) : '',
    closeTimeB: todayBlock.closeB !== undefined && todayBlock.closeB !== '' ? String(todayBlock.closeB) : '',
    regularHoliday
  };
}

// =====================================================================
// ジャンル正規化マッピング表
// =====================================================================
const GENRE_NORMALIZE_MAP = {
  '居酒屋': '居酒屋',
  'ラーメン': 'ラーメン', '中華そば': 'ラーメン', '拉麺': 'ラーメン',
  '焼肉': '焼肉', 'ホルモン': '焼肉', 'バーベキュー': '焼肉',
  '寿司': '寿司', '鮨': '寿司', 'すし': '寿司', '回転寿司': '寿司',
  'カフェ': 'カフェ', '喫茶': 'カフェ', '珈琲': 'カフェ', 'コーヒー': 'カフェ',
  'カフェテリア': 'カフェ',
  'イタリアン': 'イタリアン', 'イタリア料理': 'イタリアン',
  'パスタ': 'イタリアン', 'ピザ': 'イタリアン',
  'フレンチ': 'フレンチ', 'フランス料理': 'フレンチ', 'ビストロ': 'フレンチ',
  '中華': '中華', '中華料理': '中華', '餃子': '中華', 'チャーハン': '中華',
  '韓国料理': '韓国料理', '韓国': '韓国料理',
  '和食': '和食', '日本料理': '和食', '割烹': '和食', '懐石': '和食', '定食': '和食',
  '焼鳥': '焼鳥', '焼き鳥': '焼鳥', '焼きとり': '焼鳥', '鳥料理': '焼鳥',
  'うどん': 'うどん',
  'そば': 'そば', '蕎麦': 'そば',
  '海鮮': '海鮮', '魚介': '海鮮', '海産': '海鮮',
  'ステーキ': 'ステーキ', 'ステーキハウス': 'ステーキ',
  'カレー': 'カレー',
  'スイーツ': 'スイーツ', 'デザート': 'スイーツ', 'ケーキ': 'スイーツ',
  '洋菓子': 'スイーツ', '和菓子': 'スイーツ', 'パティスリー': 'スイーツ',
  'ペーストリー': 'スイーツ', 'アイスクリーム': 'スイーツ',
  'パン': 'パン', 'ベーカリー': 'パン', 'パン屋': 'パン', 'サンドイッチ': 'パン',
  'バー': 'バー', 'バル': 'バー', 'ワインバー': 'バー', 'ビアバー': 'バー',
  'カクテルバー': 'バー', 'ショットバー': 'バー',
  'お好み焼き': 'お好み焼き', 'たこ焼き': 'お好み焼き', '鉄板焼き': 'お好み焼き',
  'しゃぶしゃぶ': 'しゃぶしゃぶ', 'すき焼き': 'しゃぶしゃぶ',
  'ハンバーガー': 'ハンバーガー', 'バーガー': 'ハンバーガー',
  'ファミレス': 'ファミレス', 'ファミリーレストラン': 'ファミレス',
  'スナック': 'スナック', 'スナックバー': 'スナック',
};

function normalizeGenre(googleGenre) {
  if (!googleGenre) return '';
  if (GENRE_NORMALIZE_MAP[googleGenre]) return GENRE_NORMALIZE_MAP[googleGenre];
  for (const [key, normalized] of Object.entries(GENRE_NORMALIZE_MAP)) {
    if (googleGenre.includes(key) || key.includes(googleGenre)) {
      return normalized;
    }
  }
  return googleGenre;
}

function extractRawGenreFromPanel() {
  const spans = Array.from(
    document.querySelectorAll('[role="main"] .W4Efsd span')
  );

  const candidates = spans
    .map(el => el.textContent.trim())
    .filter(t =>
      t.length >= 2 &&
      t.length <= 30 &&
      t !== '·' && t !== '・' && t !== ',' && t !== '/' &&
      !/^[¥￥\d,\s〜～\-－・]+$/.test(t) &&
      !/^\d{1,2}:\d{2}/.test(t) &&
      !t.includes('クチコミ') &&
      !t.includes('口コミ') &&
      !t.includes('営業') &&
      !t.includes('定休') &&
      !t.includes('★') &&
      !t.includes('レビュー')
    );

  for (const candidate of candidates) {
    if (GENRE_NORMALIZE_MAP[candidate]) return candidate;
  }
  for (const candidate of candidates) {
    const hit = Object.keys(GENRE_NORMALIZE_MAP).find(
      key => candidate.includes(key) || key.includes(candidate)
    );
    if (hit) return candidate;
  }

  if (candidates.length > 0) return candidates[0];

  const h1El = document.querySelector('[role="main"] h1');
  if (h1El) {
    let el = h1El.parentElement;
    for (let depth = 0; depth < 3; depth++) {
      if (!el) break;
      const siblings = Array.from(el.children);
      const h1Idx = siblings.findIndex(c => c.contains(h1El));
      for (let i = h1Idx + 1; i < Math.min(h1Idx + 4, siblings.length); i++) {
        const text = siblings[i]?.textContent?.trim() || '';
        if (
          text.length >= 2 && text.length <= 40 &&
          !/^[\d¥￥,円〜～\s・]+$/.test(text) &&
          !text.includes('クチコミ') && !text.includes('★') &&
          !text.includes('営業') && !text.includes('定休')
        ) return text;
      }
      el = el.parentElement;
    }
  }

  return '';
}

// =====================================================================
// 詳細パネルスクレイピング (【改修】原文保持・高精度HP判定)
// =====================================================================
async function scrapeDetailPanel(placeUrl, cardName = '') {
  if (cardName) {
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const h1Text = document.querySelector('[role="main"] h1')?.textContent?.trim() || '';
      if (h1Text && h1Text !== '結果' && h1Text === cardName) break;
      if (h1Text && h1Text !== '結果') break;
      await sleep(100);
    }
  } else {
    await sleep(400);
  }

  let name = cardName;
  if (!name) {
    const h1Text = document.querySelector('[role="main"] h1')?.textContent?.trim() || '';
    name = (h1Text && h1Text !== '結果') ? h1Text : extractNameFromUrl(placeUrl);
  }

  const googleGenre = extractRawGenreFromPanel();
  const genre = normalizeGenre(googleGenre);

  const hoursToggle = document.querySelector('button[data-item-id="oh"]');
  if (hoursToggle && hoursToggle.getAttribute('aria-expanded') !== 'true') {
    hoursToggle.click();
  }

  let address = '';
  const addrBtn = document.querySelector('button[data-item-id="address"]');
  if (addrBtn) {
    const raw = addrBtn.getAttribute('aria-label') || addrBtn.textContent.trim();
    address = raw.replace(/^住所[：:]\s*/, '').trim();
  }

  let phone = '';
  const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
  if (phoneBtn) {
    const itemId = phoneBtn.getAttribute('data-item-id') || '';
    phone = itemId.replace('phone:tel:', '').trim() || phoneBtn.textContent.trim();
  }
  
  // 【改修】HP(公式ウェブサイト)の高精度判定判定（ポータル・SNSは除外）
  let hasWebsite = '無';
  const hpLinkEl = document.querySelector('a[data-item-id="authority"]');
  if (hpLinkEl) {
    const hpUrl = (hpLinkEl.getAttribute('href') || '').toLowerCase();
    
    // 独自ホームページではない主要ポータルサイト・SNSのドメインブラックリスト
    const portalDomains = [
      'tabelog.com',
      'hotpepper.jp',
      'gorp.jp',
      'gnavi.co.jp',
      'retty.me',
      'favy.jp',
      'favy.me',
      'facebook.com',
      'instagram.com',
      'twitter.com',
      'x.com',
      'ameblo.jp'
    ];
    
    // ブラックリストに部分一致するか確認
    const isPortal = portalDomains.some(domain => hpUrl.includes(domain));
    if (!isPortal && hpUrl.trim() !== '') {
      hasWebsite = '有';
    }
  }

  if (hoursToggle) {
    await sleep(200);
  }

  // 生の行を取得 (原文保持用)
  const rawHourRows = Array.from(document.querySelectorAll('tr'))
    .map(tr => tr.textContent.trim())
    .filter(t => /^[月火水木金土日]曜日/.test(t));
  
  // 営業時間原文を改行保持で作成し、Google特有のアイコン文字(など)を除去
  const rawHours = rawHourRows.join('\n').replace(//g, '').trim();

  // パース用にはスペースを除去したものを渡す
  const hourRowsForParse = rawHourRows.map(t => t.replace(/\s+/g, ''));
  const parsed = parseOpeningHours(hourRowsForParse);

  if (!name || name === '結果') {
    const h1Text = document.querySelector('[role="main"] h1')?.textContent?.trim() || '';
    if (h1Text && h1Text !== '結果') name = h1Text;
    else name = extractNameFromUrl(placeUrl);
  }

  return { name, genre, googleGenre, address, phone, hasWebsite, rawHours, ...parsed };
}

// =====================================================================
// コンテナ取得
// =====================================================================
function scoreScrollContainer(el) {
  if (!el || el === document.body) return 0;
  const linkCount = el.querySelectorAll('a[href*="/maps/place/"]').length;
  if (linkCount === 0) return 0;

  const rect = el.getBoundingClientRect();
  const scrollable = Math.max(0, el.scrollHeight - el.clientHeight);
  const style = window.getComputedStyle(el);
  const overflowScore = /auto|scroll/.test(style.overflowY) ? 800 : 0;
  const roleScore = el.getAttribute('role') === 'feed' ? 1200 : 0;
  const sizeScore = rect.height > 200 ? 300 : 0;

  return roleScore + overflowScore + sizeScore + scrollable + linkCount * 20;
}

function getScrollContainer() {
  const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
  if (!links.length) return null;

  const candidates = new Set([
    ...document.querySelectorAll('div[role="feed"], .m6QErb[aria-label], .m6QErb.ecceSd')
  ]);

  for (const link of links) {
    let el = link.parentElement;
    while (el && el !== document.body) {
      candidates.add(el);
      el = el.parentElement;
    }
  }

  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const score = scoreScrollContainer(el);
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }

  return best;
}

function getResultLinks(container) {
  return Array.from((container || document).querySelectorAll('a[href*="/maps/place/"]'));
}

async function scrollResultsList(container) {
  const target = container || getScrollContainer() || document.querySelector('[role="feed"]');
  if (!target) return false;

  const beforeTop = target.scrollTop || 0;
  const beforeHeight = target.scrollHeight || 0;
  const beforeLinks = getResultLinks(target).length;
  const distance = Math.max(900, Math.floor((target.clientHeight || 600) * 0.85));

  try {
    target.focus?.();
    target.scrollBy({ top: distance, behavior: 'auto' });
  } catch (_) {
    target.scrollTop = beforeTop + distance;
  }

  target.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: distance
  }));
  document.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY: distance
  }));
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'PageDown',
    code: 'PageDown',
    keyCode: 34,
    which: 34,
    bubbles: true
  }));
  target.dispatchEvent(new Event('scroll', { bubbles: true }));

  const lastLink = getResultLinks(target).at(-1);
  try {
    lastLink?.scrollIntoView({ block: 'end', behavior: 'auto' });
  } catch (_) { /* ignore */ }

  await backgroundSleep(650);
  return (target.scrollTop || 0) !== beforeTop
    || (target.scrollHeight || 0) !== beforeHeight
    || getResultLinks(target).length !== beforeLinks;
}

function mergeResultItems(items, links) {
  const seen = new Set(items.map(item => item.url));
  for (const link of links) {
    const item = extractCardInfo(link);
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }
}

async function collectAllResultItems(maxItems, stats = null) {
  const items = [];
  let container = getScrollContainer();
  if (!container) {
    if (stats) stats.scrollEndReason = 'scroll_container_not_found';
    return items;
  }

  mergeResultItems(items, getResultLinks(container));
  if (stats) {
    stats.urlCollected = items.length;
    if (items.length > 0) stats.scrollLastIncreaseAt = Date.now();
  }

  let stableCount = 0;
  const maxStableCount = 8;
  if (stats) stats.scrollMaxStableCount = maxStableCount;
  while (isScrapingActive && items.length < maxItems) {
    if (isEndOfList(container)) {
      if (stats) stats.scrollEndReason = 'end_of_list_message';
      break;
    }

    const beforeCount = items.length;
    const moved = await scrollResultsList(container);
    if (stats) stats.scrollCount++;
    container = getScrollContainer() || container;
    mergeResultItems(items, getResultLinks(container));

    const increased = items.length - beforeCount;
    if (stats) {
      stats.urlCollected = items.length;
      if (increased > 0) {
        stats.scrollLastIncreaseAt = Date.now();
        stats.scrollNoIncreaseCount = 0;
      } else {
        stats.scrollNoIncreaseCount++;
      }
    }

    if (items.length === beforeCount && !moved) stableCount++;
    else stableCount = 0;

    if (stableCount >= maxStableCount) {
      if (stats) stats.scrollEndReason = `no_new_url_${stableCount}_times`;
      break;
    }
  }

  if (stats && !stats.scrollEndReason) {
    stats.scrollEndReason = items.length >= maxItems ? 'target_count_reached' : 'scraping_stopped';
  }

  return items.slice(0, maxItems);
}

async function findResultLinkByUrl(url, container) {
  let target = container || getScrollContainer();
  let link = getResultLinks(target).find(a => a.href.split('?')[0] === url);
  if (link) return link;

  for (let i = 0; i < 18; i++) {
    target = getScrollContainer() || target;
    link = getResultLinks(target).find(a => a.href.split('?')[0] === url);
    if (link) return link;
    if (target && isEndOfList(target)) break;
    const moved = await scrollResultsList(target);
    if (!moved) await backgroundSleep(120);
  }

  return null;
}

// =====================================================================
// カード情報取得
// =====================================================================
function extractCardInfo(linkEl) {
  const url = linkEl.href.split('?')[0];

  let name = '';
  const label = linkEl.getAttribute('aria-label') || '';
  if (label && !/(^結果|について$|のルート|^地図|口コミ$)/.test(label)) {
    name = label.trim();
  }

  if (!name) {
    const nv = linkEl.querySelector('.Nv2PK');
    if (nv) name = nv.textContent.trim();
  }

  if (!name) {
    const card = linkEl.closest('.Nv2PK') || linkEl.parentElement;
    const headline = card?.querySelector('.fontHeadlineSmall, [class*="fontHeadline"]');
    if (headline) name = headline.textContent.trim();
  }

  if (!name) name = extractNameFromUrl(url);

  return { url, name };
}

// =====================================================================
// メインループ
// =====================================================================
let isScrapingActive = false;

async function flushBatch(pendingBatch) {
  if (!pendingBatch.length) return;
  const payload = [...pendingBatch];
  pendingBatch.length = 0;
  await new Promise(res => {
    try {
      chrome.runtime.sendMessage({ action: 'updateData', data: payload }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        res();
      });
    } catch (_) { res(); }
  });
  return payload.length;
}

function reportV3Log(message) {
  try {
    chrome.runtime.sendMessage({ action: 'v3_contentLog', message }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  } catch (_) { /* ignore */ }
}

function formatRate(count, total) {
  if (!total) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function createSpeedStats({ searchArea, searchGenre, searchKey, maxItems }) {
  const now = Date.now();
  return {
    startedAt: now,
    searchArea,
    searchGenre,
    searchKey,
    maxItems,
    urlCollected: 0,
    detailFetched: 0,
    saved: 0,
    skippedComplete: 0,
    refetchPartial: 0,
    failed: 0,
    saveCount: 0,
    lastSavedAt: 0,
    nameCount: 0,
    addressCount: 0,
    phoneCount: 0,
    hoursCount: 0,
    hpJudgedCount: 0,
    scrollCount: 0,
    scrollNoIncreaseCount: 0,
    scrollLastIncreaseAt: now,
    scrollEndReason: '',
    scrollMaxStableCount: 8
  };
}

function markRecordQuality(stats, record) {
  if (record.name) stats.nameCount++;
  if (record.address) stats.addressCount++;
  if (record.phone) stats.phoneCount++;
  if (record.rawHours) stats.hoursCount++;
  if (record.hasWebsite === '有' || record.hasWebsite === '無') stats.hpJudgedCount++;
}

function buildSpeedSummary(stats, label = '速度ログ') {
  const elapsedSec = Math.max(1, Math.round((Date.now() - stats.startedAt) / 1000));
  const perItem = stats.detailFetched ? (elapsedSec / stats.detailFetched).toFixed(1) : '-';
  const hourly = stats.detailFetched ? Math.round(stats.detailFetched / elapsedSec * 3600) : 0;
  const savedAt = stats.lastSavedAt ? new Date(stats.lastSavedAt).toLocaleTimeString() : '-';

  return [
    `${label}: ${stats.searchArea || '-'} ${stats.searchGenre || '-'} (${stats.searchKey || '-'})`,
    `経過${elapsedSec}秒 / URL${stats.urlCollected}件 / 詳細${stats.detailFetched}件 / 失敗${stats.failed}件`,
    `平均${perItem}秒/件 / 推定${hourly}件/時 / 保存${stats.saveCount}回(最終${savedAt})`,
    `取得率 店名${formatRate(stats.nameCount, stats.detailFetched)} 住所${formatRate(stats.addressCount, stats.detailFetched)} 電話${formatRate(stats.phoneCount, stats.detailFetched)} 営業時間${formatRate(stats.hoursCount, stats.detailFetched)} HP判定${formatRate(stats.hpJudgedCount, stats.detailFetched)}`,
    `スクロール${stats.scrollCount}回 / 増加なし連続${stats.scrollNoIncreaseCount}回 / 終了理由:${stats.scrollEndReason || '未確定'}`
  ].join(' | ');
}

// =====================================================================
// クエリから searchGenre / searchKey を生成
// =====================================================================
function parseSearchMeta(query) {
  const normalized = query.replace(/\s+/g, ' ').trim();
  if (/[×✖️]/.test(normalized)) {
    const parts = normalized.split(/[×✖️]/).map(s => s.trim()).filter(Boolean);
    const area = parts[0] || '';
    const genre = parts[1] || '';
    return {
      searchGenre: genre,
      searchKey: area && genre ? `${area}×${genre}` : normalized
    };
  }
  const tokens = normalized.split(/[\s\u3000]+/).filter(Boolean);
  if (tokens.length >= 2) {
    const genre = tokens[tokens.length - 1];
    const area = tokens.slice(0, tokens.length - 1).join('');
    return {
      searchGenre: genre,
      searchKey: `${area}×${genre}`
    };
  }
  return { searchGenre: normalized, searchKey: normalized };
}

// =====================================================================
// ジャンルフィルタ照合
// =====================================================================
function matchesTargetGenres(detail, targetGenres) {
  if (!targetGenres || targetGenres.length === 0) return true; // 未選択は全件通過
  return targetGenres.some(g => {
    const g_lower = g.toLowerCase();
    const genre_lower = (detail.genre || '').toLowerCase();
    const googleGenre_lower = (detail.googleGenre || '').toLowerCase();
    return (
      genre_lower.includes(g_lower) ||
      g_lower.includes(genre_lower) ||
      googleGenre_lower.includes(g_lower) ||
      g_lower.includes(googleGenre_lower)
    );
  });
}

// =====================================================================
// 厳格なエリアフィルタ照合
// 検索条件で指定された市区町村以外は除外する。
// =====================================================================
function matchesSearchArea(detail, searchArea) {
  if (!searchArea || !searchArea.trim()) return true; // エリア未指定は全件通過
  const address = detail.address || '';
  if (!address) return true; // 住所取得できなかった場合は通過

  const parsed = parseAddress(address);
  const city = parsed.city;
  const cleanArea = searchArea.trim().replace(/駅周辺|エリア|付近/g, '');

  // 検索条件が市区町村指定の場合、抽出した市区町村と厳密に照合する
  if (/[市区町村]$/.test(cleanArea)) {
    if (city && !city.includes(cleanArea) && !cleanArea.includes(city)) {
      return false; // パースした市区町村が一致しない場合は確実に除外
    }
  } else {
    // それ以外は従来の文字列マッチ
    const tokens = cleanArea.split(/[\s\u3000]+/).filter(Boolean);
    return tokens.some(token => address.includes(token));
  }
  
  return true;
}

// =====================================================================
// スクレイピング実行 (共通スキーマ出力)
// =====================================================================
async function startScraping(maxItems, targetGenres = [], searchArea = '') {
  isScrapingActive = true;
  searchPageUrl = window.location.href;
  await reportState('active');

  const query = getCurrentQuery();
  const { searchGenre, searchKey } = parseSearchMeta(query);
  const speedStats = createSpeedStats({ searchArea, searchGenre, searchKey, maxItems });

  console.log(`[Scraper] 検索ジャンル:${searchGenre} | 検索キー:${searchKey}`);
  console.log('[Scraper] 選択ジャンル', targetGenres);
  console.log('[Scraper] エリアフィルタ', searchArea || '（未設定）');
  reportV3Log(`検索開始: ${searchArea || '-'} ${searchGenre || '-'} | キーワード:${searchKey || query || '-'}`);

  await sleep(500);

  let container = getScrollContainer();
  if (!container) {
    console.error('[Scraper] コンテナが見つかりません');
    await reportState('done');
    return;
  }
  console.log('[Scraper] 開始 | コンテナ:', container.className.slice(0, 50), '| links:', container.querySelectorAll('a[href*="/maps/place/"]').length);

  const processedUrls = new Set();
  const failedUrls = new Set();
  const pendingBatch = [];
  const BATCH_SIZE = 5;
  let totalProcessed = 0;
  const startTime = Date.now();

  console.log('[Scraper] 一覧を最後までスクロールしてURLを収集中...');
  reportV3Log('一覧URLを収集中...');
  const resultItems = await collectAllResultItems(maxItems, speedStats);
  speedStats.urlCollected = resultItems.length;
  console.log(`[Scraper] URL収集完了 | ${resultItems.length}件`);
  reportV3Log(`一覧URL収集完了 ${resultItems.length}件 | スクロール${speedStats.scrollCount}回 | 終了理由:${speedStats.scrollEndReason}`);

  if (container) {
    try {
      container.scrollTop = 0;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      await backgroundSleep(350);
    } catch (_) { /* ignore */ }
  }

  for (const item of resultItems) {
      if (!isScrapingActive) break;
      if (processedUrls.size >= maxItems) { isScrapingActive = false; break; }

      const { url, name: cardName } = item;
      if (!url || processedUrls.has(url) || failedUrls.has(url)) continue;

      try {
        const freshContainer = getScrollContainer();
        const freshLink = await findResultLinkByUrl(url, freshContainer);
        if (freshLink) {
          freshLink.click();
        } else {
          console.warn('[Scraper] 表示中リストからリンクを再取得できなかった:', cardName || url);
          speedStats.failed++;
          failedUrls.add(url);
          await scrollResultsList(freshContainer);
          continue;
        }

        let panelReady = await waitForDetailPanel(2500);
        if (!panelReady) panelReady = await waitForDetailPanel(2500);
        if (!panelReady) {
          console.warn('[Scraper] パネルが開かなかった:', cardName || url);
          speedStats.failed++;
          failedUrls.add(url);
          await closeDetailPanel();
          continue;
        }

        processedUrls.add(url);

        const detail = await scrapeDetailPanel(url, cardName);

        if (!matchesTargetGenres(detail, targetGenres)) {
          console.log(`[Scraper] ジャンル不一致 → スキップ: ${detail.name} | ジャンル:${detail.genre}(${detail.googleGenre})`);
          await closeDetailPanel();
          continue;
        }

        if (!matchesSearchArea(detail, searchArea)) {
          console.log(`[Scraper] エリア不一致 → スキップ: ${detail.name} | 住所:${detail.address} | フィルタ:${searchArea}`);
          await closeDetailPanel();
          continue;
        }

        const parsedAddr = parseAddress(detail.address);
        
        const record = {
          name: detail.name,
          genre: detail.genre,
          sourceGenre: detail.googleGenre,
          prefecture: parsedAddr.prefecture,
          city: parsedAddr.city,
          address: detail.address,
          phone: detail.phone,
          regularHoliday: detail.regularHoliday,
          businessDays: detail.businessDays,
          openTimeA: detail.openTimeA,
          closeTimeA: detail.closeTimeA,
          openTimeB: detail.openTimeB,
          closeTimeB: detail.closeTimeB,
          rawHours: detail.rawHours,
          url: url,
          hasWebsite: detail.hasWebsite,
          source: 'GoogleMap',
          sourceUrl: searchPageUrl,
          scrapedAt: new Date().toISOString(),
          searchGenre, 
          searchKey    
        };

        totalProcessed++;
        speedStats.detailFetched++;
        markRecordQuality(speedStats, record);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const perItem = totalProcessed > 0 ? (elapsed / totalProcessed).toFixed(1) : '-';
        console.log(`[Scraper] ✓ ${record.name} | 市区町村:${record.city} | ${totalProcessed}件目 ${perItem}秒/件`);

        pendingBatch.push(record);
        if (pendingBatch.length >= BATCH_SIZE || processedUrls.size >= maxItems) {
          const flushed = await flushBatch(pendingBatch);
          if (flushed) {
            speedStats.saved += flushed;
            speedStats.saveCount++;
            speedStats.lastSavedAt = Date.now();
            reportV3Log(buildSpeedSummary(speedStats, '中間速度ログ'));
          }
        }

        try {
          chrome.runtime.sendMessage({ action: 'progress', count: processedUrls.size }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        } catch (_) { /* ignore */ }

        await closeDetailPanel();
        await sleep(80);

      } catch (err) {
        console.error('[Scraper] エラー:', err);
        speedStats.failed++;
        failedUrls.add(url);
        await closeDetailPanel();
        await sleep(180);
      }
  }

  if (pendingBatch.length > 0) {
    const flushed = await flushBatch(pendingBatch);
    if (flushed) {
      speedStats.saved += flushed;
      speedStats.saveCount++;
      speedStats.lastSavedAt = Date.now();
    }
  }

  console.log(`[Scraper] 完了 | 合計${totalProcessed}件 | ${((Date.now() - startTime) / 1000).toFixed(0)}秒 | failed:${failedUrls.size}`);
  reportV3Log(buildSpeedSummary(speedStats, 'コンボ完了速度ログ'));
  await reportState('done');
}

async function reportState(state) {
  return new Promise(r => {
    try {
      chrome.runtime.sendMessage({ action: 'setState', state }, () => {
        if (chrome.runtime.lastError) { }
        r();
      });
    } catch (_) { r(); }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') { sendResponse({ alive: true }); return false; }
  if (request.action === 'getQuery') { sendResponse({ query: getCurrentQuery() }); return false; }

  if (request.action === 'startScraping') {
    if (isScrapingActive) { sendResponse({ success: false, reason: 'already running' }); return false; }

    const incomingGenres = Array.isArray(request.targetGenres) ? request.targetGenres : [];
    const incomingArea = typeof request.searchArea === 'string' ? request.searchArea.trim() : '';

    startScraping(request.maxItems || 50, incomingGenres, incomingArea).catch(err => {
      console.error('[Scraper] 致命的エラー:', err);
      reportState('done');
    });
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'stopScraping') {
    isScrapingActive = false;
    reportState('done');
    sendResponse({ success: true });
    return false;
  }

  return false;
});
