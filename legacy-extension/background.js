// background.js  v3.4.0 (共通スキーマ対応版)

// =====================================================================
// CSVヘッダー定義 (共通スキーマ19項目)
// =====================================================================
const CSV_HEADERS = [
  '店名', 'ジャンル', '取得元ジャンル', '都道府県', '市区町村', '住所', '電話番号',
  '定休日', '営業日', '営業開始A', '営業終了A', '営業開始B', '営業終了B',
  '営業時間原文', 'URL', 'HP有無', '媒体', '取得元URL', '取得日時'
];

function normalizeExportRecord(item) {
  return {
    name: item.name || '',
    genre: item.genre || '',
    sourceGenre: item.sourceGenre || '',
    prefecture: item.prefecture || '',
    city: item.city || '',
    address: item.address || '',
    phone: item.phone || '',
    regularHoliday: item.regularHoliday || '',
    businessDays: item.businessDays || '',
    openTimeA: item.openTimeA || '',
    closeTimeA: item.closeTimeA || '',
    openTimeB: item.openTimeB || '',
    closeTimeB: item.closeTimeB || '',
    rawHours: item.rawHours || '',
    url: item.url || '',
    hasWebsite: item.hasWebsite || '無',
    source: item.source || 'GoogleMap',
    sourceUrl: item.sourceUrl || '',
    scrapedAt: item.scrapedAt || '',
    // 内部管理用（CSV には出力しないがレコードとして保持）
    searchGenre: item.searchGenre || '',
    searchKey: item.searchKey || '',
  };
}

function escapeCsvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsvContent(data) {
  let csv = '\uFEFF' + CSV_HEADERS.join(',') + '\n';
  data.forEach(item => {
    const r = normalizeExportRecord(item);
    csv += [
      escapeCsvValue(r.name),
      escapeCsvValue(r.genre),
      escapeCsvValue(r.sourceGenre),
      escapeCsvValue(r.prefecture),
      escapeCsvValue(r.city),
      escapeCsvValue(r.address),
      escapeCsvValue(r.phone),
      escapeCsvValue(r.regularHoliday),
      escapeCsvValue(r.businessDays),
      escapeCsvValue(r.openTimeA),
      escapeCsvValue(r.closeTimeA),
      escapeCsvValue(r.openTimeB),
      escapeCsvValue(r.closeTimeB),
      escapeCsvValue(r.rawHours),
      escapeCsvValue(r.url),
      escapeCsvValue(r.hasWebsite),
      escapeCsvValue(r.source),
      escapeCsvValue(r.sourceUrl),
      escapeCsvValue(r.scrapedAt)
    ].join(',') + '\n';
  });
  return csv;
}

// =====================================================================
// ファイル名生成
// 形式: [ジャンル1_ジャンル2_...]_[地域名].csv
// =====================================================================
function buildFilename(query, filterConfig, targetGenres) {
  const trimmed = (query || '').trim();
  const { area } = trimmed ? parseQueryToAreaGenre(trimmed) : { area: '' };
  const areaStr = sanitizeFilename(area);

  let genres = [];
  if (Array.isArray(targetGenres)) {
    genres = targetGenres.map(g => g.trim()).filter(Boolean);
  } else if (typeof targetGenres === 'string' && targetGenres.trim()) {
    genres = targetGenres.split(/[\n,]/).map(g => g.trim()).filter(Boolean);
  }
  const genreStr = genres.map(g => sanitizeFilename(g)).filter(Boolean).join('_');

  if (genreStr && areaStr) return `${genreStr}_${areaStr}.csv`;
  if (genreStr) return `${genreStr}.csv`;
  if (areaStr) return `${areaStr}.csv`;
  return `Googleマップ.csv`;
}

// =====================================================================
// クエリ解析（エリア / ジャンル 分離）
// =====================================================================
function parseQueryToAreaGenre(query) {
  if (query.includes('✖️') || query.includes('×')) {
    const sep = query.includes('✖️') ? '✖️' : '×';
    const parts = query.split(sep).map(s => s.trim()).filter(Boolean);
    const ai = parts.findIndex(p => isAreaToken(p));
    if (ai !== -1) return { area: parts[ai], genre: parts.find((_, i) => i !== ai) || '' };
    return { area: parts[0] || '', genre: parts[1] || '' };
  }

  const tokens = query.split(/[\s\u3000]+/).filter(Boolean);
  if (!tokens.length) return { area: '', genre: '' };
  if (tokens.length === 1) {
    return isAreaToken(tokens[0])
      ? { area: tokens[0], genre: '' }
      : { area: '', genre: tokens[0] };
  }

  let areaTokens = [], genreTokens = [], switched = false;
  for (const t of tokens) {
    if (!switched && isAreaToken(t)) areaTokens.push(t);
    else { switched = true; genreTokens.push(t); }
  }
  if (!areaTokens.length) { areaTokens = [tokens[0]]; genreTokens = tokens.slice(1); }
  return { area: areaTokens.join(''), genre: genreTokens.join('') };
}

