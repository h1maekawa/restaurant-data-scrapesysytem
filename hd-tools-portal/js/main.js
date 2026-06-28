// main.js - HD事業部 業務ツールポータル 制御スクリプト

document.addEventListener('DOMContentLoaded', () => {
  // 状態管理
  let allFeatures = [];
  let allUpdates = [];
  let currentCategory = 'すべて';
  let currentStatus = 'すべて';
  let searchQuery = '';
  let showAllUpdates = false;

  // DOM要素取得
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-btn');
  const resultCount = document.getElementById('result-count');
  const cardsGrid = document.getElementById('cards-grid');
  
  // フィルター用コンテナ
  const catChipsContainer = document.getElementById('category-chips');
  const statusChipsContainer = document.getElementById('status-chips');

  // サマリー用
  const statTotal = document.getElementById('stat-total');
  const statActive = document.getElementById('stat-active');
  const statDev = document.getElementById('stat-dev');
  const statImprove = document.getElementById('stat-improve');

  // ヘッダー用
  const hStatTotal = document.getElementById('h-stat-total');
  const hStatActive = document.getElementById('h-stat-active');
  const hStatDev = document.getElementById('h-stat-dev');
  const hStatImprove = document.getElementById('h-stat-improve');

  // 更新履歴
  const updatesList = document.getElementById('updates-list');
  const showMoreUpdatesBtn = document.getElementById('show-more-updates');

  // モーダル
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCloseFooter = document.getElementById('modal-close-footer');

  // カテゴリ別のカラー定義 & アイコン
  const CATEGORY_META = {
    'データ取得': { accent: '#0EA5E9', icon: '📥', bg: '#F0F9FF' },
    'リスト整形・統合': { accent: '#10B981', icon: '⚙️', bg: '#ECFDF5' },
    'コムデスク投入': { accent: '#F59E0B', icon: '📄', bg: '#FFFBEB' },
    '架電管理': { accent: '#EF4444', icon: '📞', bg: '#FEF2F2' },
    'アポ・訪問最適化': { accent: '#8B5CF6', icon: '📅', bg: '#F5F3FF' },
    '分析・レポート': { accent: '#EC4899', icon: '📊', bg: '#FDF2F8' },
    'マニュアル・運用ルール': { accent: '#6B7280', icon: '📘', bg: '#F9FAFB' }
  };

  const DEFAULT_META = { accent: '#2563EB', icon: '🛠️', bg: '#EEF3FD' };

  // データ初期読み込み
  async function loadData() {
    try {
      const [featuresRes, updatesRes] = await Promise.all([
        fetch('data/features.json').then(r => r.json()),
        fetch('data/updates.json').then(r => r.json())
      ]);

      allFeatures = featuresRes;
      // 日付降順でソート
      allUpdates = updatesRes.sort((a, b) => new Date(b.date) - new Date(a.date));

      initFilters();
      updateSummary();
      renderFeatures();
      renderUpdates();
    } catch (err) {
      console.error('データの取得に失敗しました:', err);
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <h3>データの読み込みエラー</h3>
          <p>JSONデータの取得に失敗しました。ローカル環境の場合はWebサーバー(Live Server等)経由で閲覧してください。</p>
        </div>
      `;
    }
  }

  // フィルター初期化
  function initFilters() {
    // カテゴリ一覧
    const categories = ['すべて', ...Object.keys(CATEGORY_META)];
    catChipsContainer.innerHTML = '';
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `chip ${cat === currentCategory ? 'active' : ''}`;
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        document.querySelectorAll('#category-chips .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = cat;
        renderFeatures();
      });
      catChipsContainer.appendChild(btn);
    });

    // ステータス一覧
    const statuses = ['すべて', '運用中', '改善中', '開発中', '検証中', '構想中', '停止中'];
    statusChipsContainer.innerHTML = '';
    statuses.forEach(status => {
      const btn = document.createElement('button');
      btn.className = `chip ${status === currentStatus ? 'active' : ''}`;
      btn.innerHTML = `<span class="chip-dot"></span>${status}`;
      // ステータス別のカラーを適用
      const colors = {
        '運用中': 'var(--status-active)',
        '改善中': 'var(--status-improve)',
        '開発中': 'var(--status-dev)',
        '検証中': 'var(--status-test)',
        '構想中': 'var(--status-concept)',
        '停止中': 'var(--status-stop)',
      };
      if (colors[status]) {
        btn.style.color = colors[status];
      }
      btn.addEventListener('click', () => {
        document.querySelectorAll('#status-chips .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentStatus = status;
        renderFeatures();
      });
      statusChipsContainer.appendChild(btn);
    });
  }

  // 数値サマリー更新
  function updateSummary() {
    const total = allFeatures.length;
    const active = allFeatures.filter(f => f.status === '運用中').length;
    const dev = allFeatures.filter(f => f.status === '開発中').length;
    const improve = allFeatures.filter(f => f.status === '改善中').length;

    // メインサマリー
    if (statTotal) statTotal.textContent = total;
    if (statActive) statActive.textContent = active;
    if (statDev) statDev.textContent = dev;
    if (statImprove) statImprove.textContent = improve;

    // ヘッダーサマリー
    if (hStatTotal) hStatTotal.textContent = total;
    if (hStatActive) hStatActive.textContent = active;
    if (hStatDev) hStatDev.textContent = dev;
    if (hStatImprove) hStatImprove.textContent = improve;
  }

  // 機能カードレンダリング
  function renderFeatures() {
    const filtered = allFeatures.filter(f => {
      // カテゴリ一致
      const matchCat = (currentCategory === 'すべて' || f.category === currentCategory);
      // ステータス一致
      const matchStatus = (currentStatus === 'すべて' || f.status === currentStatus);
      // キーワード検索一致
      const query = searchQuery.toLowerCase().trim();
      const matchSearch = !query || 
        f.name.toLowerCase().includes(query) ||
        f.category.toLowerCase().includes(query) ||
        f.status.toLowerCase().includes(query) ||
        (f.summary && f.summary.toLowerCase().includes(query)) ||
        (f.useCase && f.useCase.toLowerCase().includes(query)) ||
        (f.tags && f.tags.some(t => t.toLowerCase().includes(query)));

      return matchCat && matchStatus && matchSearch;
    });

    // 件数表示
    if (resultCount) {
      resultCount.innerHTML = `該当ツール: <strong>${filtered.length}</strong> 件 / 全 ${allFeatures.length} 件`;
    }

    if (filtered.length === 0) {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <h3>条件に一致するツールが見つかりません</h3>
          <p>検索ワードを変えるか、フィルターをクリアしてください。</p>
        </div>
      `;
      return;
    }

    cardsGrid.innerHTML = '';
    filtered.forEach(f => {
      const meta = CATEGORY_META[f.category] || DEFAULT_META;
      const card = document.createElement('div');
      card.className = 'feature-card';
      card.style.setProperty('--card-accent', meta.accent);
      card.style.setProperty('--card-icon-bg', meta.bg);

      // タグの生成
      const tagsHtml = (f.tags || []).slice(0, 3).map(tag => `<span class="card-tag">${tag}</span>`).join('');

      // リンクアイコンの有無確認
      const linksHtml = [];
      if (f.links?.github) linksHtml.push(`<span class="card-link-icon" title="GitHub">🛠️</span>`);
      if (f.links?.spreadsheet) linksHtml.push(`<span class="card-link-icon" title="Spreadsheet">📊</span>`);
      if (f.links?.manual) linksHtml.push(`<span class="card-link-icon" title="Manual">📘</span>`);

      card.innerHTML = `
        <div class="card-top">
          <div class="card-category-icon">${meta.icon}</div>
          <div class="card-meta">
            <div class="card-category-tag">${f.category}</div>
            <h3 class="card-title">${f.name}</h3>
          </div>
        </div>
        <div class="card-status-row">
          <span class="status-badge status-${f.status}">
            <span class="badge-dot"></span>${f.status}
          </span>
          ${f.useFrequency ? `<span class="card-freq">頻度: ${f.useFrequency}</span>` : ''}
        </div>
        <p class="card-summary">${f.summary || ''}</p>
        <div class="card-tags">${tagsHtml}</div>
        <div class="card-footer">
          <div class="card-updated">${f.lastUpdated || '-'} 更新</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="card-links">${linksHtml.join('')}</div>
            <span class="card-detail-btn">詳細を見る &rarr;</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => openModal(f));
      cardsGrid.appendChild(card);
    });
  }

  // 更新履歴レンダリング
  function renderUpdates() {
    if (allUpdates.length === 0) {
      updatesList.innerHTML = `<div style="padding:20px; text-align:center; color:var(--color-text-3);">更新履歴はありません</div>`;
      showMoreUpdatesBtn.style.display = 'none';
      return;
    }

    const limit = showAllUpdates ? allUpdates.length : 5;
    const showList = allUpdates.slice(0, limit);

    updatesList.innerHTML = '';
    showList.forEach(up => {
      const li = document.createElement('li');
      li.className = 'update-item';
      li.innerHTML = `
        <div class="update-date">${up.date}</div>
        <div class="update-content">
          <div class="update-feature">
            <strong>${up.featureName}</strong>
            <span class="update-type-badge type-${up.type}">${up.type}</span>
          </div>
          <div class="update-desc">${up.description}</div>
        </div>
      `;
      // 対象機能が存在すればクリックで詳細表示
      const targetFeature = allFeatures.find(f => f.id === up.featureId);
      if (targetFeature) {
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => openModal(targetFeature));
      }
      updatesList.appendChild(li);
    });

    if (allUpdates.length <= 5) {
      showMoreUpdatesBtn.style.display = 'none';
    } else {
      showMoreUpdatesBtn.style.display = 'block';
      showMoreUpdatesBtn.textContent = showAllUpdates ? '閉じる' : `過去の更新履歴を表示 (${allUpdates.length - 5}件)`;
    }
  }

  // 更新履歴もっと見る
  showMoreUpdatesBtn.addEventListener('click', () => {
    showAllUpdates = !showAllUpdates;
    renderUpdates();
  });

  // 検索イベント
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (searchQuery) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
    renderFeatures();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearBtn.classList.add('hidden');
    renderFeatures();
  });

  // =====================================================================
  // モーダル処理
  // =====================================================================
  function openModal(feature) {
    document.getElementById('modal-cat').textContent = feature.category;
    document.getElementById('modal-title').textContent = feature.name;
    document.getElementById('modal-status').className = `modal-status-badge status-${feature.status}`;
    document.getElementById('modal-status').innerHTML = `<span class="badge-dot"></span>${feature.status}`;
    document.getElementById('modal-updated').textContent = `${feature.lastUpdated || '-'} 更新`;

    // 概要
    document.getElementById('modal-summary').textContent = feature.summary || '概要情報はありません。';

    // 解決する課題
    document.getElementById('modal-problem').textContent = feature.problem || '登録なし';

    // 対象ユーザーと使用頻度
    const users = Array.isArray(feature.targetUsers) ? feature.targetUsers.join('、') : '事業部全体';
    document.getElementById('modal-users').textContent = users;
    document.getElementById('modal-freq').textContent = feature.useFrequency || '必要に応じて';

    // 用途
    document.getElementById('modal-usecase').textContent = feature.useCase || '登録なし';

    // 入力・出力データ
    const inputsList = document.getElementById('modal-inputs');
    inputsList.innerHTML = '';
    if (feature.inputs && feature.inputs.length > 0) {
      feature.inputs.forEach(input => {
        const li = document.createElement('li');
        li.textContent = input;
        inputsList.appendChild(li);
      });
    } else {
      inputsList.innerHTML = '<li>特になし</li>';
    }

    const outputsList = document.getElementById('modal-outputs');
    outputsList.innerHTML = '';
    if (feature.outputs && feature.outputs.length > 0) {
      feature.outputs.forEach(output => {
        const li = document.createElement('li');
        li.textContent = output;
        outputsList.appendChild(li);
      });
    } else {
      outputsList.innerHTML = '<li>特になし</li>';
    }

    // 操作手順
    const stepsContainer = document.getElementById('modal-steps-container');
    const stepsList = document.getElementById('modal-steps');
    stepsList.innerHTML = '';
    if (feature.howToUse && feature.howToUse.length > 0) {
      stepsContainer.classList.remove('hidden');
      feature.howToUse.forEach((step, idx) => {
        const item = document.createElement('div');
        item.className = 'step-item';
        item.innerHTML = `
          <div class="step-num">${idx + 1}</div>
          <div class="step-text">${step}</div>
        `;
        stepsList.appendChild(item);
      });
    } else {
      stepsContainer.classList.add('hidden');
    }

    // 注意点
    const notesContainer = document.getElementById('modal-notes-container');
    const notesList = document.getElementById('modal-notes');
    notesList.innerHTML = '';
    if (feature.notes && feature.notes.length > 0) {
      notesContainer.classList.remove('hidden');
      feature.notes.forEach(note => {
        const item = document.createElement('div');
        item.className = 'note-item';
        item.textContent = note;
        notesList.appendChild(item);
      });
    } else {
      notesContainer.classList.add('hidden');
    }

    // 今後の改善予定(ロードマップ)
    const roadmapContainer = document.getElementById('modal-roadmap-container');
    const roadmapList = document.getElementById('modal-roadmap');
    roadmapList.innerHTML = '';
    if (feature.roadmap && feature.roadmap.length > 0) {
      roadmapContainer.classList.remove('hidden');
      feature.roadmap.forEach(itemText => {
        const item = document.createElement('div');
        item.className = 'roadmap-item';
        item.textContent = itemText;
        roadmapList.appendChild(item);
      });
    } else {
      roadmapContainer.classList.add('hidden');
    }

    // 関連リンク
    const linksContainer = document.getElementById('modal-links-container');
    const linksGrid = document.getElementById('modal-links');
    linksGrid.innerHTML = '';
    
    let hasLinks = false;
    const linkLabels = {
      github: { text: 'GitHub', icon: '🛠️' },
      spreadsheet: { text: 'スプレッドシート', icon: '📊' },
      drive: { text: 'Google Drive', icon: '📁' },
      manual: { text: 'マニュアル', icon: '📘' },
      download: { text: 'ダウンロード', icon: '📥' },
      demo: { text: 'デモページ', icon: '✨' },
      requirements: { text: '要件定義', icon: '📋' }
    };

    if (feature.links) {
      for (const [key, url] of Object.entries(feature.links)) {
        if (url && url.trim() !== '') {
          hasLinks = true;
          const meta = linkLabels[key] || { text: key, icon: '🔗' };
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.className = 'modal-link-btn';
          a.innerHTML = `<span class="link-icon">${meta.icon}</span>${meta.text}`;
          linksGrid.appendChild(a);
        }
      }
    }

    if (hasLinks) {
      linksContainer.classList.remove('hidden');
    } else {
      linksContainer.classList.add('hidden');
    }

    // モーダルオープン
    modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden'; // 背後のスクロールを防ぐ
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  modalCloseBtn.addEventListener('click', closeModal);
  modalCloseFooter.addEventListener('click', closeModal);
  
  // モーダルの外側クリックで閉じる
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  // ESCキーで閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
      closeModal();
    }
  });

  // 初期ロード
  loadData();
});