function isAreaToken(token) {
  if (/[市区町村都府道県]$/.test(token)) return true;
  const list = [
    '北海道', '東京', '大阪', '京都', '神奈川', '愛知', '福岡', '沖縄',
    '埼玉', '千葉', '兵庫', '静岡', '茨城', '広島', '宮城',
    '渋谷', '新宿', '池袋', '銀座', '品川', '秋葉原', '浅草', '上野',
    '吉祥寺', '横浜', '梅田', '難波', '心斎橋', '天王寺', '栄',
    '名古屋', '博多', '天神', '札幌', '仙台', '神戸', '川崎', '船橋',
  ];
  return list.includes(token);
}

function sanitizeFilename(str) {
  return String(str || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

function safeTabSendMessage(tabId, message) {
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      if (chrome.runtime.lastError) { /* Receiving end does not exist */ }
    });
  } catch (_) { /* ignore */ }
}

// =====================================================================
// 自動ダウンロード
// =====================================================================
async function handleAutomaticDownload(tabId, data, filterConfig) {
  let query = '';
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'getQuery' });
    query = res?.query || '';
  } catch (e) { /* ignore */ }

  if (!query) {
    const r = await chrome.storage.local.get(['lastQuery']);
    query = r.lastQuery || '';
  }

  const stored = await chrome.storage.local.get(['targetGenres']);
  const targetGenres = stored.targetGenres || '';

  const filename = buildFilename(query, filterConfig, targetGenres);
  const encodedUri =
    'data:text/csv;charset=utf-8,' + encodeURIComponent(buildCsvContent(data));

  await chrome.downloads.download({ url: encodedUri, filename, saveAs: false });
}

// =====================================================================
// Service Worker リスナー
// =====================================================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    scrapingState: 'inactive',
    scrapedData: [],
    maxItems: 50,
    targetGenres: ''
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'backgroundSleep') {
    setTimeout(() => sendResponse({ success: true }), request.ms);
    return true;
  }

  if (request.action === 'updateData') {
    chrome.storage.local.get(['scrapedData'], result => {
      const current = Array.isArray(result.scrapedData) ? result.scrapedData : [];
      const incoming = Array.isArray(request.data) ? request.data : [];

      const existingUrls = new Set(current.map(i => i?.url).filter(Boolean));
      const unique = incoming.filter(i => i?.url && !existingUrls.has(i.url));
      const updated = [...current, ...unique];

      chrome.storage.local.set({ scrapedData: updated }, () => {
        sendResponse({ success: true, count: updated.length });
      });
    });
    return true;
  }

  if (request.action === 'setState') {
    chrome.storage.local.set({ scrapingState: request.state }, async () => {
      if (request.state === 'active') {
        chrome.power.requestKeepAwake('display');
        chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
      } else {
        chrome.power.releaseKeepAwake();
        chrome.alarms.clear('keepAlive');
      }

      if (request.state === 'done') {
        chrome.storage.local.get(['scrapedData', 'filterConfig'], async result => {
          const data = Array.isArray(result.scrapedData) ? result.scrapedData : [];
          const filterConfig = result.filterConfig || null;

          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '抽出が完了しました',
            message: `合計 ${data.length} 件のデータを取得しました。自動でダウンロードを開始します。`,
            priority: 2
          });

          if (data.length > 0) {
            const tabId = sender?.tab?.id || (await findActiveMapsTabId());
            if (tabId != null) {
              handleAutomaticDownload(tabId, data, filterConfig)
                .catch(e => console.error('Download failed:', e));
            }
          }
        });
      }
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'keepAlive') return;
  chrome.storage.local.get(['scrapingState'], result => {
    if (result.scrapingState !== 'active') return;
    chrome.tabs.query(
      { url: ['https://www.google.com/maps/*', 'https://www.google.co.jp/maps/*'] },
      tabs => tabs.forEach(tab => safeTabSendMessage(tab.id, { action: 'ping' }))
    );
  });
});

async function findActiveMapsTabId() {
  const tabs = await chrome.tabs.query({
    url: ['https://www.google.com/maps/*', 'https://www.google.co.jp/maps/*']
  });
  return tabs[0]?.id ?? null;
}
