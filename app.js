/**
 * ATK Inventory - Frontend
 * ATK Inventory - FINAL / Mobile Ready
 *
 * Browser frontend. Never place Apps Script URL/API key here.
 */

(function () {
  'use strict';

  var STORAGE_KEYS = {
    SESSION: 'atk_inventory_session',
    STAFF_CLIENT_PREFIX: 'atk_staff_client_id_'
  };

  var API_ENDPOINT = '/api/app';

  var state = {
    sessionToken: '',
    expiresAt: '',
    user: null,
    activePage: 'dashboard',
    initialized: false,
    finalScanner: null,
    productScanner: null,
    receiveScanner: null,
    poScanner: null,
    approvalBadgeTimer: null,
    staffRequestCart: [],
    libraryPromises: { excel: null, scanner: null },
    caches: {
      categories: [],
      suppliers: [],
      products: [],
      users: []
    }
  };

  var NAV_ITEMS = {
    ADMIN: [
      { label: 'Dashboard', icon: '⌂', action: 'dashboard', section: 'utama' },
      { label: 'Master Barang', icon: '▣', action: 'listProducts', section: 'master' },
      { label: 'Kategori', icon: '◫', action: 'listCategories', section: 'master' },
      { label: 'Supplier', icon: '▤', action: 'listSuppliers', section: 'master' },
      { label: 'User Management', icon: '♙', action: 'listUsers', section: 'master' },
      { label: 'Barang Masuk', icon: '↓', action: 'receiveStock', section: 'persediaan' },
      { label: 'Barcode Scanner', icon: '⌕', action: 'barcodeScanner', section: 'persediaan' },
      { label: 'Adjustment / Opname', icon: '±', action: 'adjustStock', section: 'persediaan' },
      { label: 'Histori Mutasi', icon: '↔', action: 'listMovements', section: 'persediaan' },
      { label: 'Rekomendasi Order', icon: '◇', action: 'reorderRecommendations', section: 'pengadaan' },
      { label: 'Purchase Order', icon: '▤', action: 'listPurchaseOrders', section: 'pengadaan' },
      { label: 'Penerimaan PO', icon: '✓', action: 'receivePurchaseOrder', section: 'pengadaan' },
      { label: 'Approval Pengajuan', icon: '✓', action: 'listRequests', section: 'pengajuan' },
      { label: 'Laporan', icon: '▥', action: 'stockReport', section: 'laporan' },
      { label: 'Import Excel', icon: '⇧', action: 'bulkUpsertProducts', section: 'tools' },
      { label: 'Export Excel', icon: '⇩', action: 'exportExcel', section: 'tools' },
      { label: 'Change Password', icon: '⚿', action: 'changePassword', section: 'akun' }
    ],
    STAFF: [
      { label: 'Dashboard', icon: '⌂', action: 'dashboard', section: 'utama' },
      { label: 'Cari Barang', icon: '⌕', action: 'searchProducts', section: 'barang' },
      { label: 'Scan Barcode', icon: '▦', action: 'barcodeScanner', section: 'barang' },
      { label: 'Buat Pengajuan', icon: '+', action: 'createRequest', section: 'pengajuan' },
      { label: 'Pengajuan Saya', icon: '≡', action: 'myRequests', section: 'pengajuan' },
      { label: 'Print Pengajuan', icon: '▧', action: 'printRequests', section: 'pengajuan' }
    ]
  };

  var SECTION_LABELS = {
    utama: 'Utama',
    master: 'Master Data',
    persediaan: 'Persediaan',
    pengadaan: 'Pengadaan',
    pengajuan: 'Pengajuan',
    laporan: 'Laporan',
    tools: 'Tools',
    barang: 'Barang',
    akun: 'Akun'
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindStaticEvents();
    setConnectionStatus('checking');
    await restoreSession();
    state.initialized = true;
  }

  function bindStaticEvents() {
    var loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

    var staffModeButton = document.getElementById('staffModeButton');
    if (staffModeButton) staffModeButton.addEventListener('click', showStaffEntry);
    var staffCancelButton = document.getElementById('staffCancelButton');
    if (staffCancelButton) staffCancelButton.addEventListener('click', hideStaffEntry);
    var staffEntryForm = document.getElementById('staffEntryForm');
    if (staffEntryForm) staffEntryForm.addEventListener('submit', handleStaffEntrySubmit);

    var logoutButton = document.getElementById('logoutButton');
    if (logoutButton) logoutButton.addEventListener('click', handleLogout);

    var menuButton = document.getElementById('menuButton');
    if (menuButton) menuButton.addEventListener('click', openSidebar);

    var closeSidebarButton = document.getElementById('closeSidebarButton');
    if (closeSidebarButton) closeSidebarButton.addEventListener('click', closeSidebar);

    var overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.addEventListener('click', closeSidebar);
  }

  function showStaffEntry() {
    var adminForm = document.getElementById('loginForm');
    var staffButton = document.getElementById('staffModeButton');
    var staffForm = document.getElementById('staffEntryForm');
    var error = document.getElementById('loginError');
    if (adminForm) adminForm.classList.add('hidden');
    if (staffButton) staffButton.classList.add('hidden');
    if (error) error.classList.add('hidden');
    if (staffForm) {
      staffForm.classList.remove('hidden');
      var name = document.getElementById('staffNameInput');
      if (name) {
        name.focus();
        try { name.value = window.localStorage.getItem('atk_staff_name') || ''; } catch (err) {}
      }
      var department = document.getElementById('staffDepartmentInput');
      if (department) {
        try { department.value = window.localStorage.getItem('atk_staff_department') || 'General'; } catch (err2) {}
      }
    }
  }

  function hideStaffEntry() {
    var adminForm = document.getElementById('loginForm');
    var staffButton = document.getElementById('staffModeButton');
    var staffForm = document.getElementById('staffEntryForm');
    var error = document.getElementById('staffEntryError');
    if (adminForm) adminForm.classList.remove('hidden');
    if (staffButton) staffButton.classList.remove('hidden');
    if (staffForm) staffForm.classList.add('hidden');
    if (error) error.classList.add('hidden');
  }

  function getOrCreateStaffClientId(name, department) {
    var identity = String(name || '').trim().toLowerCase() + '|' + String(department || '').trim().toLowerCase();
    var storageKey = STORAGE_KEYS.STAFF_CLIENT_PREFIX + encodeURIComponent(identity).slice(0, 180);
    var existing = '';
    try { existing = String(window.localStorage.getItem(storageKey) || '').trim(); } catch (err) { existing = ''; }
    if (existing) return existing;
    var created = '';
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') created = window.crypto.randomUUID();
    } catch (err2) {}
    if (!created) {
      created = 'staff-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    }
    try { window.localStorage.setItem(storageKey, created); } catch (err3) {}
    return created;
  }

  async function handleStaffEntrySubmit(event) {
    event.preventDefault();
    var nameInput = document.getElementById('staffNameInput');
    var departmentInput = document.getElementById('staffDepartmentInput');
    var button = document.getElementById('staffEnterButton');
    var errorBox = document.getElementById('staffEntryError');
    var name = String(nameInput && nameInput.value || '').trim();
    var department = String(departmentInput && departmentInput.value || '').trim();

    if (errorBox) errorBox.classList.add('hidden');
    if (!name) {
      showMessageElement(errorBox, 'Nama Staff wajib diisi.', 'error');
      return;
    }

    setButtonLoading(button, true);
    try {
      var result = await apiRequest('createStaffSession', {
        name: name,
        department: department,
        clientId: getOrCreateStaffClientId(name, department)
      }, false);
      if (!result.ok || !result.data || !result.data.sessionToken) {
        throw { code: 'STAFF_ENTRY_FAILED', message: 'Mode Staff tidak dapat dibuka.', status: 400 };
      }
      state.sessionToken = String(result.data.sessionToken);
      state.expiresAt = String(result.data.expiresAt || '');
      state.user = result.data.user || null;
      try {
        window.localStorage.setItem('atk_staff_name', name);
        window.localStorage.setItem('atk_staff_department', department);
      } catch (storageErr) {}
      persistSession();
      showMain();
    } catch (error) {
      showMessageElement(errorBox, getFriendlyError(error), 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function restoreSession() {
    var raw = null;

    try {
      raw = window.localStorage.getItem(STORAGE_KEYS.SESSION);
    } catch (err) {
      raw = null;
    }

    if (!raw) {
      showLogin();
      return;
    }

    var saved;
    try {
      saved = JSON.parse(raw);
    } catch (err2) {
      clearSession();
      showLogin();
      return;
    }

    if (!saved || !saved.sessionToken) {
      clearSession();
      showLogin();
      return;
    }

    state.sessionToken = String(saved.sessionToken);
    state.expiresAt = String(saved.expiresAt || '');

    try {
      var result = await apiRequest('me', {}, false);

      if (!result.ok || !result.data || !result.data.user) {
        clearSession();
        showLogin();
        return;
      }

      state.user = result.data.user;
      state.expiresAt = String(result.data.expiresAt || state.expiresAt);

      persistSession();
      showMain();
    } catch (error) {
      clearSession();
      showLogin();
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();

    var usernameInput = document.getElementById('loginUsername');
    var passwordInput = document.getElementById('loginPassword');
    var button = document.getElementById('loginButton');
    var errorBox = document.getElementById('loginError');

    var username = String(usernameInput.value || '').trim();
    var password = String(passwordInput.value || '');

    hideElement(errorBox);

    if (!username || !password) {
      showMessageElement(errorBox, 'Username dan password wajib diisi.', 'error');
      return;
    }

    setButtonLoading(button, true);

    try {
      var result = await apiRequest('login', {
        username: username,
        password: password
      }, true);

      if (!result.ok || !result.data || !result.data.sessionToken) {
        throw {
          code: 'LOGIN_FAILED',
          message: extractErrorMessage(result) || 'Login gagal.',
          status: 401
        };
      }

      state.sessionToken = String(result.data.sessionToken);
      state.expiresAt = String(result.data.expiresAt || '');
      state.user = result.data.user || null;

      persistSession();
      passwordInput.value = '';
      showMain();
    } catch (error) {
      showMessageElement(errorBox, getFriendlyError(error), 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function handleLogout() {
    if (state.approvalBadgeTimer) { window.clearInterval(state.approvalBadgeTimer); state.approvalBadgeTimer = null; }
    stopFinalScanner();
    stopProductScanner();
    stopReceiveScanner();
    var token = state.sessionToken;
    clearSession();
    showLogin();

    if (token) {
      try {
        await apiRequest('logout', {}, false, token);
      } catch (err) {
        /* Local session already cleared. */
      }
    }
  }

  function loadExternalScript(url, globalName) {
    return new Promise(function(resolve, reject) {
      if (globalName && window[globalName]) { resolve(window[globalName]); return; }
      var existing = document.querySelector('script[data-atk-src="' + url.replace(/"/g, '&quot;') + '"]');
      if (existing) {
        existing.addEventListener('load', function(){ resolve(globalName ? window[globalName] : true); }, { once: true });
        existing.addEventListener('error', function(){ reject(new Error('Library gagal dimuat.')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.atkSrc = url;
      script.onload = function(){
        if (globalName && !window[globalName]) { reject(new Error('Library tidak tersedia setelah dimuat.')); return; }
        resolve(globalName ? window[globalName] : true);
      };
      script.onerror = function(){ reject(new Error('Library gagal dimuat dari jaringan.')); };
      document.head.appendChild(script);
    });
  }

  function ensureExcelLibraryFinal() {
    if (typeof XLSX !== 'undefined') return Promise.resolve(XLSX);
    if (!state.libraryPromises.excel) {
      state.libraryPromises.excel = loadExternalScript(
        'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
        'XLSX'
      ).catch(function(err){ state.libraryPromises.excel = null; throw err; });
    }
    return state.libraryPromises.excel;
  }

  function ensureScannerLibraryFinal() {
    if (typeof Html5Qrcode !== 'undefined') return Promise.resolve(Html5Qrcode);
    if (!state.libraryPromises.scanner) {
      state.libraryPromises.scanner = loadExternalScript(
        'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
        'Html5Qrcode'
      ).catch(function(err){ state.libraryPromises.scanner = null; throw err; });
    }
    return state.libraryPromises.scanner;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    var requestOptions = options || {};

    if (controller) {
      requestOptions.signal = controller.signal;
      timer = window.setTimeout(function () { controller.abort(); }, timeoutMs);
    }

    try {
      return await fetch(url, requestOptions);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw {
          code: 'TIMEOUT_ERROR',
          message: 'Server terlalu lama merespons. Silakan coba lagi.',
          status: 408
        };
      }
      throw err;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  async function apiRequest(action, data, includeCredentials, tokenOverride) {
    var payload = {
      action: action,
      data: data || {}
    };

    if (includeCredentials !== false) {
      payload.sessionToken = tokenOverride || state.sessionToken || '';
    }

    var response;

    try {
      response = await fetchWithTimeout(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      }, 20000);
    } catch (networkError) {
      if (networkError && networkError.code === 'TIMEOUT_ERROR') {
        setConnectionStatus('error');
        throw networkError;
      }
      setConnectionStatus('offline');
      throw {
        code: 'NETWORK_ERROR',
        message: 'Tidak dapat terhubung ke server. Periksa koneksi internet.',
        status: 0
      };
    }

    var rawText = await response.text();
    var result = null;

    if (rawText) {
      try {
        result = JSON.parse(rawText);
      } catch (parseError) {
        setConnectionStatus('error');
        throw {
          code: 'INVALID_JSON',
          message: 'Server mengembalikan respons yang bukan JSON valid.',
          status: response.status
        };
      }
    }

    if (!result || typeof result !== 'object') {
      setConnectionStatus('error');
      throw {
        code: 'INVALID_JSON',
        message: 'Respons server tidak valid.',
        status: response.status
      };
    }

    if (response.ok && result.ok === true) {
      setConnectionStatus('online');
      return result;
    }

    if (result.ok === false) {
      var apiError = result.error || {};
      var normalized = {
        code: String(apiError.code || 'API_ERROR'),
        message: String(apiError.message || 'Permintaan gagal.'),
        status: Number(apiError.status || response.status || 500)
      };

      if ((normalized.code === 'SESSION_EXPIRED' || normalized.status === 401) &&
          action !== 'login') {
        handleSessionExpired();
      }

      throw normalized;
    }

    throw {
      code: 'API_ERROR',
      message: 'Format respons server tidak sesuai kontrak.',
      status: response.status
    };
  }

  function handleSessionExpired() {
    clearSession();
    showLogin();
    showGlobalMessage('Session Anda sudah berakhir. Silakan login kembali.', 'warning');
  }

  function showLogin() {
    hideElement(document.getElementById('loadingScreen'));
    hideElement(document.getElementById('mainView'));
    showElement(document.getElementById('loginView'));
    hideStaffEntry();

    var input = document.getElementById('loginUsername');
    if (input) {
      window.setTimeout(function () {
        input.focus();
      }, 0);
    }
  }

  function showMain() {
    hideElement(document.getElementById('loadingScreen'));
    hideElement(document.getElementById('loginView'));
    showElement(document.getElementById('mainView'));

    if (!state.user) {
      state.user = {
        name: 'User',
        username: 'user',
        role: '',
        department: ''
      };
    }

    applyUserIdentity();
    buildNavigation();
    renderPage('dashboard');
    startApprovalBadgePolling();
    setConnectionStatus('online');
  }

  function applyUserIdentity() {
    var user = state.user || {};
    var name = String(user.name || user.username || 'User');
    var role = String(user.role || '').toUpperCase();
    var department = String(user.department || '-');
    var initial = getInitials(name);

    setText('sidebarUserName', name);
    setText('sidebarUserDepartment', department);
    setText('sidebarRole', role || '-');
    setText('topUserName', name);
    setText('topUserRole', role || '-');
    setText('sidebarUserInitial', initial);
    setText('topUserInitial', initial);
  }

  function buildNavigation() {
    var nav = document.getElementById('mainNav');
    if (!nav) return;

    nav.innerHTML = '';

    var role = String(state.user && state.user.role || '').toUpperCase();
    var items = NAV_ITEMS[role] || [];
    var currentSection = '';

    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      if (item.section !== currentSection) {
        currentSection = item.section;

        var section = document.createElement('div');
        section.className = 'nav-section-label';
        section.textContent = SECTION_LABELS[currentSection] || currentSection;
        nav.appendChild(section);
      }

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-item nav-action-' + String(item.action).replace(/[^a-zA-Z0-9_-]/g, '-');
      button.setAttribute('data-action', item.action);
      button.innerHTML =
        '<span class="nav-icon">' + escapeHtml(item.icon) + '</span>' +
        '<span class="nav-label">' + escapeHtml(item.label) + '</span>' +
        (item.action === 'listRequests' && role === 'ADMIN' ? '<span class="nav-pending-badge hidden" id="approvalPendingBadge">0</span>' : '');

      button.addEventListener('click', function () {
        state.activePage = this.getAttribute('data-action') || 'dashboard';
        renderPage(state.activePage);
        closeSidebar();
      });

      nav.appendChild(button);
    }

    updateActiveNavigation();
  }

  async function refreshApprovalBadge() {
    if (!state.user || String(state.user.role || '').toUpperCase() !== 'ADMIN') return;
    var badge = document.getElementById('approvalPendingBadge');
    if (!badge) return;
    try {
      var result = await apiRequest('listRequests', {});
      var items = result.data && Array.isArray(result.data.items) ? result.data.items : [];
      var pending = items.filter(function (x) {
        return x && x.request && String(x.request.status || '').toUpperCase() === 'MENUNGGU';
      }).length;
      badge.textContent = String(pending);
      badge.classList.toggle('hidden', pending <= 0);
      badge.setAttribute('aria-label', pending + ' pengajuan menunggu approval');
    } catch (err) {
      // Badge is informative only; do not block the application when refresh fails.
    }
  }

  function startApprovalBadgePolling() {
    if (state.approvalBadgeTimer) {
      window.clearInterval(state.approvalBadgeTimer);
      state.approvalBadgeTimer = null;
    }
    if (!state.user || String(state.user.role || '').toUpperCase() !== 'ADMIN') return;
    refreshApprovalBadge();
    state.approvalBadgeTimer = window.setInterval(refreshApprovalBadge, 30000);
  }

  function updateActiveNavigation() {
    var buttons = document.querySelectorAll('.nav-item');

    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute('data-action') === state.activePage;
      if (active) buttons[i].classList.add('active');
      else buttons[i].classList.remove('active');
    }
  }

  async function renderPage(action) {
    stopFinalScanner();
    stopProductScanner();
    stopReceiveScanner();

    var title = getPageTitle(action);
    setText('pageTitle', title);

    var content = document.getElementById('pageContent');
    if (!content) return;

    content.innerHTML =
      '<div class="page-heading">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<p>Memuat data...</p>' +
      '</div>';

    updateActiveNavigation();

    try {
      if (action === 'dashboard') {
        await renderDashboard(content);
      } else if (action === 'listCategories') {
        await renderCategories(content);
      } else if (action === 'listSuppliers') {
        await renderSuppliers(content);
      } else if (action === 'listProducts') {
        await renderProducts(content);
      } else if (action === 'listUsers') {
        await renderUsers(content);
      } else if (action === 'searchProducts') {
        await renderSearchProducts(content);
      } else if (action === 'receiveStock') {
        await renderFinalReceiveStock(content);
      } else if (action === 'adjustStock') {
        await renderFinalAdjustment(content);
      } else if (action === 'listMovements') {
        await renderFinalMovements(content);
      } else if (action === 'listRequests') {
        await renderFinalRequests(content);
      } else if (action === 'myRequests') {
        await renderFinalRequests(content, false);
      } else if (action === 'createRequest') {
        await renderFinalCreateRequest(content);
      } else if (action === 'barcodeScanner') {
        await renderFinalScanner(content);
      } else if (action === 'reorderRecommendations') {
        await renderFinalReorder(content);
      } else if (action === 'listPurchaseOrders') {
        await renderFinalPO(content);
      } else if (action === 'receivePurchaseOrder') {
        await renderFinalPOReceipt(content);
      } else if (action === 'stockReport') {
        await renderFinalReports(content);
      } else if (action === 'bulkUpsertProducts') {
        await renderFinalImport(content);
      } else if (action === 'exportExcel') {
        await renderFinalExport(content);
      } else if (action === 'printRequests') {
        await renderFinalRequests(content, true);
      } else if (action === 'changePassword') {
        renderChangePassword(content);
      } else {
        renderPlaceholder(content, action, title);
      }
    } catch (error) {
      content.innerHTML =
        '<div class="placeholder-card">' +
        '<h3>Gagal memuat data</h3>' +
        '<p>' + escapeHtml(getFriendlyError(error)) + '</p>' +
        '<button type="button" class="btn btn-secondary" id="retryPageButton">Coba lagi</button>' +
        '</div>';

      var retry = document.getElementById('retryPageButton');
      if (retry) {
        retry.addEventListener('click', function () {
          renderPage(state.activePage);
        });
      }
    }
  }

  async function renderDashboard(content) {
    var result = await apiRequest('dashboard', {});
    var summary = result.data && result.data.summary ? result.data.summary : {};
    var usage = result.data && result.data.usage30Days ? result.data.usage30Days : [];
    var topUsed = result.data && result.data.topUsedProducts ? result.data.topUsedProducts : [];
    var alerts = result.data && result.data.alerts ? result.data.alerts : {};

    if (state.user && String(state.user.role || '').toUpperCase() === 'ADMIN') {
      var badge = document.getElementById('approvalPendingBadge');
      var pendingFromDashboard = Number(alerts.pendingRequests || 0);
      if (badge) {
        badge.textContent = String(pendingFromDashboard);
        badge.classList.toggle('hidden', pendingFromDashboard <= 0);
      }
    }

    // Dashboard utama menampilkan Top 10 barang berdasarkan total qty OUT selama 30 hari.
    // Data berasal dari agregasi backend (bukan per tanggal), sehingga nama barang langsung terlihat.
    var usageProducts = topUsed.slice(0, 10);
    var usageMax = Math.max.apply(null, usageProducts.map(function (x) { return Number(x.qty || 0); }).concat([1]));
    var usageHtml = usageProducts.map(function (x) {
      var qty = Number(x.qty || 0);
      var pct = Math.max(2, Math.round((qty / usageMax) * 100));
      var label = String(x.productName || x.sku || 'Barang');
      var sku = String(x.sku || '');
      return '<div class="usage-row" title="' + escapeHtml(label + (sku ? ' (' + sku + ')' : '') + ': ' + number(qty) + ' keluar') + '">' +
        '<div class="usage-label"><span class="usage-product-name">' + escapeHtml(label) + '</span><strong>' + escapeHtml(number(qty)) + ' keluar</strong></div>' +
        (sku ? '<div class="usage-product-sku">' + escapeHtml(sku) + '</div>' : '') +
        '<div class="usage-track"><span style="width:' + pct + '%"></span></div>' +
        '</div>';
    }).join('');

    var topUsedHtml = topUsed.slice(0, 5).length ? topUsed.slice(0, 5).map(function (x) {
      return '<div class="top-use-row"><div><strong>' + escapeHtml(x.productName) + '</strong><span>' + escapeHtml(x.sku) + '</span></div><strong>' + escapeHtml(number(x.qty)) + ' keluar</strong></div>';
    }).join('') : '<div class="empty-cell">Belum ada pemakaian barang pada periode ini.</div>';

    content.innerHTML =
      '<div class="page-heading">' +
      '<h3>Dashboard</h3>' +
      '<p>Ringkasan operasional ATK Inventory.</p>' +
      '</div>' +
      '<div class="stat-grid">' +
      statCard('Barang Aktif', number(summary.products)) +
      statCard('Kategori', number(summary.categories)) +
      statCard('Supplier', number(summary.suppliers)) +
      statCard('User', number(summary.users)) +
      '</div>' +
      '<div class="dashboard-grid dashboard-operations">' +
      '<div class="panel dashboard-chart-panel">' +
        '<div class="panel-header"><div><h4 class="panel-title">Pemakaian Barang 30 Hari</h4><p class="panel-copy">Top 10 barang berdasarkan total qty keluar dalam 30 hari terakhir.</p></div><span class="dashboard-chip">OUT</span></div>' +
        '<div class="usage-chart">' + (usageHtml || '<div class="empty-cell">Belum ada histori pemakaian.</div>') + '</div>' +
      '</div>' +
      '<div class="panel dashboard-summary-panel">' +
        '<div class="panel-header"><div><h4 class="panel-title">Ringkasan Operasional</h4><p class="panel-copy">Hal yang perlu diperhatikan saat ini.</p></div></div>' +
        '<div class="dashboard-kpi-grid">' +
          '<div class="mini-kpi danger"><span>Stok ≤ Minimum</span><strong>' + escapeHtml(number(alerts.lowStock || 0)) + '</strong></div>' +
          '<div class="mini-kpi warning"><span>Pengajuan Menunggu</span><strong>' + escapeHtml(number(alerts.pendingRequests || 0)) + '</strong></div>' +
          '<div class="mini-kpi info"><span>PO Berjalan</span><strong>' + escapeHtml(number(alerts.openPurchaseOrders || 0)) + '</strong></div>' +
          '<div class="mini-kpi success"><span>Total Keluar 30 Hari</span><strong>' + escapeHtml(number(alerts.totalOut30Days || 0)) + '</strong></div>' +
        '</div>' +
        '<div class="top-use-list"><div class="panel-subtitle">Barang Paling Banyak Keluar</div>' + topUsedHtml + '</div>' +
      '</div>' +
      '</div>';
  }

  async function renderCategories(content) {
    var result = await apiRequest('listCategories', {});
    state.caches.categories = result.data && result.data.items ? result.data.items : [];

    content.innerHTML =
      pageHeaderBlock(
        'Kategori',
        'Kelola kategori barang. Nama kategori harus unik.',
        '<button class="btn btn-primary" type="button" id="addCategoryButton">+ Tambah Kategori</button>'
      ) +
      '<div class="panel">' +
      tableToolbar('categorySearch', 'Cari kategori...') +
      '<div class="table-wrap"><table class="data-table">' +
      '<thead><tr><th>Nama Kategori</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead>' +
      '<tbody id="categoryTableBody">' + renderCategoryRows(state.caches.categories) + '</tbody>' +
      '</table></div></div>';

    bindCategoryEvents();
  }

  function renderCategoryRows(items, query) {
    var search = String(query || '').toLowerCase().trim();
    var filtered = items.filter(function (item) {
      return !search || String(item.categoryName || '').toLowerCase().indexOf(search) >= 0;
    });

    if (!filtered.length) {
      return emptyRow(4, 'Belum ada kategori.');
    }

    return filtered.map(function (item) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(item.categoryName) + '</strong></td>' +
        '<td>' + statusBadge(item.active) + '</td>' +
        '<td>' + escapeHtml(formatDate(item.createdAt)) + '</td>' +
        '<td><button type="button" class="btn btn-secondary btn-sm edit-category" data-id="' +
        escapeHtml(item.categoryId) + '">Edit</button></td>' +
        '</tr>';
    }).join('');
  }

  function bindCategoryEvents() {
    var add = document.getElementById('addCategoryButton');
    if (add) {
      add.addEventListener('click', function () {
        openCategoryModal(null);
      });
    }

    var search = document.getElementById('categorySearch');
    if (search) {
      search.addEventListener('input', function () {
        var body = document.getElementById('categoryTableBody');
        body.innerHTML = renderCategoryRows(state.caches.categories, search.value);
        bindCategoryEditButtons();
      });
    }

    bindCategoryEditButtons();
  }

  function bindCategoryEditButtons() {
    var buttons = document.querySelectorAll('.edit-category');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var item = state.caches.categories.find(function (row) {
          return String(row.categoryId) === String(id);
        });
        openCategoryModal(item || null);
      });
    }
  }

  function openCategoryModal(item) {
    openModal({
      title: item ? 'Edit Kategori' : 'Tambah Kategori',
      body:
        '<form id="categoryForm">' +
        '<div class="form-group"><label for="categoryNameInput">Nama Kategori</label>' +
        '<input id="categoryNameInput" class="field" maxlength="100" required value="' +
        escapeAttribute(item ? item.categoryName : '') + '"></div>' +
        '<div id="modalMessage" class="form-message hidden" role="alert"></div>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-close-modal>Batal</button>' +
        '<button type="submit" form="categoryForm" class="btn btn-primary">' +
        (item ? 'Simpan Perubahan' : 'Simpan') + '</button>'
    });

    document.getElementById('categoryForm').addEventListener('submit', async function (event) {
      event.preventDefault();

      var input = document.getElementById('categoryNameInput');
      var message = document.getElementById('modalMessage');
      var button = document.querySelector('#modalFooter button.btn-primary');

      if (!input.value.trim()) {
        showMessageElement(message, 'Nama kategori wajib diisi.', 'error');
        return;
      }

      setButtonLoadingGeneric(button, true, item ? 'Menyimpan...' : 'Menyimpan...');

      try {
        await apiRequest(item ? 'updateCategory' : 'createCategory', {
          categoryId: item ? item.categoryId : '',
          categoryName: input.value.trim()
        });

        closeModal();
        renderPage('listCategories');
        showGlobalMessage(
          item ? 'Kategori berhasil diperbarui.' : 'Kategori berhasil ditambahkan.',
          'success'
        );
      } catch (error) {
        showMessageElement(message, getFriendlyError(error), 'error');
      } finally {
        setButtonLoadingGeneric(button, false, item ? 'Simpan Perubahan' : 'Simpan');
      }
    });
  }

  async function renderSuppliers(content) {
    var result = await apiRequest('listSuppliers', {});
    state.caches.suppliers = result.data && result.data.items ? result.data.items : [];

    content.innerHTML =
      pageHeaderBlock(
        'Supplier',
        'Kelola data supplier. Kode supplier harus unik.',
        '<button class="btn btn-primary" type="button" id="addSupplierButton">+ Tambah Supplier</button>'
      ) +
      '<div class="panel">' +
      tableToolbar('supplierSearch', 'Cari kode, nama, PIC, telepon...') +
      '<div class="table-wrap"><table class="data-table">' +
      '<thead><tr><th>Kode</th><th>Nama</th><th>PIC</th><th>Telepon</th><th>Email</th><th>Status</th><th>Aksi</th></tr></thead>' +
      '<tbody id="supplierTableBody">' + renderSupplierRows(state.caches.suppliers) + '</tbody>' +
      '</table></div></div>';

    var add = document.getElementById('addSupplierButton');
    if (add) add.addEventListener('click', function () { openSupplierModal(null); });

    var search = document.getElementById('supplierSearch');
    if (search) {
      search.addEventListener('input', function () {
        var body = document.getElementById('supplierTableBody');
        body.innerHTML = renderSupplierRows(state.caches.suppliers, search.value);
        bindSupplierButtons();
      });
    }

    bindSupplierButtons();
  }

  function renderSupplierRows(items, query) {
    var search = String(query || '').toLowerCase().trim();

    var filtered = items.filter(function (item) {
      var haystack = [
        item.code, item.name, item.pic, item.phone, item.email
      ].join(' ').toLowerCase();
      return !search || haystack.indexOf(search) >= 0;
    });

    if (!filtered.length) {
      return emptyRow(7, 'Belum ada supplier.');
    }

    return filtered.map(function (item) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(item.code) + '</strong></td>' +
        '<td>' + escapeHtml(item.name) + '</td>' +
        '<td>' + escapeHtml(item.pic || '-') + '</td>' +
        '<td>' + escapeHtml(item.phone || '-') + '</td>' +
        '<td>' + escapeHtml(item.email || '-') + '</td>' +
        '<td>' + statusBadge(item.active) + '</td>' +
        '<td><button type="button" class="btn btn-secondary btn-sm edit-supplier" data-id="' +
        escapeHtml(item.supplierId) + '">Edit</button></td>' +
        '</tr>';
    }).join('');
  }

  function bindSupplierButtons() {
    var buttons = document.querySelectorAll('.edit-supplier');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var item = state.caches.suppliers.find(function (row) {
          return String(row.supplierId) === String(id);
        });
        openSupplierModal(item || null);
      });
    }
  }

  function openSupplierModal(item) {
    openModal({
      title: item ? 'Edit Supplier' : 'Tambah Supplier',
      body:
        '<form id="supplierForm">' +
        '<div class="form-grid">' +
        fieldHtml('supplierCodeInput', 'Kode Supplier', item ? item.code : '', 40, true) +
        fieldHtml('supplierNameInput', 'Nama Supplier', item ? item.name : '', 150, true) +
        fieldHtml('supplierPicInput', 'PIC', item ? item.pic : '', 100, false) +
        fieldHtml('supplierPhoneInput', 'Telepon', item ? item.phone : '', 50, false) +
        fieldHtml('supplierEmailInput', 'Email', item ? item.email : '', 120, false, 'email') +
        '</div>' +
        '<div class="form-group"><label for="supplierAddressInput">Alamat</label>' +
        '<textarea id="supplierAddressInput" class="field" rows="3" maxlength="500">' +
        escapeHtml(item ? item.address : '') + '</textarea></div>' +
        '<div id="modalMessage" class="form-message hidden" role="alert"></div>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-close-modal>Batal</button>' +
        '<button type="submit" form="supplierForm" class="btn btn-primary">Simpan</button>'
    });

    document.getElementById('supplierForm').addEventListener('submit', async function (event) {
      event.preventDefault();

      var message = document.getElementById('modalMessage');
      var button = document.querySelector('#modalFooter button.btn-primary');

      var data = {
        supplierId: item ? item.supplierId : '',
        code: document.getElementById('supplierCodeInput').value.trim(),
        name: document.getElementById('supplierNameInput').value.trim(),
        pic: document.getElementById('supplierPicInput').value.trim(),
        phone: document.getElementById('supplierPhoneInput').value.trim(),
        email: document.getElementById('supplierEmailInput').value.trim(),
        address: document.getElementById('supplierAddressInput').value.trim()
      };

      setButtonLoadingGeneric(button, true, 'Menyimpan...');

      try {
        await apiRequest(item ? 'updateSupplier' : 'createSupplier', data);
        closeModal();
        renderPage('listSuppliers');
        showGlobalMessage(
          item ? 'Supplier berhasil diperbarui.' : 'Supplier berhasil ditambahkan.',
          'success'
        );
      } catch (error) {
        showMessageElement(message, getFriendlyError(error), 'error');
      } finally {
        setButtonLoadingGeneric(button, false, 'Simpan');
      }
    });
  }

  async function renderProducts(content) {
    var results = await Promise.all([
      apiRequest('listProducts', { includeInactive: true }),
      apiRequest('listCategories', {}),
      apiRequest('listSuppliers', {})
    ]);

    state.caches.products = results[0].data && results[0].data.items ? results[0].data.items : [];
    state.caches.categories = results[1].data && results[1].data.items ? results[1].data.items : [];
    state.caches.suppliers = results[2].data && results[2].data.items ? results[2].data.items : [];

    content.innerHTML =
      pageHeaderBlock(
        'Master Barang',
        'Kelola SKU, barcode, kategori, supplier, min/max stock, harga, dan lokasi. Current Stock tidak diedit dari sini.',
        '<button class="btn btn-primary" type="button" id="addProductButton">+ Tambah Barang</button>'
      ) +
      '<div class="panel">' +
      tableToolbar('productSearch', 'Cari SKU, barcode, nama barang...') +
      '<div class="table-wrap"><table class="data-table">' +
      '<thead><tr><th>SKU</th><th>Barcode</th><th>Nama Barang</th><th>Kategori</th><th>Supplier</th><th>Min</th><th>Max</th><th>Stok</th><th>Harga</th><th>Status</th><th>Aksi</th></tr></thead>' +
      '<tbody id="productTableBody">' + renderProductRows(state.caches.products) + '</tbody>' +
      '</table></div></div>';

    document.getElementById('addProductButton').addEventListener('click', function () {
      openProductModal(null);
    });

    document.getElementById('productSearch').addEventListener('input', function () {
      document.getElementById('productTableBody').innerHTML =
        renderProductRows(state.caches.products, this.value);
      bindProductButtons();
    });

    bindProductButtons();
  }

  function renderProductRows(items, query) {
    var search = String(query || '').toLowerCase().trim();

    var filtered = items.filter(function (item) {
      if (!search) return true;
      return [
        item.sku, item.barcode, item.name
      ].join(' ').toLowerCase().indexOf(search) >= 0;
    });

    if (!filtered.length) {
      return emptyRow(11, 'Belum ada barang.');
    }

    return filtered.map(function (item) {
      var category = findCacheName(state.caches.categories, 'categoryId', item.categoryId, 'categoryName');
      var supplier = findCacheName(state.caches.suppliers, 'supplierId', item.supplierId, 'name');

      return '<tr>' +
        '<td><strong>' + escapeHtml(item.sku) + '</strong></td>' +
        '<td>' + escapeHtml(item.barcode) + '</td>' +
        '<td>' + escapeHtml(item.name) + '<div class="muted-cell">' +
        escapeHtml(item.unit) + ' · ' + escapeHtml(item.location) + '</div></td>' +
        '<td>' + escapeHtml(category || '-') + '</td>' +
        '<td>' + escapeHtml(supplier || '-') + '</td>' +
        '<td>' + number(item.minStock) + '</td>' +
        '<td>' + number(item.maxStock) + '</td>' +
        '<td><strong>' + number(item.currentStock) + '</strong></td>' +
        '<td>' + formatMoney(item.price) + '</td>' +
        '<td>' + statusBadge(item.active) + '</td>' +
        '<td>' +
        '<div class="action-group">' +
        '<button type="button" class="btn btn-secondary btn-sm edit-product" data-id="' + escapeAttribute(item.productId) + '">Edit</button>' +
        '<button type="button" class="btn btn-danger btn-sm toggle-product" data-id="' + escapeAttribute(item.productId) + '">' +
        (item.active ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
        '</div>' +
        '</td></tr>';
    }).join('');
  }

  function bindProductButtons() {
    var editButtons = document.querySelectorAll('.edit-product');
    for (var i = 0; i < editButtons.length; i++) {
      editButtons[i].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var item = state.caches.products.find(function (row) {
          return String(row.productId) === String(id);
        });
        openProductModal(item || null);
      });
    }

    var toggleButtons = document.querySelectorAll('.toggle-product');
    for (var j = 0; j < toggleButtons.length; j++) {
      toggleButtons[j].addEventListener('click', async function () {
        var id = this.getAttribute('data-id');
        var item = state.caches.products.find(function (row) {
          return String(row.productId) === String(id);
        });

        if (!item) return;

        var actionText = item.active ? 'menonaktifkan' : 'mengaktifkan';
        var confirmed = window.confirm(
          'Yakin ingin ' + actionText + ' barang "' + item.name + '"?'
        );

        if (!confirmed) return;

        this.disabled = true;

        try {
          await apiRequest('toggleProduct', { productId: id });
          showGlobalMessage('Status barang berhasil diubah.', 'success');
          renderPage('listProducts');
        } catch (error) {
          showGlobalMessage(getFriendlyError(error), 'error');
          this.disabled = false;
        }
      });
    }
  }

  function openProductModal(item, options) {
    options = options || {};
    var forceCreate = !!options.forceCreate;
    var editMode = !!item && !forceCreate;
    var categories = activeItems(state.caches.categories);
    var suppliers = activeItems(state.caches.suppliers);

    if (!categories.length || !suppliers.length) {
      showGlobalMessage(
        'Sebelum membuat barang, pastikan minimal ada 1 Kategori aktif dan 1 Supplier aktif.',
        'warning'
      );
      return;
    }

    var categoryOptions = categories.map(function (row) {
      return '<option value="' + escapeAttribute(row.categoryId) + '"' +
        (item && item.categoryId && String(item.categoryId) === String(row.categoryId) ? ' selected' : '') +
        '>' + escapeHtml(row.categoryName) + '</option>';
    }).join('');

    var supplierOptions = suppliers.map(function (row) {
      return '<option value="' + escapeAttribute(row.supplierId) + '"' +
        (item && item.supplierId && String(item.supplierId) === String(row.supplierId) ? ' selected' : '') +
        '>' + escapeHtml(row.name) + ' (' + escapeHtml(row.code) + ')</option>';
    }).join('');

    var barcodeValue = item && item.barcode ? item.barcode : '';
    var barcodeScannerHtml =
      '<div class="barcode-input-wrap">' +
      '<div class="barcode-input-line">' +
      '<input id="productBarcodeInput" class="field" type="text" maxlength="100" required value="' + escapeAttribute(barcodeValue) + '">' +
      '<button type="button" class="btn btn-secondary barcode-scan-btn" id="productBarcodeScanButton">▦ Scan</button>' +
      '</div>' +
      '<div id="productBarcodeScannerPanel" class="inline-scanner hidden">' +
      '<div id="productBarcodeScannerArea" class="scanner-stage compact"></div>' +
      '<div class="report-actions">' +
      '<button type="button" class="btn btn-primary" id="startProductScanner">Mulai Kamera</button>' +
      '<button type="button" class="btn btn-secondary" id="stopProductScanner">Stop Kamera</button>' +
      '</div>' +
      '<div id="productScannerMessage" class="form-message hidden" role="alert"></div>' +
      '</div>' +
      '</div>';

    openModal({
      title: editMode ? 'Edit Barang' : (options.fromScanner ? 'Simpan Barang dari Barcode' : 'Tambah Barang'),
      body:
        '<form id="productForm">' +
        '<div class="form-grid">' +
        fieldHtml('productSkuInput', 'SKU', editMode ? item.sku : '', 60, true) +
        '<div class="form-group"><label for="productBarcodeInput">Barcode</label>' +
        barcodeScannerHtml + '</div>' +
        fieldHtml('productNameInput', 'Nama Barang', editMode ? item.name : '', 200, true) +
        '<div class="form-group"><label for="productCategoryInput">Kategori</label>' +
        '<select id="productCategoryInput" class="field" required>' +
        '<option value="">Pilih kategori</option>' + categoryOptions + '</select></div>' +
        fieldHtml('productUnitInput', 'Satuan', editMode ? item.unit : '', 40, true) +
        fieldHtmlNumber('productMinInput', 'Min Stock', editMode ? item.minStock : 0, true) +
        fieldHtmlNumber('productMaxInput', 'Max Stock', editMode ? item.maxStock : 1, true) +
        fieldHtmlNumber('productPriceInput', 'Harga', editMode ? item.price : 0, true, 'number') +
        '<div class="form-group"><label for="productSupplierInput">Supplier</label>' +
        '<select id="productSupplierInput" class="field" required>' +
        '<option value="">Pilih supplier</option>' + supplierOptions + '</select></div>' +
        fieldHtml('productLocationInput', 'Lokasi', editMode ? item.location : '', 150, true) +
        '</div>' +
        '<div class="info-strip">Current Stock saat ini: <strong>' +
        number(editMode ? item.currentStock : 0) +
        '</strong>. Field ini hanya berubah melalui transaksi stok.</div>' +
        (options.fromScanner ? '<div class="info-strip scanner-prefill-note">Barcode dari hasil scanner sudah diisi otomatis. Lengkapi data barang lalu tekan Simpan.</div>' : '') +
        '<div id="modalMessage" class="form-message hidden" role="alert"></div>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-close-modal>Batal</button>' +
        '<button type="submit" form="productForm" class="btn btn-primary">Simpan</button>'
    });

    document.getElementById('productBarcodeScanButton').addEventListener('click', function () {
      var panel = document.getElementById('productBarcodeScannerPanel');
      if (panel) panel.classList.remove('hidden');
      startProductScanner();
    });
    document.getElementById('startProductScanner').addEventListener('click', startProductScanner);
    document.getElementById('stopProductScanner').addEventListener('click', stopProductScanner);
    setScannerUiStateFinal('startProductScanner','stopProductScanner','productScannerMessage',false,'Kamera nonaktif.');

    document.getElementById('productForm').addEventListener('submit', async function (event) {
      event.preventDefault();

      var message = document.getElementById('modalMessage');
      var button = document.querySelector('#modalFooter button.btn-primary');

      var data = {
        productId: editMode ? item.productId : '',
        sku: document.getElementById('productSkuInput').value.trim(),
        barcode: document.getElementById('productBarcodeInput').value.trim(),
        name: document.getElementById('productNameInput').value.trim(),
        categoryId: document.getElementById('productCategoryInput').value,
        unit: document.getElementById('productUnitInput').value.trim(),
        minStock: document.getElementById('productMinInput').value,
        maxStock: document.getElementById('productMaxInput').value,
        price: document.getElementById('productPriceInput').value,
        supplierId: document.getElementById('productSupplierInput').value,
        location: document.getElementById('productLocationInput').value.trim()
      };

      setButtonLoadingGeneric(button, true, 'Menyimpan...');

      try {
        await apiRequest(editMode ? 'updateProduct' : 'createProduct', data);
        await stopProductScanner();
        closeModal();
        renderPage('listProducts');
        showGlobalMessage(
          editMode ? 'Barang berhasil diperbarui.' : 'Barang berhasil ditambahkan.',
          'success'
        );
      } catch (error) {
        showMessageElement(message, getFriendlyError(error), 'error');
      } finally {
        setButtonLoadingGeneric(button, false, 'Simpan');
      }
    });
  }

  function friendlyCameraErrorFinal(err) {
    var name = err && typeof err.name === 'string' ? err.name : '';
    var raw = '';
    if (typeof err === 'string') raw = err;
    else if (err && typeof err.message === 'string') raw = err.message;
    else if (err && typeof err.toString === 'function') raw = err.toString();
    raw = String(raw || '').trim();
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission.*denied|notallowed/i.test(raw)) {
      return 'Izin kamera ditolak. Izinkan akses kamera untuk situs ini lalu tekan Mulai Kamera lagi.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'Kamera tidak ditemukan pada perangkat ini.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi yang memakai kamera lalu coba lagi.';
    }
    if (name === 'OverconstrainedError') {
      return 'Kamera belakang tidak tersedia dengan pengaturan ini. Coba lagi atau gunakan kamera lain.';
    }
    if (name === 'SecurityError') {
      return 'Akses kamera diblokir browser. Pastikan aplikasi dibuka melalui HTTPS dan izin kamera diberikan.';
    }
    if (name === 'NotSupportedError') {
      return 'Browser ini tidak mendukung akses kamera.';
    }
    if (raw && raw !== 'undefined' && raw !== 'null' && raw !== '[object Object]') return raw;
    return 'Kamera gagal dibuka. Pastikan izin kamera sudah diberikan dan kamera tidak sedang digunakan aplikasi lain.';
  }

  async function createAndStartScannerFinal(containerId, onSuccess, onFailure, qrbox) {
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      var secureErr = new Error('Akses kamera memerlukan HTTPS.');
      secureErr.name = 'SecurityError';
      throw secureErr;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      var mediaErr = new Error('Browser tidak mendukung akses kamera.');
      mediaErr.name = 'NotSupportedError';
      throw mediaErr;
    }
    var configs = [
      { facingMode: { ideal: 'environment' } },
      { facingMode: 'environment' }
    ];
    var lastError = null;
    for (var i = 0; i < configs.length; i++) {
      var scanner = null;
      try {
        scanner = new Html5Qrcode(containerId, { verbose: false });
        await scanner.start(
          configs[i],
          { fps: 10, qrbox: qrbox || { width: 280, height: 120 } },
          onSuccess,
          onFailure || function () {}
        );
        return scanner;
      } catch (err) {
        lastError = err;
        try { if (scanner) await scanner.stop(); } catch (e) {}
        try { if (scanner) scanner.clear(); } catch (e2) {}
        if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'NotReadableError')) break;
      }
    }
    throw lastError || new Error('Kamera gagal dibuka.');
  }

  function setScannerUiStateFinal(startId, stopId, messageId, isActive, messageText) {
    var startBtn = document.getElementById(startId);
    var stopBtn = document.getElementById(stopId);
    var msg = document.getElementById(messageId);
    if (startBtn) startBtn.disabled = !!isActive;
    if (stopBtn) stopBtn.disabled = !isActive;
    if (msg && messageText) {
      msg.className = 'form-message ' + (isActive ? 'success' : 'info');
      msg.textContent = messageText;
      msg.classList.remove('hidden');
    }
  }

  async function startProductScanner() {
    try { await ensureScannerLibraryFinal(); } catch (loadErr) {
      showGlobalMessage('Scanner tidak tersedia. Gunakan input barcode manual.', 'warning');
      return;
    }
    if (state.productScanner) return;

    var area = document.getElementById('productBarcodeScannerArea');
    var message = document.getElementById('productScannerMessage');
    if (!area || !message) return;

    try {
      state.productScanner = await createAndStartScannerFinal(
        'productBarcodeScannerArea',
        async function (decodedText) {
          var code = String(decodedText || '').trim();
          if (!code) return;
          var input = document.getElementById('productBarcodeInput');
          if (input) input.value = code;
          message.className = 'form-message success';
          message.textContent = 'Barcode terbaca: ' + code;
          message.classList.remove('hidden');
          await stopProductScanner();
        },
        function () {},
        { width: 280, height: 120 }
      );
      setScannerUiStateFinal('startProductScanner', 'stopProductScanner', 'productScannerMessage', true, 'Kamera aktif. Arahkan kamera ke barcode barang.');
    } catch (err) {
      state.productScanner = null;
      if (message) {
        message.className = 'form-message error';
        message.textContent = friendlyCameraErrorFinal(err);
        message.classList.remove('hidden');
      }
      var psStart = document.getElementById('startProductScanner');
      var psStop = document.getElementById('stopProductScanner');
      if (psStart) psStart.disabled = false;
      if (psStop) psStop.disabled = true;
    }
  }

  async function stopProductScanner() {
    if (state.productScanner) {
      try { await state.productScanner.stop(); } catch (err) {}
      try { state.productScanner.clear(); } catch (err2) {}
      state.productScanner = null;
    }
    setScannerUiStateFinal('startProductScanner', 'stopProductScanner', 'productScannerMessage', false, 'Kamera nonaktif.');
  }

  async function renderUsers(content) {
    var result = await apiRequest('listUsers', {});
    state.caches.users = result.data && result.data.items ? result.data.items : [];

    content.innerHTML =
      pageHeaderBlock(
        'User Management',
        'Kelola akun Admin dan Staff. Password tidak pernah ditampilkan.',
        '<button class="btn btn-primary" type="button" id="addUserButton">+ Tambah User</button>'
      ) +
      '<div class="panel">' +
      tableToolbar('userSearch', 'Cari username, nama, email, department...') +
      '<div class="table-wrap"><table class="data-table">' +
      '<thead><tr><th>Username</th><th>Nama</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th>Aksi</th></tr></thead>' +
      '<tbody id="userTableBody">' + renderUserRows(state.caches.users) + '</tbody>' +
      '</table></div></div>';

    document.getElementById('addUserButton').addEventListener('click', function () {
      openUserModal(null);
    });

    document.getElementById('userSearch').addEventListener('input', function () {
      document.getElementById('userTableBody').innerHTML =
        renderUserRows(state.caches.users, this.value);
      bindUserButtons();
    });

    bindUserButtons();
  }

  function renderUserRows(items, query) {
    var search = String(query || '').toLowerCase().trim();

    var filtered = items.filter(function (item) {
      return !search || [
        item.username, item.name, item.email, item.department, item.role
      ].join(' ').toLowerCase().indexOf(search) >= 0;
    });

    if (!filtered.length) return emptyRow(7, 'Belum ada user.');

    return filtered.map(function (item) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(item.username) + '</strong></td>' +
        '<td>' + escapeHtml(item.name) + '</td>' +
        '<td>' + escapeHtml(item.email || '-') + '</td>' +
        '<td><span class="badge">' + escapeHtml(item.role) + '</span></td>' +
        '<td>' + escapeHtml(item.department || '-') + '</td>' +
        '<td>' + statusBadge(item.active) + '</td>' +
        '<td><button type="button" class="btn btn-secondary btn-sm edit-user" data-id="' +
        escapeAttribute(item.userId) + '">Edit</button></td>' +
        '</tr>';
    }).join('');
  }

  function bindUserButtons() {
    var buttons = document.querySelectorAll('.edit-user');

    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var item = state.caches.users.find(function (row) {
          return String(row.userId) === String(id);
        });
        openUserModal(item || null);
      });
    }
  }

  function openUserModal(item) {
    openModal({
      title: item ? 'Edit User' : 'Tambah User',
      body:
        '<form id="userForm">' +
        '<div class="form-grid">' +
        fieldHtml('userUsernameInput', 'Username', item ? item.username : '', 80, true) +
        fieldHtml('userNameInput', 'Nama', item ? item.name : '', 150, true) +
        fieldHtml('userEmailInput', 'Email', item ? item.email : '', 120, false, 'email') +
        '<div class="form-group"><label for="userRoleInput">Role</label>' +
        '<select id="userRoleInput" class="field" required>' +
        '<option value="STAFF"' + (item && item.role === 'STAFF' ? ' selected' : '') + '>STAFF</option>' +
        '<option value="ADMIN"' + (item && item.role === 'ADMIN' ? ' selected' : '') + '>ADMIN</option>' +
        '</select></div>' +
        fieldHtml('userDepartmentInput', 'Department', item ? item.department : '', 120, false) +
        fieldHtml('userPasswordInput', item ? 'Password Baru (opsional)' : 'Password', '', 120, !item, 'password') +
        '</div>' +
        '<label class="checkbox-row"><input id="userActiveInput" type="checkbox" ' +
        ((!item || item.active) ? 'checked' : '') + '> User aktif</label>' +
        '<div class="info-strip">Password disimpan sebagai salted hash; password lama tidak dapat dilihat.</div>' +
        '<div id="modalMessage" class="form-message hidden" role="alert"></div>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-close-modal>Batal</button>' +
        '<button type="submit" form="userForm" class="btn btn-primary">Simpan</button>'
    });

    document.getElementById('userForm').addEventListener('submit', async function (event) {
      event.preventDefault();

      var message = document.getElementById('modalMessage');
      var button = document.querySelector('#modalFooter button.btn-primary');

      var data = {
        userId: item ? item.userId : '',
        username: document.getElementById('userUsernameInput').value.trim(),
        name: document.getElementById('userNameInput').value.trim(),
        email: document.getElementById('userEmailInput').value.trim(),
        role: document.getElementById('userRoleInput').value,
        department: document.getElementById('userDepartmentInput').value.trim(),
        password: document.getElementById('userPasswordInput').value,
        active: document.getElementById('userActiveInput').checked
      };

      setButtonLoadingGeneric(button, true, 'Menyimpan...');

      try {
        await apiRequest('saveUser', data);
        closeModal();
        renderPage('listUsers');
        showGlobalMessage(
          item ? 'User berhasil diperbarui.' : 'User berhasil ditambahkan.',
          'success'
        );
      } catch (error) {
        showMessageElement(message, getFriendlyError(error), 'error');
      } finally {
        setButtonLoadingGeneric(button, false, 'Simpan');
      }
    });
  }

  async function renderSearchProducts(content) {
    content.innerHTML =
      pageHeaderBlock(
        'Cari Barang',
        'Pencarian langsung berdasarkan SKU, barcode, atau nama barang.',
        ''
      ) +
      '<div class="panel">' +
      '<div class="search-row">' +
      '<input id="searchProductInput" class="field" autocomplete="off" placeholder="Ketik 1 huruf, SKU, barcode, atau nama barang...">' +
      '<button id="clearProductSearchButton" type="button" class="btn btn-secondary">Reset</button>' +
      '</div>' +
      '<div id="searchProductMessage" class="form-message hidden" role="alert"></div>' +
      '<div id="searchProductCount" class="panel-copy" style="margin:8px 0 12px"></div>' +
      '<div class="table-wrap search-result-wrap"><table class="data-table">' +
      '<thead><tr><th>SKU</th><th>Barcode</th><th>Nama</th><th>Unit</th><th>Stok</th><th>Lokasi</th></tr></thead>' +
      '<tbody id="searchProductBody">' + emptyRow(6, 'Memuat barang...') + '</tbody>' +
      '</table></div></div>';

    var input = document.getElementById('searchProductInput');
    var resetButton = document.getElementById('clearProductSearchButton');
    var body = document.getElementById('searchProductBody');
    var message = document.getElementById('searchProductMessage');
    var count = document.getElementById('searchProductCount');

    function renderProductRows(items) {
      if (count) count.textContent = items.length + ' barang ditemukan';
      if (!items.length) {
        body.innerHTML = emptyRow(6, 'Barang tidak ditemukan.');
        return;
      }
      body.innerHTML = items.map(function (item) {
        return '<tr>' +
          '<td><strong>' + escapeHtml(item.sku) + '</strong></td>' +
          '<td>' + escapeHtml(item.barcode || '-') + '</td>' +
          '<td>' + escapeHtml(item.name) + '</td>' +
          '<td>' + escapeHtml(item.unit || '-') + '</td>' +
          '<td><strong>' + number(item.currentStock) + '</strong></td>' +
          '<td>' + escapeHtml(item.location || '-') + '</td>' +
          '</tr>';
      }).join('');
    }

    function filterLocal(query) {
      var search = String(query || '').trim().toLowerCase();
      var items = state.caches.products || [];
      if (!search) {
        renderProductRows(items);
        return;
      }
      var filtered = items.filter(function (item) {
        return [item.sku, item.barcode, item.name].join(' ').toLowerCase().indexOf(search) >= 0;
      });
      renderProductRows(filtered);
    }

    try {
      message.className = 'form-message hidden';
      var result = await apiRequest('listProducts', { includeInactive: false });
      state.caches.products = result.data && result.data.items ? result.data.items : [];
      renderProductRows(state.caches.products);
    } catch (error) {
      body.innerHTML = emptyRow(6, 'Gagal memuat data barang.');
      message.className = 'form-message error';
      message.textContent = getFriendlyError(error);
      message.classList.remove('hidden');
      if (count) count.textContent = '';
      return;
    }

    input.addEventListener('input', function () { filterLocal(input.value); });
    resetButton.addEventListener('click', function () {
      input.value = '';
      message.className = 'form-message hidden';
      filterLocal('');
      input.focus();
    });
  }

  function renderChangePassword(content) {
    content.innerHTML =
      pageHeaderBlock('Change Password', 'Ganti password akun yang sedang login.', '') +
      '<div class="panel narrow-panel">' +
      '<form id="changePasswordForm">' +
      fieldHtml('currentPasswordInput', 'Password Lama', '', 120, true, 'password') +
      fieldHtml('newPasswordInput', 'Password Baru', '', 120, true, 'password') +
      fieldHtml('confirmPasswordInput', 'Konfirmasi Password Baru', '', 120, true, 'password') +
      '<div id="changePasswordMessage" class="form-message hidden" role="alert"></div>' +
      '<button type="submit" class="btn btn-primary">Simpan Password</button>' +
      '</form></div>';

    document.getElementById('changePasswordForm').addEventListener('submit', async function (event) {
      event.preventDefault();

      var message = document.getElementById('changePasswordMessage');
      var currentPassword = document.getElementById('currentPasswordInput').value;
      var newPassword = document.getElementById('newPasswordInput').value;
      var confirmPassword = document.getElementById('confirmPasswordInput').value;

      if (newPassword.length < 8) {
        showMessageElement(message, 'Password baru minimal 8 karakter.', 'error');
        return;
      }

      if (newPassword !== confirmPassword) {
        showMessageElement(message, 'Konfirmasi password tidak cocok.', 'error');
        return;
      }

      try {
        await apiRequest('changePassword', {
          currentPassword: currentPassword,
          newPassword: newPassword
        });

        showMessageElement(message, 'Password berhasil diubah.', 'success');
        document.getElementById('changePasswordForm').reset();
      } catch (error) {
        showMessageElement(message, getFriendlyError(error), 'error');
      }
    });
  }



  /* ========================== FINAL UI MODULES ====================== */
  async function renderFinalReceiveStock(content){
    await ensureMasterCaches();
    content.innerHTML=pageHeaderBlock('Barang Masuk','Tambah stok melalui transaksi IN. Bisa pilih barang atau scan barcode. Current Stock berubah setelah transaksi disimpan.','')+
      '<div class="panel narrow-panel"><form id="finalReceiveForm">'+
      '<div class="form-group"><label>Barang</label><div class="barcode-input-line"><select id="frProduct" class="field" required>'+productOptions()+'</select><button type="button" class="btn btn-secondary barcode-scan-btn" id="frScanButton">▦ Scan</button></div>'+
      '<div id="frScannerPanel" class="inline-scanner hidden"><div id="frScannerArea" class="scanner-stage compact"></div><div class="report-actions"><button type="button" class="btn btn-primary" id="frStartScanner">Mulai Kamera</button><button type="button" class="btn btn-secondary" id="frStopScanner">Stop Kamera</button></div><div id="frScannerMsg" class="form-message hidden" role="alert"></div></div></div>'+
      '<div class="form-group"><label>Supplier</label><select id="frSupplier" class="field"><option value="">Tanpa supplier</option>'+activeSupplierOptions()+'</select></div>'+
      '<div class="form-grid">'+numberFieldFinal('frQty','Qty',1)+fieldFinal('frDoc','Nomor Dokumen','',100,false)+ '<div class="form-group"><label>Tanggal</label><input id="frDate" class="field" type="date" value="'+todayFinal()+'" required></div></div>'+
      '<div class="form-group"><label>Catatan</label><textarea id="frNote" class="field" maxlength="500"></textarea></div><div id="frMsg" class="form-message hidden"></div><button class="btn btn-primary">Simpan Barang Masuk</button></form></div>';
    onFinal('frScanButton','click',function(){var p=byIdFinal('frScannerPanel');if(p)p.classList.remove('hidden');startReceiveScanner();});
    onFinal('frStartScanner','click',startReceiveScanner);
    onFinal('frStopScanner','click',stopReceiveScanner);
    setScannerUiStateFinal('frStartScanner','frStopScanner','frScannerMsg',false,'Kamera nonaktif.');
    onFinal('finalReceiveForm','submit',async function(e){
      e.preventDefault();var btn=this.querySelector('button[type="submit"]'),box=byIdFinal('frMsg');setBtnFinal(btn,true,'Menyimpan...');
      try{await apiFinal('receiveStock',{productId:valFinal('frProduct'),supplierId:valFinal('frSupplier'),qty:valFinal('frQty'),documentNo:valFinal('frDoc'),receiptDate:valFinal('frDate'),note:valFinal('frNote')});
        messageFinal(box,'Barang masuk berhasil disimpan.','success');showGlobalMessage('Stok bertambah.','success');this.reset();byIdFinal('frDate').value=todayFinal();await refreshProductsFinal();
      }catch(err){messageFinal(box,friendlyFinal(err),'error');}finally{setBtnFinal(btn,false,'Simpan Barang Masuk');}
    });
  }

  async function startReceiveScanner(){
    try{await ensureScannerLibraryFinal();}catch(loadErr){messageFinal(byIdFinal('frScannerMsg'),'Scanner tidak tersedia. Gunakan pilihan barang manual.','warning');return;}
    if(state.receiveScanner)return;
    var msg=byIdFinal('frScannerMsg');
    try{
      state.receiveScanner=await createAndStartScannerFinal('frScannerArea',async function(decodedText){
        var code=String(decodedText||'').trim();if(!code)return;
        await stopReceiveScanner();await lookupReceiveBarcode(code);
      },function(){},{width:280,height:120});
      setScannerUiStateFinal('frStartScanner', 'frStopScanner', 'frScannerMsg', true, 'Kamera aktif. Arahkan ke barcode barang.');
    }catch(err){state.receiveScanner=null;messageFinal(msg,friendlyCameraErrorFinal(err),'error');}
  }

  async function lookupReceiveBarcode(code){
    var clean=String(code||'').trim();if(!clean)return;
    try{
      var r=await apiFinal('searchProducts',{barcode:clean});
      var p=(r.data.items||[])[0];
      if(!p){messageFinal(byIdFinal('frScannerMsg'),'Barcode '+clean+' belum terdaftar di Master Barang.','warning');return;}
      var select=byIdFinal('frProduct');
      if(select){select.value=String(p.productId);}
      messageFinal(byIdFinal('frScannerMsg'),'Barang ditemukan: '+p.sku+' — '+p.name+'.','success');
    }catch(err){messageFinal(byIdFinal('frScannerMsg'),friendlyFinal(err),'error');}
  }

  async function stopReceiveScanner(){
    if(state.receiveScanner){try{await state.receiveScanner.stop();}catch(err){}try{state.receiveScanner.clear();}catch(err2){}state.receiveScanner=null;}
    setScannerUiStateFinal('frStartScanner','frStopScanner','frScannerMsg',false,'Kamera nonaktif.');
  }

  async function renderFinalAdjustment(content){
    await ensureMasterCaches();
    content.innerHTML=pageHeaderBlock('Adjustment / Opname','Samakan stok sistem dengan stok fisik; setiap selisih dicatat sebagai movement.','')+
      '<div class="panel narrow-panel"><form id="finalAdjustForm">'+
      '<div class="form-group"><label>Barang</label><select id="faProduct" class="field" required>'+productOptions()+'</select></div>'+
      '<div class="form-group"><label>Mode</label><select id="faMode" class="field"><option>ADJUSTMENT</option><option>OPNAME</option></select></div>'+
      numberFieldFinal('faPhysical','Physical Stock',0)+
      '<div class="form-group"><label>Tanggal</label><input id="faDate" class="field" type="date" value="'+todayFinal()+'" required></div>'+fieldFinal('faReason','Alasan','',500,true)+
      '<div id="faMsg" class="form-message hidden"></div><button class="btn btn-primary">Simpan</button></form></div>';
    onFinal('faProduct','change',function(){var p=state.products.find(function(x){return String(x.productId)===String(valFinal('faProduct'));});if(p)byIdFinal('faPhysical').value=p.currentStock;});
    onFinal('finalAdjustForm','submit',async function(e){e.preventDefault();var btn=this.querySelector('button'),box=byIdFinal('faMsg');setBtnFinal(btn,true,'Menyimpan...');try{await apiFinal('adjustStock',{productId:valFinal('faProduct'),physicalStock:valFinal('faPhysical'),mode:valFinal('faMode'),adjustmentDate:valFinal('faDate'),reason:valFinal('faReason')});messageFinal(box,'Transaksi berhasil disimpan.','success');showGlobalMessage('Stok sudah disesuaikan.','success');await refreshProductsFinal();}catch(err){messageFinal(box,friendlyFinal(err),'error');}finally{setBtnFinal(btn,false,'Simpan');}});
  }

  async function renderFinalMovements(content){
    content.innerHTML=pageHeaderBlock('Histori Mutasi','Filter berdasarkan tanggal, SKU, nama, dan jenis movement.','<div class="report-actions"><button class="btn btn-secondary" id="fmPrint">Print</button><button class="btn btn-secondary" id="fmExport">Export Excel</button></div>')+
      '<div class="panel"><div class="form-grid"><div class="form-group"><label>Dari</label><input id="fmFrom" class="field" type="date"></div><div class="form-group"><label>Sampai</label><input id="fmTo" class="field" type="date"></div>'+fieldFinal('fmSku','SKU','',80,false)+fieldFinal('fmName','Nama Barang','',120,false)+'<div class="form-group"><label>Jenis</label><select id="fmType" class="field"><option value="">Semua</option><option>IN</option><option>OUT</option><option>ADJUSTMENT</option><option>OPNAME</option></select></div></div><div class="report-actions"><button class="btn btn-primary" id="fmLoad">Tampilkan</button><button class="btn btn-secondary" id="fmReset">Reset</button></div><div id="fmPrintArea" style="margin-top:14px"><div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>SKU</th><th>Barang</th><th>Jenis</th><th>Qty</th><th>Sebelum</th><th>Sesudah</th><th>User</th><th>Catatan</th></tr></thead><tbody id="fmBody">'+emptyRowFinal(9,'Memuat data...')+'</tbody></table></div></div></div>';
    state.finalMovements=[];
    var today=todayFinal(), d=new Date(today+'T00:00:00');d.setDate(d.getDate()-29);
    setValueFinal('fmFrom',d.toISOString().slice(0,10));setValueFinal('fmTo',today);
    onFinal('fmLoad','click',load);onFinal('fmReset','click',function(){setValueFinal('fmFrom','');setValueFinal('fmTo','');load();});onFinal('fmPrint','click',function(){printHtmlFinal('fmPrintArea','Histori Mutasi');});onFinal('fmExport','click',function(){exportExcelFinal('Histori-Mutasi',state.finalMovements);});
    await load();
    async function load(){try{var from=valFinal('fmFrom'),to=valFinal('fmTo');if(from&&to&&from>to){showGlobalMessage('Rentang tanggal tidak valid.','error');return;}var r=await apiFinal('listMovements',{dateFrom:from,dateTo:to,sku:valFinal('fmSku'),productName:valFinal('fmName'),type:valFinal('fmType')});state.finalMovements=r.data.items||[];setHTMLFinal('fmBody',state.finalMovements.length?state.finalMovements.map(function(x){return '<tr><td>'+escFinal(x.movementDate)+'</td><td>'+escFinal(x.sku)+'</td><td>'+escFinal(x.productName)+'</td><td>'+escFinal(x.type)+'</td><td>'+fmtFinal(x.qty)+'</td><td>'+fmtFinal(x.stockBefore)+'</td><td>'+fmtFinal(x.stockAfter)+'</td><td>'+escFinal(x.userName)+'</td><td>'+escFinal(x.note||'-')+'</td></tr>';}).join(''):emptyRowFinal(9,'Tidak ada data pada filter ini.'));}catch(err){showGlobalMessage(friendlyFinal(err),'error');setHTMLFinal('fmBody',emptyRowFinal(9,friendlyFinal(err)));}}
  }

  async function renderFinalRequests(content,printOnly){
    var admin=String(state.user&&state.user.role||'').toUpperCase()==='ADMIN';
    var actionName=printOnly?'listPrintableRequests':'listRequests';
    var r=await apiFinal(actionName,{});
    state.requests=r.data.items||[];
    var title=admin?'Approval Pengajuan':(printOnly?'Print Pengajuan':'Pengajuan Saya');
    var desc=admin?'Approve penuh, approve sebagian, atau reject dengan alasan.':(printOnly?'Cari dan cetak pengajuan dari seluruh Staff.':'Cari pengajuan Anda dan batalkan yang masih MENUNGGU.');
    var actionHtml=printOnly
      ? '<div class="report-actions no-print"><button class="btn btn-secondary" id="frPrintNow">Print yang Dipilih <span id="frSelectedCount">0</span></button></div>'
      : (!admin ? '<button class="btn btn-primary no-print" id="frNewReq">+ Pengajuan</button>' : '');
    var filterHtml='<div class="request-filter no-print">'+
      '<input id="frSearch" class="field" type="search" placeholder="Cari No Pengajuan / Staff / Departemen / Barang...">'+
      '<input id="frFrom" class="field" type="date" aria-label="Tanggal mulai">'+
      '<input id="frTo" class="field" type="date" aria-label="Tanggal sampai">'+
      (admin||printOnly?'<select id="frStatusFilter" class="field"><option value="">Semua Status</option><option value="MENUNGGU">Menunggu</option><option value="DISETUJUI_PENUH">Disetujui Penuh</option><option value="DISETUJUI_SEBAGIAN">Disetujui Sebagian</option><option value="DITOLAK">Ditolak</option><option value="DIBATALKAN">Dibatalkan</option></select>':'')+
      '<button type="button" class="btn btn-primary" id="frApply">Cari</button><button type="button" class="btn btn-secondary" id="frReset">Reset</button>'+
      '</div>'+
      (printOnly?'<div class="request-toolbar no-print"><label class="select-all"><input id="frSelectAll" type="checkbox"><span>Pilih semua yang tampil</span></label></div>':'');
    var head=printOnly?'<th class="no-print">✓</th>':'';
    content.innerHTML=pageHeaderBlock(title,desc,actionHtml)+filterHtml+
      '<div class="panel"><div class="table-wrap" id="requestPrintArea"><table class="data-table"><thead><tr>'+head+'<th>No</th><th>Tanggal / Jam</th><th>Staff</th><th>Dept</th><th>Items</th><th>Status</th><th class="no-print">Aksi</th></tr></thead><tbody id="frReqBody">'+requestRowsFinal('', '', printOnly)+'</tbody></table></div></div>'+
      (printOnly?'<div id="frSelectedPrintArea" class="selected-print-area" aria-hidden="true"></div>':'');
    if(!printOnly){
      onFinal('frNewReq','click',function(){state.activePage='createRequest';renderPage('createRequest');});
    }
    onFinal('frPrintNow','click',printSelectedRequestsFinal);
    onFinal('frSearch','keydown',function(e){if(e.key==='Enter'){e.preventDefault();renderFilteredRequestRowsFinal();}});
    onFinal('frApply','click',renderFilteredRequestRowsFinal);
    onFinal('frReset','click',function(){setValueFinal('frSearch','');setValueFinal('frFrom','');setValueFinal('frTo','');setValueFinal('frStatusFilter','');var all=byIdFinal('frSelectAll');if(all)all.checked=false;renderFilteredRequestRowsFinal();});
    onFinal('frSelectAll','change',function(){var checked=this.checked;document.querySelectorAll('.frSelect').forEach(function(c){c.checked=checked;});updateSelectedPrintCountFinal();});
    bindSelectedPrintInputsFinal();
    bindFinalRequestButtons();
    updateSelectedPrintCountFinal();
  }

  function requestRowsFinal(query,status,printOnly){
    var admin=String(state.user&&state.user.role||'').toUpperCase()==='ADMIN';
    var q=String(query||'').trim().toLowerCase();
    var st=String(status||'').trim().toUpperCase();
    var from=valFinal('frFrom'),to=valFinal('frTo');
    var filtered=state.requests.filter(function(x){
      var r=x.request||{};
      if(st&&String(r.status||'').toUpperCase()!==st)return false;
      var d=String(r.requestDate||'').slice(0,10);
      if(from&&(!d||d<from))return false;
      if(to&&(!d||d>to))return false;
      if(!q)return true;
      var hay=[r.requestNo,r.staffName,r.department,r.status,r.requestDate,r.createdAt].concat((x.items||[]).map(function(i){return i.productName+' '+i.sku;})).join(' ').toLowerCase();
      return hay.indexOf(q)>=0;
    });
    if(!filtered.length)return emptyRowFinal(printOnly?8:7,'Tidak ada pengajuan yang sesuai.');
    return filtered.map(function(x){
      var r=x.request||{},stamp=r.createdAt||r.requestDate;
      var check=printOnly?'<td class="no-print"><input class="frSelect" type="checkbox" data-id="'+escFinal(r.requestId)+'" aria-label="Pilih '+escFinal(r.requestNo)+'"></td>':'';
      var action='';
      if(printOnly){
        action='<button class="btn btn-secondary btn-sm frView" data-id="'+escFinal(r.requestId)+'">Detail</button>';
      }else{
        action='<button class="btn btn-secondary btn-sm frView" data-id="'+escFinal(r.requestId)+'">Detail</button>'+
          (admin&&r.status==='MENUNGGU'?'<button class="btn btn-success btn-sm frApprove" data-id="'+escFinal(r.requestId)+'">Approve</button><button class="btn btn-danger btn-sm frReject" data-id="'+escFinal(r.requestId)+'">Reject</button>':'')+
          (admin&&r.status==='DITOLAK'?'<button class="btn btn-secondary btn-sm frEditRejected" data-id="'+escFinal(r.requestId)+'">Edit</button>':'')+
          (!admin&&r.status==='MENUNGGU'?'<button class="btn btn-danger btn-sm frCancel" data-id="'+escFinal(r.requestId)+'">Batalkan</button>':'');
      }
      var productNames=(x.items||[]).map(function(i){return i.productName;}).filter(Boolean);
      var productSummary=productNames.length?productNames.slice(0,2).join(', ')+(productNames.length>2?' +'+(productNames.length-2)+' barang':''):'';
      var dateCell=escFinal(formatRequestDateTimeFinal(stamp))+(productSummary?'<div class="muted-cell request-product-summary">Barang: '+escFinal(productSummary)+'</div>':'');
      return '<tr>'+check+'<td><strong>'+escFinal(r.requestNo)+'</strong></td><td>'+dateCell+'</td><td>'+escFinal(r.staffName)+'</td><td>'+escFinal(r.department||'-')+'</td><td>'+fmtFinal((x.items||[]).length)+'</td><td>'+statusFinal(r.status)+'</td><td class="no-print"><div class="action-group">'+action+'</div></td></tr>';
    }).join('');
  }

  function renderFilteredRequestRowsFinal(){
    setHTMLFinal('frReqBody',requestRowsFinal(valFinal('frSearch'),valFinal('frStatusFilter'),String(state.activePage)==='printRequests'));
    bindFinalRequestButtons();
    bindSelectedPrintInputsFinal();
    updateSelectedPrintCountFinal();
  }

  function bindSelectedPrintInputsFinal(){
    document.querySelectorAll('.frSelect').forEach(function(c){
      c.onchange=function(){ updateSelectedPrintCountFinal(); };
    });
  }

  function updateSelectedPrintCountFinal(){
    var count=document.querySelectorAll('.frSelect:checked').length;
    var el=byIdFinal('frSelectedCount');if(el)el.textContent=String(count);
  }

  function buildSelectedPrintHtmlFinal(selected){
    var printedAt=nowJakartaFinal();
    var parts=[];
    selected.forEach(function(x,index){
      var r=x.request||{};
      parts.push('<section style="page-break-after:'+(index<selected.length-1?'always':'auto')+';padding-bottom:16px">'+
        '<div class="print-meta"><strong>Pengajuan Barang</strong><span>No: '+escFinal(r.requestNo)+'<br>Dibuat: '+escFinal(formatRequestDateTimeFinal(r.createdAt||r.requestDate))+'<br>Dicetak: '+escFinal(printedAt)+'</span></div>'+        '<table class="data-table"><tbody>'+        '<tr><th style="width:22%">Staff</th><td>'+escFinal(r.staffName)+'</td><th style="width:18%">Departemen</th><td>'+escFinal(r.department||'-')+'</td></tr>'+        '<tr><th>Tanggal</th><td>'+escFinal(formatDateDisplayFinal(r.requestDate||'-'))+'</td><th>Status</th><td>'+escFinal(r.status||'-')+'</td></tr>'+        '</tbody></table>'+        (r.note?'<div class="print-general-note"><strong>Catatan Umum</strong><div>'+escFinal(r.note)+'</div></div>':'')+        '<div style="height:10px"></div><table class="data-table"><thead><tr><th>SKU</th><th>Barang</th><th>Qty Diminta</th><th>Qty Disetujui</th><th>Catatan Item</th></tr></thead><tbody>'+((x.items||[]).map(function(i){return '<tr><td>'+escFinal(i.sku)+'</td><td>'+escFinal(i.productName)+'</td><td>'+fmtFinal(i.qtyRequested)+'</td><td>'+fmtFinal(i.qtyApproved)+'</td><td>'+escFinal(i.note||'-')+'</td></tr>';}).join('')||'<tr><td colspan="5">Tidak ada item.</td></tr>')+'</tbody></table>'+        (r.rejectionReason?'<p><strong>Alasan Reject:</strong> '+escFinal(r.rejectionReason)+'</p>':'')+        '<div class="print-signature"><div class="signature-box"><div class="signature-title">Dibuat</div><div class="signature-space"></div><div class="signature-name">Nama: '+escFinal(String(r.staffName||'-'))+'</div></div><div class="signature-box"><div class="signature-title">Diketahui</div><div class="signature-space"></div><div class="signature-name">Nama: ____________________</div></div><div class="signature-box"><div class="signature-title">Disetujui</div><div class="signature-space"></div><div class="signature-name">Nama: ____________________</div></div></div>'+        '</section>');
    });
    return parts.join('');
  }

  function printSelectedRequestsFinal(){
    var ids=[];document.querySelectorAll('.frSelect:checked').forEach(function(c){ids.push(String(c.dataset.id));});
    if(!ids.length){showGlobalMessage('Pilih minimal satu pengajuan yang ingin dicetak.','warning');return;}
    var selected=ids.map(function(id){return state.requests.find(function(x){return x&&x.request&&String(x.request.requestId)===id;});}).filter(Boolean);
    var area=byIdFinal('frSelectedPrintArea');
    if(!area){showGlobalMessage('Area cetak tidak ditemukan.','error');return;}
    area.innerHTML=buildSelectedPrintHtmlFinal(selected);
    printHtmlFinal('frSelectedPrintArea','Pengajuan Barang Terpilih');
  }

  function bindFinalRequestButtons(){document.querySelectorAll('.frView').forEach(function(b){b.onclick=function(){var x=state.requests.find(function(z){return String(z.request.requestId)===String(b.dataset.id);});openRequestFinal(x);};});document.querySelectorAll('.frApprove').forEach(function(b){b.onclick=function(){var x=state.requests.find(function(z){return String(z.request.requestId)===String(b.dataset.id);});openApproveFinal(x);};});document.querySelectorAll('.frReject').forEach(function(b){b.onclick=function(){var x=state.requests.find(function(z){return String(z.request.requestId)===String(b.dataset.id);});openRejectFinal(x);};});document.querySelectorAll('.frEditRejected').forEach(function(b){b.onclick=function(){var x=state.requests.find(function(z){return String(z.request.requestId)===String(b.dataset.id);});openEditRejectedFinal(x);};});document.querySelectorAll('.frCancel').forEach(function(b){b.onclick=async function(){if(!confirm('Batalkan pengajuan ini?'))return;try{await apiFinal('cancelRequest',{requestId:b.dataset.id});showGlobalMessage('Pengajuan dibatalkan.','success');renderPage('listRequests');}catch(err){showGlobalMessage(friendlyFinal(err),'error');}};});}

  async function openEditRejectedFinal(x){
    if(!x)return;
    try{
      await refreshProductsFinal();
    }catch(err){
      showGlobalMessage('Daftar barang tidak dapat dimuat. Silakan coba lagi.','error');
      return;
    }
    var rows=(x.items||[]).map(function(i){return '<div class="form-grid fer-row"><div class="form-group"><label>Barang</label><select class="field fer-product" required>'+productOptions()+'</select></div>'+numberClassFinal('fer-qty','Qty',i.qtyRequested)+'<div class="form-group"><label>Catatan</label><input class="field fer-note" maxlength="300" value="'+escFinal(i.note||'')+'"></div><div class="form-group" style="display:flex;align-items:end"><button type="button" class="btn btn-danger fer-remove">Hapus</button></div></div>';}).join('');
    openModalFinal('Edit Pengajuan '+x.request.requestNo,'<form id="ferForm"><div class="info-strip"><strong>Status sebelumnya DITOLAK.</strong> Setelah disimpan, pengajuan akan kembali menjadi MENUNGGU untuk diproses Admin.</div><div class="form-grid">'+fieldDateFinal('ferDate','Tanggal')+'</div><div id="ferItems">'+rows+'</div><button type="button" class="btn btn-secondary" id="addFerItem">+ Barang</button><div id="modalMessage" class="form-message hidden"></div></form>','<button class="btn btn-secondary" data-close-modal>Batal</button><button class="btn btn-primary" type="submit" form="ferForm">Simpan & Ajukan Kembali</button>');
    byIdFinal('ferDate').value=String(x.request.requestDate||'').slice(0,10);
    document.querySelectorAll('.fer-row').forEach(function(r,i){
      if(x.items[i]){
        var select=r.querySelector('.fer-product');
        if(select)select.value=x.items[i].productId;
      }
      var remove=r.querySelector('.fer-remove');
      if(remove)remove.onclick=function(){r.remove();};
    });
    onFinal('addFerItem','click',function(){addRejectedEditRowFinal();});
    byIdFinal('ferForm').onsubmit=async function(e){e.preventDefault();var items=[];document.querySelectorAll('.fer-row').forEach(function(r){items.push({productId:r.querySelector('.fer-product').value,qtyRequested:r.querySelector('.fer-qty').value,note:r.querySelector('.fer-note').value});});var m=byIdFinal('modalMessage');if(!items.length){messageFinal(m,'Minimal satu barang harus dipilih.','error');return;}var b=document.querySelector('#modalFooter .btn-primary');setBtnFinal(b,true,'Menyimpan...');try{await apiFinal('editRejectedRequest',{requestId:x.request.requestId,requestDate:valFinal('ferDate'),items:items});closeModalFinal();showGlobalMessage('Pengajuan berhasil diperbaiki dan dikirim kembali untuk approval.','success');renderPage(String(state.activePage)==='printRequests'?'printRequests':'listRequests');}catch(err){messageFinal(m,friendlyFinal(err),'error');}finally{setBtnFinal(b,false,'Simpan & Ajukan Kembali');}};
  }
  function addRejectedEditRowFinal(){var c=byIdFinal('ferItems'),r=document.createElement('div');r.className='form-grid fer-row';r.innerHTML='<div class="form-group"><label>Barang</label><select class="field fer-product" required>'+productOptions()+'</select></div>'+numberClassFinal('fer-qty','Qty',1)+'<div class="form-group"><label>Catatan</label><input class="field fer-note" maxlength="300"></div><div class="form-group" style="display:flex;align-items:end"><button type="button" class="btn btn-danger fer-remove">Hapus</button></div>';c.appendChild(r);r.querySelector('.fer-remove').onclick=function(){r.remove();};}

  function openRequestFinal(x){if(!x)return;openModalFinal('Detail '+x.request.requestNo,'<div class="kpi-row"><div class="kpi">Status<strong>'+escFinal(x.request.status)+'</strong></div><div class="kpi">Tanggal / Jam<strong>'+escFinal(formatRequestDateTimeFinal(x.request.createdAt||x.request.requestDate))+'</strong></div><div class="kpi">Staff<strong>'+escFinal(x.request.staffName)+'</strong></div></div>'+(x.request.note?'<div class="info-strip"><strong>Catatan Umum:</strong> '+escFinal(x.request.note)+'</div>':'')+'<div class="table-wrap"><table class="data-table"><thead><tr><th>SKU</th><th>Barang</th><th>Request</th><th>Approve</th><th>Stok Request</th><th>Catatan Item</th></tr></thead><tbody>'+x.items.map(function(i){return '<tr><td>'+escFinal(i.sku)+'</td><td>'+escFinal(i.productName)+'</td><td>'+fmtFinal(i.qtyRequested)+'</td><td>'+fmtFinal(i.qtyApproved)+'</td><td>'+fmtFinal(i.stockAtRequest)+'</td><td>'+escFinal(i.note||'-')+'</td></tr>';}).join('')+'</tbody></table></div>'+(x.request.rejectionReason?'<div class="info-strip"><strong>Alasan Reject:</strong> '+escFinal(x.request.rejectionReason)+'</div>':'')+'','<button class="btn btn-secondary" data-close-modal>Tutup</button>');}

  function openApproveFinal(x){var body='<form id="faReqForm"><div class="table-wrap"><table class="data-table"><thead><tr><th>Barang</th><th>Request</th><th>Stok Saat Request</th><th>Qty Approved</th></tr></thead><tbody>'+x.items.map(function(i){return '<tr><td>'+escFinal(i.productName)+'<div class="muted-cell">'+escFinal(i.sku)+'</div></td><td>'+fmtFinal(i.qtyRequested)+'</td><td>'+fmtFinal(i.stockAtRequest)+'</td><td><input class="field final-approve-qty" data-id="'+escFinal(i.requestItemId)+'" type="number" min="0" max="'+i.qtyRequested+'" step="1" value="'+i.qtyRequested+'"></td></tr>';}).join('')+'</tbody></table></div><div id="modalMessage" class="form-message hidden"></div></form>';openModalFinal('Approve '+x.request.requestNo,body,'<button class="btn btn-secondary" data-close-modal>Batal</button><button class="btn btn-primary" type="submit" form="faReqForm">Approve</button>');byIdFinal('faReqForm').onsubmit=async function(e){e.preventDefault();var items=[];document.querySelectorAll('.final-approve-qty').forEach(function(i){items.push({requestItemId:i.dataset.id,qtyApproved:Number(i.value)});});var b=document.querySelector('#modalFooter .btn-primary'),m=byIdFinal('modalMessage');setBtnFinal(b,true,'Memproses...');try{await apiFinal('approveRequest',{requestId:x.request.requestId,items:items});closeModalFinal();showGlobalMessage('Pengajuan berhasil diproses.','success');renderPage('listRequests');}catch(err){messageFinal(m,friendlyFinal(err),'error');}finally{setBtnFinal(b,false,'Approve');}};}
  function openRejectFinal(x){openModalFinal('Reject '+x.request.requestNo,'<form id="frRejectForm"><div class="form-group"><label>Alasan Reject</label><textarea id="frRejectReason" class="field" maxlength="500" required></textarea></div><div id="modalMessage" class="form-message hidden"></div></form>','<button class="btn btn-secondary" data-close-modal>Batal</button><button class="btn btn-danger" type="submit" form="frRejectForm">Reject</button>');byIdFinal('frRejectForm').onsubmit=async function(e){e.preventDefault();var m=byIdFinal('modalMessage'),b=document.querySelector('#modalFooter .btn-danger');setBtnFinal(b,true,'Memproses...');try{await apiFinal('rejectRequest',{requestId:x.request.requestId,rejectionReason:valFinal('frRejectReason')});closeModalFinal();showGlobalMessage('Pengajuan ditolak.','success');renderPage('listRequests');}catch(err){messageFinal(m,friendlyFinal(err),'error');}finally{setBtnFinal(b,false,'Reject');}};}

  async function renderFinalCreateRequest(content){
    await ensureMasterCaches();
    var staffName=String(state.user&&state.user.name||'').trim();
    var department=String(state.user&&state.user.department||'').trim();
    var prefillItems=(state.staffRequestCart||[]).map(function(x){return {productId:String(x.productId||''),qtyRequested:Number(x.qtyRequested||1),note:String(x.note||'')};});
    content.innerHTML=pageHeaderBlock('Buat Pengajuan','Pengajuan tidak mengurangi stok sampai Admin melakukan approval.','')+
      '<div class="panel">'+
      '<div class="request-identity-grid"><div class="form-group"><label>Nama Staff</label><input class="field readonly-field" value="'+escFinal(staffName)+'" readonly title="Diisi otomatis dan tidak dapat diedit"></div><div class="form-group"><label>Departemen</label><input class="field readonly-field" value="'+escFinal(department||'General')+'" readonly title="Diisi otomatis dan tidak dapat diedit"></div></div>'+ 
      '<div class="request-items-head"><div>Tanggal</div><div>Barang</div><div>Qty</div><div>Catatan Item</div><div>Aksi</div></div><div id="finalReqItems" class="request-items-stack"></div><button class="btn btn-secondary" id="addFinalReqItem">+ Barang</button><form id="finalCreateReqForm" style="margin-top:16px"><div class="form-group request-general-note"><label>Catatan Umum <span class="field-hint">(akan tampil pada cetakan)</span></label><textarea id="fcrNote" class="field" maxlength="500" placeholder="Keterangan umum pengajuan, misalnya tujuan/kebutuhan barang."></textarea></div><div id="fcrMsg" class="form-message hidden"></div><button class="btn btn-primary" type="submit">Kirim Pengajuan</button></form></div>';
    if(prefillItems.length){prefillItems.forEach(function(x){addFinalReqRow(x);});}
    else addFinalReqRow();
    onFinal('addFinalReqItem','click',function(){addFinalReqRow();});
    onFinal('finalCreateReqForm','submit',async function(e){
      e.preventDefault();
      var rows=[];document.querySelectorAll('.fcr-row').forEach(function(r){rows.push({productId:r.querySelector('.fcr-product').value,qtyRequested:r.querySelector('.fcr-qty').value,note:r.querySelector('.fcr-note').value});});
      var m=byIdFinal('fcrMsg');
      if(!rows.length){messageFinal(m,'Minimal satu item wajib dipilih.','error');return;}
      var invalid=rows.some(function(x){return !x.productId;});
      if(invalid){messageFinal(m,'Semua baris harus memilih barang.','error');return;}
      var b=this.querySelector('button[type="submit"]');setBtnFinal(b,true,'Mengirim...');
      try{
        var result=await apiFinal('createRequest',{requestDate:valFinal('fcrDate'),note:valFinal('fcrNote'),items:rows});
        state.staffRequestCart=[];
        showGlobalMessage('Pengajuan '+(result.data&&result.data.request?result.data.request.requestNo:'')+' berhasil dibuat. Form siap untuk pengajuan berikutnya.','success');
        await renderPage('createRequest');
      }catch(err){messageFinal(m,friendlyFinal(err),'error');}
      finally{setBtnFinal(b,false,'Kirim Pengajuan');}
    });
  }

  function addFinalReqRow(prefill){
    var c=byIdFinal('finalReqItems'),r=document.createElement('div');
    r.className='request-item-grid fcr-row';
    var isFirst=!c.querySelector('.fcr-row');
    r.innerHTML=(isFirst?'<div class="form-group request-date-field"><input id="fcrDate" class="field" type="date" value="'+todayFinal()+'" required></div>':'<div class="request-date-spacer" aria-hidden="true"></div>')+
      '<div class="form-group"><select class="field fcr-product" required>'+productOptions()+'</select></div>'+numberClassFinal('fcr-qty','Qty',prefill?Number(prefill.qtyRequested||1):1)+
      '<div class="form-group"><input class="field fcr-note" maxlength="300" placeholder="Catatan untuk barang ini" value="'+(prefill?escFinal(prefill.note||''):'')+'"></div><div class="form-group request-remove-field"><button type="button" class="btn btn-danger btn-sm fcr-remove">Hapus</button></div>';
    c.appendChild(r);
    if(prefill){r.querySelector('.fcr-product').value=String(prefill.productId||'');}
    r.querySelector('.fcr-remove').onclick=function(){
      var savedDate=valFinal('fcrDate')||todayFinal();r.remove();var first=c.querySelector('.fcr-row');
      if(first&&!byIdFinal('fcrDate')){var cell=first.querySelector('.request-date-spacer');if(cell){cell.className='form-group request-date-field';cell.innerHTML='<input id="fcrDate" class="field" type="date" value="'+escFinal(savedDate)+'" required>';}}
      if(!first)addFinalReqRow();
    };
  }

  async function renderFinalReorder(content){var r=await apiFinal('reorderRecommendations',{});state.reorderFinal=r.data.items||[];content.innerHTML=pageHeaderBlock('Rekomendasi Order','Current Stock ≤ Min Stock. Recommended Qty mempertimbangkan outstanding DRAFT/ORDERED/PARTIAL.','<div class="report-actions"><button class="btn btn-secondary" id="frPrintReorder">Print / Cetak</button></div>')+'<div class="panel"><div id="reorderPrintArea"><div class="print-meta"><strong>Rekomendasi Order</strong><span>Dicetak: '+escFinal(new Date().toLocaleString('id-ID'))+'</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>SKU</th><th>Barang</th><th>Stok</th><th>Min</th><th>Max</th><th>Outstanding</th><th>Recommended</th><th>Harga</th><th class="no-print">Aksi</th></tr></thead><tbody>'+ (state.reorderFinal.length?state.reorderFinal.map(function(x){return '<tr><td><strong>'+escFinal(x.sku)+'</strong></td><td>'+escFinal(x.productName)+'</td><td>'+fmtFinal(x.currentStock)+'</td><td>'+fmtFinal(x.minStock)+'</td><td>'+fmtFinal(x.maxStock)+'</td><td>'+fmtFinal(x.outstandingOrder)+'</td><td><strong>'+fmtFinal(x.recommendedQty)+'</strong></td><td>'+moneyFinal(x.price)+'</td><td class="no-print"><button class="btn btn-primary btn-sm rfPO" data-id="'+escFinal(x.productId)+'">Buat PO</button></td></tr>';}).join(''):emptyRowFinal(9,'Tidak ada rekomendasi.'))+'</tbody></table></div></div></div>';onFinal('frPrintReorder','click',function(){printHtmlFinal('reorderPrintArea','Rekomendasi Order');});document.querySelectorAll('.rfPO').forEach(function(b){b.onclick=function(){var x=state.reorderFinal.find(function(z){return String(z.productId)===String(b.dataset.id);});openPOFinal(x);};});}

  async function renderFinalPO(content){var r=await apiFinal('listPurchaseOrders',{});state.finalPO=r.data.items||[];content.innerHTML=pageHeaderBlock('Purchase Order','Kelola PO dan penerimaan partial.','<button class="btn btn-primary" id="newFinalPO">+ Buat PO</button>')+'<div class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>No</th><th>Tanggal</th><th>Supplier</th><th>Status</th><th>Total</th><th>Items</th><th>Aksi</th></tr></thead><tbody>'+ (state.finalPO.length?state.finalPO.map(function(x){var p=x.purchaseOrder;return '<tr><td><strong>'+escFinal(p.poNo)+'</strong></td><td>'+escFinal(p.orderDate)+'</td><td>'+escFinal(p.supplierName)+'</td><td>'+statusFinal(p.status)+'</td><td>'+moneyFinal(p.totalAmount)+'</td><td>'+fmtFinal(x.items.length)+'</td><td><div class="action-group"><button class="btn btn-secondary btn-sm fpView" data-id="'+escFinal(p.poId)+'">Detail</button>'+(p.status!=='COMPLETED'&&p.status!=='CANCELLED'?'<button class="btn btn-primary btn-sm fpReceive" data-id="'+escFinal(p.poId)+'">Terima</button>':'')+(p.status==='DRAFT'?'<button class="btn btn-success btn-sm fpOrder" data-id="'+escFinal(p.poId)+'">Tandai Ordered</button>':'')+(['DRAFT','ORDERED','PARTIAL'].indexOf(p.status)>=0?'<button class="btn btn-danger btn-sm fpCancel" data-id="'+escFinal(p.poId)+'">Batalkan</button>':'')+'</div></td></tr>';}).join(''):emptyRowFinal(7,'Belum ada PO.'))+'</tbody></table></div></div>';onFinal('newFinalPO','click',function(){openPOFinal();});document.querySelectorAll('.fpView').forEach(function(b){b.onclick=function(){openPOViewFinal(state.finalPO.find(function(x){return String(x.purchaseOrder.poId)===String(b.dataset.id);}));};});document.querySelectorAll('.fpReceive').forEach(function(b){b.onclick=function(){openPOReceiptFinal(state.finalPO.find(function(x){return String(x.purchaseOrder.poId)===String(b.dataset.id);}));};});document.querySelectorAll('.fpOrder').forEach(function(b){b.onclick=function(){changePOStatusFinal(b.dataset.id,'ORDERED');};});document.querySelectorAll('.fpCancel').forEach(function(b){b.onclick=function(){if(confirm('Batalkan PO ini? PO tidak akan dihitung lagi sebagai outstanding order.'))changePOStatusFinal(b.dataset.id,'CANCELLED');};});}

  function openPOFinal(prefill){
    var sup=activeSupplierOptions();
    openModalFinal('Buat Purchase Order','<form id="finalPOForm"><div class="form-grid"><div class="form-group"><label>Supplier</label><select id="fpoSupplier" class="field" required><option value="">Pilih</option>'+sup+'</select></div>'+fieldDateFinal('fpoDate','Tanggal Order')+'</div><div class="po-scan-toolbar"><button type="button" class="btn btn-secondary" id="fpoScanButton">▦ Scan Barcode Barang</button><button type="button" class="btn btn-ghost" id="fpoStartScanner">Mulai Kamera</button><button type="button" class="btn btn-ghost" id="fpoStopScanner">Stop</button></div><div id="fpoScannerPanel" class="inline-scanner hidden"><div id="fpoScannerArea" class="scanner-stage compact"></div><div id="fpoScannerMsg" class="form-message hidden"></div></div><div id="fpoItems"></div><button type="button" class="btn btn-secondary" id="addFPOItem">+ Item</button><div id="modalMessage" class="form-message hidden"></div></form>','<button class="btn btn-secondary" data-close-modal>Batal</button><button class="btn btn-primary" type="submit" form="finalPOForm">Buat PO</button>');
    if(prefill){byIdFinal('fpoSupplier').value=prefill.supplierId||'';addFPOItem(prefill);}else addFPOItem();
    onFinal('addFPOItem','click',function(){addFPOItem();});onFinal('fpoScanButton','click',function(){var p=byIdFinal('fpoScannerPanel');if(p)p.classList.remove('hidden');startPOScanner();});onFinal('fpoStartScanner','click',function(){var p=byIdFinal('fpoScannerPanel');if(p)p.classList.remove('hidden');startPOScanner();});onFinal('fpoStopScanner','click',stopPOScanner);setScannerUiStateFinal('fpoStartScanner','fpoStopScanner','fpoScannerMsg',false,'Kamera nonaktif.');
    byIdFinal('finalPOForm').onsubmit=async function(e){e.preventDefault();var its=[];document.querySelectorAll('.fpo-row').forEach(function(r){its.push({productId:r.querySelector('.fpo-product').value,qtyOrdered:r.querySelector('.fpo-qty').value,price:r.querySelector('.fpo-price').value});});var m=byIdFinal('modalMessage'),b=document.querySelector('#modalFooter .btn-primary');setBtnFinal(b,true,'Menyimpan...');try{await apiFinal('createPurchaseOrder',{supplierId:valFinal('fpoSupplier'),orderDate:valFinal('fpoDate'),items:its});closeModalFinal();showGlobalMessage('PO berhasil dibuat.','success');renderPage('listPurchaseOrders');}catch(err){messageFinal(m,friendlyFinal(err),'error');}finally{setBtnFinal(b,false,'Buat PO');}};
  }
  function addFPOItem(prefill){var c=byIdFinal('fpoItems'),r=document.createElement('div');r.className='form-grid fpo-row';r.innerHTML='<div class="form-group"><label>Barang</label><select class="field fpo-product" required>'+productOptions()+'</select></div>'+numberClassFinal('fpo-qty','Qty',prefill?prefill.recommendedQty:1)+numberClassFinal('fpo-price','Harga',prefill?prefill.price:0)+'<div class="form-group" style="display:flex;align-items:end"><button type="button" class="btn btn-danger fpo-remove">Hapus</button></div>';c.appendChild(r);if(prefill)r.querySelector('.fpo-product').value=prefill.productId;r.querySelector('.fpo-remove').onclick=function(){r.remove();};}
  async function startPOScanner(){
    try{await ensureScannerLibraryFinal();}catch(loadErr){messageFinal(byIdFinal('fpoScannerMsg'),'Scanner tidak tersedia. Gunakan pilihan barang manual.','warning');return;}
    if(state.poScanner)return;
    var msg=byIdFinal('fpoScannerMsg');
    try{
      state.poScanner=await createAndStartScannerFinal('fpoScannerArea',async function(txt){
        var code=String(txt||'').trim();if(!code)return;
        await stopPOScanner();await lookupPOBarcode(code);
      },function(){},{width:280,height:120});
      setScannerUiStateFinal('fpoStartScanner', 'fpoStopScanner', 'fpoScannerMsg', true, 'Kamera aktif. Arahkan ke barcode barang.');
    }catch(err){state.poScanner=null;messageFinal(msg,friendlyCameraErrorFinal(err),'error');setScannerUiStateFinal('fpoStartScanner','fpoStopScanner','fpoScannerMsg',false,null);}
  }

  async function stopPOScanner(){if(state.poScanner){try{await state.poScanner.stop();}catch(err){}try{state.poScanner.clear();}catch(err2){}state.poScanner=null;}setScannerUiStateFinal('fpoStartScanner','fpoStopScanner','fpoScannerMsg',false,'Kamera nonaktif.');}
  async function lookupPOBarcode(code){var clean=String(code||'').trim();if(!clean)return;try{var r=await apiFinal('searchProducts',{barcode:clean});var p=(r.data.items||[])[0];if(!p){messageFinal(byIdFinal('fpoScannerMsg'),'Barcode '+clean+' belum terdaftar di Master Barang. Tambahkan terlebih dahulu dari Master Barang.','warning');return;}var existing=null;document.querySelectorAll('.fpo-row').forEach(function(row){var select=row.querySelector('.fpo-product');if(select&&String(select.value)===String(p.productId))existing=row;});if(existing){var qty=existing.querySelector('.fpo-qty');qty.value=Number(qty.value||0)+1;}else{addFPOItem({productId:p.productId,recommendedQty:1,price:p.price||0,supplierId:p.supplierId||''});}var supplier=byIdFinal('fpoSupplier');if(supplier&&!supplier.value&&p.supplierId)supplier.value=String(p.supplierId);messageFinal(byIdFinal('fpoScannerMsg'),'Barang ditemukan: '+p.sku+' — '+p.name+'. '+(existing?'Qty ditambah 1.':'Item ditambahkan ke PO.'),'success');}catch(err){messageFinal(byIdFinal('fpoScannerMsg'),friendlyFinal(err),'error');}}

  function openPOViewFinal(x){if(!x)return;openModalFinal('Detail '+x.purchaseOrder.poNo,'<div class="kpi-row"><div class="kpi">Supplier<strong>'+escFinal(x.purchaseOrder.supplierName)+'</strong></div><div class="kpi">Status<strong>'+escFinal(x.purchaseOrder.status)+'</strong></div><div class="kpi">Total<strong>'+moneyFinal(x.purchaseOrder.totalAmount)+'</strong></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Barang</th><th>Order</th><th>Received</th><th>Remaining</th><th>Price</th></tr></thead><tbody>'+x.items.map(function(i){return '<tr><td>'+escFinal(i.productName)+'<div class="muted-cell">'+escFinal(i.sku)+'</div></td><td>'+fmtFinal(i.qtyOrdered)+'</td><td>'+fmtFinal(i.qtyReceived)+'</td><td>'+fmtFinal(i.qtyRemaining)+'</td><td>'+moneyFinal(i.price)+'</td></tr>';}).join('')+'</tbody></table></div>','<button class="btn btn-secondary" data-close-modal>Tutup</button>');}

  async function changePOStatusFinal(poId,status){
    try{await apiFinal('updatePurchaseOrderStatus',{poId:poId,status:status});showGlobalMessage(status==='ORDERED'?'PO ditandai ORDERED.':'PO dibatalkan.','success');renderPage('listPurchaseOrders');}catch(err){showGlobalMessage(friendlyFinal(err),'error');}
  }

  async function renderFinalPOReceipt(content){var r=await apiFinal('listPurchaseOrders',{}),rows=(r.data.items||[]).filter(function(x){return ['DRAFT','ORDERED','PARTIAL'].indexOf(x.purchaseOrder.status)>=0;});content.innerHTML=pageHeaderBlock('Penerimaan PO','Terima sebagian atau seluruh qty remaining.','')+'<div class="panel">'+(rows.length?rows.map(function(x){return '<div class="status-list-row" style="margin-bottom:8px"><span><strong>'+escFinal(x.purchaseOrder.poNo)+'</strong> · '+escFinal(x.purchaseOrder.supplierName)+' · '+escFinal(x.purchaseOrder.status)+'</span><button class="btn btn-primary btn-sm fpr" data-id="'+escFinal(x.purchaseOrder.poId)+'">Terima</button></div>';}).join(''):'<div class="empty-cell">Tidak ada PO menunggu penerimaan.</div>')+'</div>';document.querySelectorAll('.fpr').forEach(function(b){b.onclick=function(){openPOReceiptFinal(rows.find(function(x){return String(x.purchaseOrder.poId)===String(b.dataset.id);}));};});}
  function openPOReceiptFinal(x){if(!x)return;var items=x.items.filter(function(i){return i.qtyRemaining>0;});openModalFinal('Penerimaan '+x.purchaseOrder.poNo,'<form id="fprForm">'+fieldDateFinal('fprDate','Tanggal')+fieldFinal('fprDoc','Nomor Dokumen','',100,false)+'<div class="table-wrap"><table class="data-table"><thead><tr><th>Barang</th><th>Remaining</th><th>Terima</th></tr></thead><tbody>'+items.map(function(i){return '<tr><td>'+escFinal(i.productName)+'<div class="muted-cell">'+escFinal(i.sku)+'</div></td><td>'+fmtFinal(i.qtyRemaining)+'</td><td><input class="field final-pr-qty" data-id="'+escFinal(i.poItemId)+'" type="number" min="0" max="'+i.qtyRemaining+'" value="0"></td></tr>';}).join('')+'</tbody></table></div><div id="modalMessage" class="form-message hidden"></div></form>','<button class="btn btn-secondary" data-close-modal>Batal</button><button class="btn btn-primary" type="submit" form="fprForm">Simpan Penerimaan</button>');byIdFinal('fprForm').onsubmit=async function(e){e.preventDefault();var its=[];document.querySelectorAll('.final-pr-qty').forEach(function(i){if(Number(i.value)>0)its.push({poItemId:i.dataset.id,qtyReceived:Number(i.value)});});var m=byIdFinal('modalMessage'),b=document.querySelector('#modalFooter .btn-primary');setBtnFinal(b,true,'Memproses...');try{await apiFinal('receivePurchaseOrder',{poId:x.purchaseOrder.poId,receiptDate:valFinal('fprDate'),documentNo:valFinal('fprDoc'),items:its});closeModalFinal();showGlobalMessage('Penerimaan PO berhasil.','success');renderPage('receivePurchaseOrder');}catch(err){messageFinal(m,friendlyFinal(err),'error');}finally{setBtnFinal(b,false,'Simpan Penerimaan');}};}

  async function renderFinalReports(content){
    state.finalReportType='stock';
    await loadFinalReport('stock');
    content.innerHTML=pageHeaderBlock('Laporan','Stok adalah kondisi saat ini. Filter tanggal digunakan untuk laporan transaksi.','<div class="report-actions"><button class="btn btn-secondary" id="rpPrint">Print</button><button class="btn btn-secondary" id="rpExport">Export Excel</button></div>')+
      '<div class="panel"><div class="form-grid no-print"><div class="form-group"><label>Dari Tanggal</label><input id="rpFrom" class="field" type="date"></div><div class="form-group"><label>Sampai Tanggal</label><input id="rpTo" class="field" type="date"></div></div>'+
      '<div class="report-actions no-print" style="margin-bottom:14px"><button class="btn btn-primary" id="rpApply">Terapkan Filter</button><button class="btn btn-secondary" id="rpReset">Reset</button></div>'+
      '<div class="report-actions no-print"><button class="btn btn-primary report-tab active" data-type="stock">Stok</button><button class="btn btn-secondary report-tab" data-type="requests">Pengajuan</button><button class="btn btn-secondary report-tab" data-type="po">PO</button><button class="btn btn-secondary report-tab" data-type="receipts">Penerimaan</button><button class="btn btn-secondary report-tab" data-type="movements">Mutasi</button></div>'+
      '<div id="reportFinalArea" style="margin-top:14px">'+reportFinalHtml(state.finalReport)+'</div></div>';
    document.querySelectorAll('.report-tab').forEach(function(b){b.onclick=async function(){await loadFinalReport(b.dataset.type);updateReportTabFinal(b.dataset.type);};});
    onFinal('rpApply','click',async function(){await loadFinalReport(state.finalReportType);});
    onFinal('rpReset','click',async function(){setValueFinal('rpFrom','');setValueFinal('rpTo','');await loadFinalReport(state.finalReportType);});
    onFinal('rpPrint','click',function(){printHtmlFinal('reportFinalArea','Laporan '+String(state.finalReportType||'').toUpperCase());});
    onFinal('rpExport','click',function(){exportReportFinal(state.finalReport);});
  }

  async function loadFinalReport(type){
    state.finalReportType=String(type||'stock');
    var data={reportType:state.finalReportType};
    if(state.finalReportType!=='stock'){
      data.dateFrom=valFinal('rpFrom');data.dateTo=valFinal('rpTo');
      if(data.dateFrom&&data.dateTo&&data.dateFrom>data.dateTo){showGlobalMessage('Rentang tanggal tidak valid.','error');return;}
    }
    var r=await apiFinal('stockReport',data);state.finalReport=r.data;
    if(byIdFinal('reportFinalArea'))setHTMLFinal('reportFinalArea',reportFinalHtml(r.data));
  }

  function reportFinalHtml(d){
    if(!d)return '<div class="empty-cell">Tidak ada data laporan.</div>';
    var type=String(d.reportType||'stock').toLowerCase(),items=d.items||[];
    if(type==='stock'){
      var stockRows=items.map(function(x){return '<tr><td><strong>'+escFinal(x.sku)+'</strong></td><td>'+escFinal(x.name)+'</td><td>'+escFinal(x.category)+'</td><td>'+fmtFinal(x.minStock)+'</td><td>'+fmtFinal(x.maxStock)+'</td><td>'+fmtFinal(x.currentStock)+'</td><td>'+escFinal(x.unit)+'</td><td>'+moneyFinal(x.price)+'</td><td>'+moneyFinal(x.subtotal)+'</td><td>'+escFinal(x.supplier||'-')+'</td><td>'+escFinal(x.location||'-')+'</td></tr>';}).join('');
      return '<div class="report-heading"><div><strong>Laporan Stok Saat Ini</strong><span>Nilai persediaan: '+moneyFinal(d.totalInventoryValue||0)+'</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>SKU</th><th>Barang</th><th>Kategori</th><th>Min</th><th>Max</th><th>Stok</th><th>Satuan</th><th>Harga</th><th>Nilai</th><th>Supplier</th><th>Lokasi</th></tr></thead><tbody>'+ (stockRows||emptyRowFinal(11,'Tidak ada data stok.')) +'</tbody></table></div>';
    }
    if(type==='requests'){
      return '<div class="report-heading"><div><strong>Laporan Pengajuan</strong><span>Periode: '+escFinal(valFinal('rpFrom')||'-')+' s/d '+escFinal(valFinal('rpTo')||'-')+'</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>No Pengajuan</th><th>Tanggal</th><th>Staff</th><th>Departemen</th><th>Items</th><th>Status</th><th>Alasan Reject</th></tr></thead><tbody>'+ (items.length?items.map(function(x){var q=x.request;return '<tr><td>'+escFinal(q.requestNo)+'</td><td>'+escFinal(q.requestDate)+'</td><td>'+escFinal(q.staffName)+'</td><td>'+escFinal(q.department||'-')+'</td><td>'+fmtFinal(x.items.length)+'</td><td>'+statusFinal(q.status)+'</td><td>'+escFinal(q.rejectionReason||'-')+'</td></tr>';}).join(''):emptyRowFinal(7,'Tidak ada pengajuan.')) +'</tbody></table></div>';
    }
    if(type==='po'){
      return '<div class="report-heading"><div><strong>Laporan Purchase Order</strong><span>Periode: '+escFinal(valFinal('rpFrom')||'-')+' s/d '+escFinal(valFinal('rpTo')||'-')+'</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>No PO</th><th>Tanggal</th><th>Supplier</th><th>Status</th><th>Total</th><th>Items</th></tr></thead><tbody>'+ (items.length?items.map(function(x){var p=x.purchaseOrder;return '<tr><td>'+escFinal(p.poNo)+'</td><td>'+escFinal(p.orderDate)+'</td><td>'+escFinal(p.supplierName)+'</td><td>'+statusFinal(p.status)+'</td><td>'+moneyFinal(p.totalAmount)+'</td><td>'+fmtFinal(x.items.length)+'</td></tr>';}).join(''):emptyRowFinal(6,'Tidak ada PO.')) +'</tbody></table></div>';
    }
    if(type==='receipts'){
      return '<div class="report-heading"><div><strong>Laporan Penerimaan</strong><span>Periode: '+escFinal(valFinal('rpFrom')||'-')+' s/d '+escFinal(valFinal('rpTo')||'-')+'</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Jenis</th><th>No Penerimaan</th><th>Tanggal</th><th>No Dokumen</th><th>Dibuat Oleh</th></tr></thead><tbody>'+ (items.length?items.map(function(x){return '<tr><td>'+escFinal(x.type)+'</td><td>'+escFinal(x.receiptNo)+'</td><td>'+escFinal(x.receiptDate)+'</td><td>'+escFinal(x.documentNo||'-')+'</td><td>'+escFinal(x.createdBy||'-')+'</td></tr>';}).join(''):emptyRowFinal(5,'Tidak ada penerimaan.')) +'</tbody></table></div>';
    }
    if(type==='movements'){
      return '<div class="report-heading"><div><strong>Laporan Mutasi</strong><span>Periode: '+escFinal(valFinal('rpFrom')||'-')+' s/d '+escFinal(valFinal('rpTo')||'-')+'</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>SKU</th><th>Barang</th><th>Jenis</th><th>Qty</th><th>Sebelum</th><th>Sesudah</th><th>User</th><th>Catatan</th></tr></thead><tbody>'+ (items.length?items.map(function(x){return '<tr><td>'+escFinal(x.movementDate)+'</td><td>'+escFinal(x.sku)+'</td><td>'+escFinal(x.productName)+'</td><td>'+escFinal(x.type)+'</td><td>'+fmtFinal(x.qty)+'</td><td>'+fmtFinal(x.stockBefore)+'</td><td>'+fmtFinal(x.stockAfter)+'</td><td>'+escFinal(x.userName)+'</td><td>'+escFinal(x.note||'-')+'</td></tr>';}).join(''):emptyRowFinal(9,'Tidak ada mutasi.')) +'</tbody></table></div>';
    }
    return '<div class="empty-cell">Jenis laporan tidak dikenali.</div>';
  }

  function updateReportTabFinal(type){document.querySelectorAll('.report-tab').forEach(function(b){var active=b.dataset.type===String(type);b.classList.toggle('active',active);b.classList.toggle('btn-primary',active);b.classList.toggle('btn-secondary',!active);});}
  function setValueFinal(id,value){var e=byIdFinal(id);if(e)e.value=value;}

  async function renderFinalImport(content){
    await ensureMasterCaches();
    await refreshProductsFinal();
    try { await ensureExcelLibraryFinal(); } catch (loadErr) { showGlobalMessage('Library Excel tidak tersedia. Import/Template tidak dapat digunakan.','warning'); }
    content.innerHTML=pageHeaderBlock('Import Excel','Preview dan validasi baris sebelum commit. Header: SKU, Barcode, Nama Barang, Kategori, Satuan, Min, Max, Harga, Supplier, Lokasi.','<button class="btn btn-secondary" id="fiTemplate">Template</button>')+
      '<div class="panel"><input id="fiFile" class="field" type="file" accept=".xlsx,.xls,.csv"><div id="fiPreview" style="margin-top:14px"></div><div class="report-actions no-print" style="margin-top:14px"><button class="btn btn-primary" id="fiCommit" disabled>Commit Import</button></div><div id="fiMsg" class="form-message hidden"></div></div>';
    state.pendingImport=[];state.pendingImportErrors=[];
    onFinal('fiTemplate','click',function(){exportExcelFinal('Template-Import-ATK',[{'SKU':'ATK-001','Barcode':'899000000001','Nama Barang':'Pulpen','Kategori':state.categories[0]?state.categories[0].categoryName:'Alat Tulis','Satuan':'pcs','Min':5,'Max':20,'Harga':3000,'Supplier':state.suppliers[0]?state.suppliers[0].code:'SUP-01','Lokasi':'Gudang ATK'}]);});
    onFinal('fiFile','change',async function(){
      var file=this.files&&this.files[0];if(!file)return;
      var commit=byIdFinal('fiCommit');commit.disabled=true;setHTMLFinal('fiPreview','');
      try{
        await ensureExcelLibraryFinal();
        var wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{defval:''}),headerRows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}),headers=(headerRows[0]||[]).map(function(x){return String(x).trim();}),required=['SKU','Barcode','Nama Barang','Kategori','Satuan','Min','Max','Harga','Supplier','Lokasi'];
        var missing=required.filter(function(h){return headers.indexOf(h)<0;});
        if(missing.length){state.pendingImport=[];state.pendingImportErrors=[{row:1,message:'Header kurang: '+missing.join(', ')}];setHTMLFinal('fiPreview',importValidationHtmlFinal(rows,state.pendingImportErrors));messageFinal(byIdFinal('fiMsg'),'Header file tidak sesuai template.','error');return;}
        var validation=validateImportRowsFinal(rows);state.pendingImport=rows;state.pendingImportErrors=validation.errors;setHTMLFinal('fiPreview',importValidationHtmlFinal(rows,validation.errors));
        if(validation.errors.length){messageFinal(byIdFinal('fiMsg'),'Perbaiki semua error pada preview sebelum commit.','error');commit.disabled=true;}
        else{messageFinal(byIdFinal('fiMsg'),'Semua baris lolos validasi awal. Anda bisa commit.','success');commit.disabled=!rows.length;}
      }catch(err){state.pendingImport=[];state.pendingImportErrors=[];commit.disabled=true;messageFinal(byIdFinal('fiMsg'),'File tidak dapat dibaca: '+err.message,'error');}
    });
    onFinal('fiCommit','click',async function(){var b=this;setBtnFinal(b,true,'Mengimpor...');try{var r=await apiFinal('bulkUpsertProducts',{rows:state.pendingImport||[]});setHTMLFinal('fiPreview',importResultFinal(r.data));messageFinal(byIdFinal('fiMsg'),r.data.errors&&r.data.errors.length?'Import selesai dengan baris yang ditolak.':'Import selesai tanpa error.','success');b.disabled=true;}catch(err){messageFinal(byIdFinal('fiMsg'),friendlyFinal(err),'error');b.disabled=false;}finally{if(!b.disabled)setBtnFinal(b,false,'Commit Import');}});
  }

  function importCellFinal(row,key){if(row[key]!==undefined&&row[key]!==null)return row[key];var aliases={'Nama Barang':['name','Name'],'Kategori':['category','categoryName'],'Satuan':['unit'],'Min':['min','minStock'],'Max':['max','maxStock'],'Harga':['price','Price'],'Supplier':['supplier','supplierName','supplierCode'],'Lokasi':['location']};var a=aliases[key]||[];for(var i=0;i<a.length;i++){if(row[a[i]]!==undefined&&row[a[i]]!==null)return row[a[i]];}return '';}
  function validateImportRowsFinal(rows){
    var errors=[],seenSku={},seenBarcode={},products=state.products||[],bySku={},byBarcode={};
    products.forEach(function(p){if(p.sku)bySku[String(p.sku).toLowerCase()]=p;if(p.barcode)byBarcode[String(p.barcode).toLowerCase()]=p;});
    (rows||[]).forEach(function(r,index){var rowNo=index+2,sku=String(importCellFinal(r,'SKU')||'').trim().toUpperCase(),barcode=String(importCellFinal(r,'Barcode')||'').trim(),name=String(importCellFinal(r,'Nama Barang')||'').trim(),cat=String(importCellFinal(r,'Kategori')||'').trim().toLowerCase(),unit=String(importCellFinal(r,'Satuan')||'').trim(),min=Number(importCellFinal(r,'Min')),max=Number(importCellFinal(r,'Max')),price=Number(importCellFinal(r,'Harga')),supplier=String(importCellFinal(r,'Supplier')||'').trim().toLowerCase(),loc=String(importCellFinal(r,'Lokasi')||'').trim();
      function err(m){errors.push({row:rowNo,message:m});}
      if(!sku||!barcode||!name||!unit||!isFinite(min)||min<0||!isFinite(max)||max<=min||!isFinite(price)||price<0||!loc)err('Data wajib, Min/Max, atau Harga tidak valid.');
      if(seenSku[sku.toLowerCase()])err('SKU duplicate di file.');seenSku[sku.toLowerCase()]=1;
      if(seenBarcode[barcode.toLowerCase()])err('Barcode duplicate di file.');seenBarcode[barcode.toLowerCase()]=1;
      var existingSku=bySku[sku.toLowerCase()]||null,existingBarcode=byBarcode[barcode.toLowerCase()]||null;if(existingSku&&existingBarcode&&String(existingSku.productId)!==String(existingBarcode.productId))err('SKU dan Barcode cocok dengan dua barang yang berbeda.');
      var c=(state.categories||[]).find(function(x){return String(x.categoryName||'').trim().toLowerCase()===cat;});if(!c||!c.active)err('Kategori tidak ditemukan atau tidak aktif.');
      var s=(state.suppliers||[]).find(function(x){return String(x.name||'').trim().toLowerCase()===supplier||String(x.code||'').trim().toLowerCase()===supplier;});if(!s||!s.active)err('Supplier tidak ditemukan atau tidak aktif.');
    });
    return {errors:errors};
  }
  function importValidationHtmlFinal(rows,errors){var keys=['SKU','Barcode','Nama Barang','Kategori','Satuan','Min','Max','Harga','Supplier','Lokasi'];var out='<div class="kpi-row"><div class="kpi">Baris<strong>'+fmtFinal((rows||[]).length)+'</strong></div><div class="kpi">Error<strong>'+fmtFinal((errors||[]).length)+'</strong></div></div>';if(errors&&errors.length){out+='<div class="table-wrap"><table class="data-table"><thead><tr><th>Baris</th><th>Masalah</th></tr></thead><tbody>'+errors.slice(0,100).map(function(e){return '<tr><td>'+fmtFinal(e.row)+'</td><td>'+escFinal(e.message)+'</td></tr>';}).join('')+'</tbody></table></div>';}out+='<div style="margin-top:12px">'+importPreviewFinal(rows)+'</div>';return out;}

  async function renderFinalExport(content){try{await ensureExcelLibraryFinal();}catch(loadErr){showGlobalMessage('Library Excel tidak tersedia.','warning');return;}content.innerHTML=headingFinal('Export Excel','Export dataset .xlsx dari browser.','')+'<div class="panel"><div class="report-actions">'+['products','movements','requests','po','receipts','stock'].map(function(x){return '<button class="btn btn-secondary final-export" data-type="'+x+'">'+x.toUpperCase()+'</button>';}).join('')+'</div></div>';document.querySelectorAll('.final-export').forEach(function(b){b.onclick=async function(){try{var type=b.dataset.type,rows=[];if(type==='products'){var p=await apiFinal('listProducts',{includeInactive:true});rows=p.data.items||[];}else{var r=await apiFinal('stockReport',{reportType:type==='products'?'stock':type});if(type==='requests')rows=(r.data.items||[]).map(function(x){return {requestNo:x.request.requestNo,requestDate:x.request.requestDate,staffName:x.request.staffName,status:x.request.status,items:x.items.length,rejectionReason:x.request.rejectionReason};});else if(type==='po')rows=(r.data.items||[]).map(function(x){return {poNo:x.purchaseOrder.poNo,orderDate:x.purchaseOrder.orderDate,supplier:x.purchaseOrder.supplierName,status:x.purchaseOrder.status,total:x.purchaseOrder.totalAmount,items:x.items.length};});else rows=r.data.items||[];}exportExcelFinal('ATK-Inventory-'+type,rows);}catch(err){showGlobalMessage(friendlyFinal(err),'error');}};});}

  async function renderFinalScanner(content){
    var isStaff=String(state.user&&state.user.role||'').toUpperCase()==='STAFF';
    content.innerHTML=headingFinal('Barcode Scanner','Scan barcode barang untuk melihat informasi dan membuat pengajuan dengan cepat.','')+
      '<div class="panel scanner-box"><div id="finalScannerArea" class="scanner-stage"></div><div class="report-actions"><button class="btn btn-primary" id="startFinalScanner">Mulai Kamera</button><button class="btn btn-secondary" id="stopFinalScanner">Stop Kamera</button></div>'+
      fieldFinal('manualFinalBarcode','Barcode Manual','',100,false)+'<button class="btn btn-secondary" id="manualFinalSearch">Cari</button><div id="scannerFinalMsg" class="form-message hidden"></div><div id="scannerFinalResult" class="scan-result" style="margin-top:12px">Belum ada hasil.</div><div id="scannerFinalProduct"></div>'+
      (isStaff?'<div id="staffScanCartPanel" class="scan-cart-panel" style="margin-top:14px"></div>':'')+'</div>';
    await stopFinalScanner();await stopProductScanner();renderStaffScanCartFinal();
    onFinal('startFinalScanner','click',startFinalScanner);onFinal('stopFinalScanner','click',stopFinalScanner);onFinal('manualFinalSearch','click',function(){lookupFinalBarcode(valFinal('manualFinalBarcode'));});setScannerUiStateFinal('startFinalScanner','stopFinalScanner','scannerFinalMsg',false,'Kamera nonaktif.');
  }

  function renderStaffScanCartFinal(){
    var isStaff=String(state.user&&state.user.role||'').toUpperCase()==='STAFF';
    var box=byIdFinal('staffScanCartPanel');
    if(!isStaff||!box)return;
    var cart=state.staffRequestCart||[];
    if(!cart.length){box.innerHTML='<div class="info-strip">Belum ada barang dalam pengajuan sementara.</div>';return;}
    var total=cart.reduce(function(n,x){return n+Number(x.qtyRequested||0);},0);
    box.innerHTML='<div class="panel-header"><h4 class="panel-title">Pengajuan Sementara</h4><span class="badge info">'+fmtFinal(cart.length)+' barang / '+fmtFinal(total)+' qty</span></div>'+
      '<div class="scan-cart-list">'+cart.map(function(x){return '<div class="scan-cart-row"><div><strong>'+escFinal(x.productName)+'</strong><div class="muted-cell">'+escFinal(x.sku)+' · Qty '+fmtFinal(x.qtyRequested)+'</div></div><button type="button" class="btn btn-secondary btn-sm scRemoveCart" data-id="'+escFinal(x.productId)+'">Hapus</button></div>';}).join('')+'</div>'+
      '<div class="report-actions" style="margin-top:10px"><button type="button" class="btn btn-primary" id="staffCartContinue">Lanjut ke Pengajuan</button><button type="button" class="btn btn-secondary" id="staffCartClear">Kosongkan</button></div>';
    document.querySelectorAll('.scRemoveCart').forEach(function(b){b.onclick=function(){state.staffRequestCart=(state.staffRequestCart||[]).filter(function(x){return String(x.productId)!==String(b.dataset.id);});renderStaffScanCartFinal();};});
    onFinal('staffCartContinue','click',function(){state.activePage='createRequest';renderPage('createRequest');});
    onFinal('staffCartClear','click',function(){state.staffRequestCart=[];renderStaffScanCartFinal();});
  }

  function addScannedProductToStaffCartFinal(p){
    var id=String(p&&p.productId||'').trim();if(!id)return '';
    var cart=state.staffRequestCart||[];var existing=cart.find(function(x){return String(x.productId)===id;});
    if(existing){existing.qtyRequested=Number(existing.qtyRequested||0)+1;}
    else{cart.push({productId:id,sku:String(p.sku||''),productName:String(p.name||''),qtyRequested:1,note:''});}
    state.staffRequestCart=cart;return existing?'incremented':'added';
  }

  async function startFinalScanner(){
    try{await ensureScannerLibraryFinal();}catch(loadErr){showGlobalMessage('Scanner tidak tersedia. Gunakan input manual.','warning');return;}
    if(state.finalScanner)return;
    var msg=byIdFinal('scannerFinalMsg');
    try{
      state.finalScanner=await createAndStartScannerFinal('finalScannerArea',function(txt){setTextFinal('scannerFinalResult',txt);lookupFinalBarcode(txt);stopFinalScanner();},function(){},{width:260,height:120});
      setScannerUiStateFinal('startFinalScanner', 'stopFinalScanner', 'scannerFinalMsg', true, 'Kamera aktif. Arahkan ke barcode barang.');
    }catch(err){state.finalScanner=null;messageFinal(msg,friendlyCameraErrorFinal(err),'error');setScannerUiStateFinal('startFinalScanner','stopFinalScanner','scannerFinalMsg',false,null);}
  }

  async function stopFinalScanner(){if(state.finalScanner){try{await state.finalScanner.stop();}catch(err){}try{state.finalScanner.clear();}catch(err2){}state.finalScanner=null;}setScannerUiStateFinal('startFinalScanner','stopFinalScanner','scannerFinalMsg',false,'Kamera nonaktif.');}
  async function lookupFinalBarcode(code){var clean=String(code||'').trim();if(!clean){messageFinal(byIdFinal('scannerFinalMsg'),'Barcode belum diisi.','warning');return;}setTextFinal('scannerFinalResult',clean);try{var r=await apiFinal('searchProducts',{barcode:clean});var p=(r.data.items||[])[0];if(p){var isAdmin=String(state.user&&state.user.role||'').toUpperCase()==='ADMIN';var isStaff=String(state.user&&state.user.role||'').toUpperCase()==='STAFF';
var editAction=isAdmin?'<button type="button" class="btn btn-primary" id="scannerEditProduct">Edit Barang</button>':'';
var staffAction=isStaff?'<button type="button" class="btn btn-primary" id="scannerRequestNow">Ajukan Barang Ini</button><button type="button" class="btn btn-secondary" id="scannerAddToRequest">Tambah ke Pengajuan</button>':'';
setHTMLFinal('scannerFinalProduct','<div class="panel scanner-product-card" style="margin-top:12px"><div class="panel-header"><h4 class="panel-title">Barang ditemukan</h4><span class="badge success">Terdaftar</span></div><strong>'+escFinal(p.name)+'</strong><p class="panel-copy">SKU: '+escFinal(p.sku)+' · Barcode: '+escFinal(p.barcode)+' · Stok: '+fmtFinal(p.currentStock)+' '+escFinal(p.unit||'unit')+' · Lokasi: '+escFinal(p.location||'BELUM TAHU')+'</p>'+(isStaff&&Number(p.currentStock||0)<=0?'<div class="info-strip">Stok saat ini 0. Pengajuan tetap dapat dibuat dan akan diproses Admin sesuai ketersediaan stok.</div>':'')+'<div class="report-actions" style="margin-top:12px">'+editAction+staffAction+'<button type="button" class="btn btn-secondary" id="scannerScanAgain">Scan Lagi</button></div></div>');
if(isAdmin){onFinal('scannerEditProduct','click',async function(){try{await ensureMasterCaches();openProductModal(p);}catch(err){showGlobalMessage(friendlyFinal(err),'error');}});}
if(isStaff){
  onFinal('scannerRequestNow','click',function(){addScannedProductToStaffCartFinal(p);state.activePage='createRequest';renderPage('createRequest');});
  onFinal('scannerAddToRequest','click',function(){var action=addScannedProductToStaffCartFinal(p);messageFinal(byIdFinal('scannerFinalMsg'),'Barang '+p.name+' '+(action==='incremented'?'ditambah 1 Qty ke':'ditambahkan ke')+' pengajuan sementara.','success');renderStaffScanCartFinal();});
}
onFinal('scannerScanAgain','click',function(){setTextFinal('scannerFinalResult','Siap scan berikutnya.');setHTMLFinal('scannerFinalProduct','');startFinalScanner();});}else{var admin=String(state.user&&state.user.role||'').toUpperCase()==='ADMIN';var saveAction=admin?'<button type="button" class="btn btn-primary" id="scannerSaveNewProduct">Simpan sebagai Barang</button>':'<div class="info-strip scanner-prefill-note">Barcode belum terdaftar. Hubungi Admin untuk menyimpan barcode ini sebagai Master Barang.</div>';setHTMLFinal('scannerFinalProduct','<div class="panel scanner-product-card" style="margin-top:12px"><div class="panel-header"><h4 class="panel-title">Barcode belum terdaftar</h4><span class="badge warning">Baru</span></div><p class="panel-copy">Barcode <strong>'+escFinal(clean)+'</strong> belum memiliki data barang.'+(admin?' Simpan sebagai barang baru untuk melengkapi SKU, nama, kategori, supplier, stok minimum/maksimum, harga, dan lokasi.':'')+'</p><div class="report-actions" style="margin-top:12px">'+saveAction+'<button type="button" class="btn btn-secondary" id="scannerScanAgain">Scan Lagi</button></div></div>');if(admin){onFinal('scannerSaveNewProduct','click',async function(){try{await ensureMasterCaches();openProductModal({barcode:clean},{forceCreate:true,fromScanner:true});}catch(err){showGlobalMessage(friendlyFinal(err),'error');}});}onFinal('scannerScanAgain','click',function(){setTextFinal('scannerFinalResult','Siap scan berikutnya.');setHTMLFinal('scannerFinalProduct','');startFinalScanner();});}}catch(err){showGlobalMessage(friendlyFinal(err),'error');}}

  function headingFinal(t,d,a){return '<div class="page-heading flex-heading"><div><h3>'+escFinal(t)+'</h3><p>'+escFinal(d)+'</p></div>'+(a||'')+'</div>';}
  function fieldFinal(id,label,val,max,req,type){return '<div class="form-group"><label>'+escFinal(label)+'</label><input id="'+id+'" class="field" type="'+(type||'text')+'" maxlength="'+max+'" '+(req?'required':'')+' value="'+escFinal(val||'')+'"></div>';}
  function numberFieldFinal(id,label,val){return '<div class="form-group"><label>'+escFinal(label)+'</label><input id="'+id+'" class="field" type="number" min="0" step="1" value="'+escFinal(val)+'" required></div>';}
  function numberClassFinal(cls,label,val){return '<div class="form-group"><label>'+escFinal(label)+'</label><input class="field '+cls+'" type="number" min="0" step="1" value="'+escFinal(val)+'" required></div>';}
  function fieldDateFinal(id,label){return '<div class="form-group"><label>'+escFinal(label)+'</label><input id="'+id+'" class="field" type="date" value="'+todayFinal()+'" required></div>';}
  function nowJakartaFinal(){try{return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/\./g,':');}catch(err){return new Date().toISOString();}}
  function formatDateDisplayFinal(v){var s=String(v||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(s)){var p=s.split('-');return p[2]+'/'+p[1]+'/'+p[0];}return s||'-';}
  function productOptions(){return '<option value="">Pilih barang</option>'+activeItemsFinal(state.products).map(function(x){return '<option value="'+escFinal(x.productId)+'">'+escFinal(x.sku)+' — '+escFinal(x.name)+' (Stok '+fmtFinal(x.currentStock)+')</option>';}).join('');}
  function activeSupplierOptions(){return activeItemsFinal(state.suppliers).map(function(x){return '<option value="'+escFinal(x.supplierId)+'">'+escFinal(x.name)+' ('+escFinal(x.code)+')</option>';}).join('');}
  function activeItemsFinal(a){return (a||[]).filter(function(x){return x.active;});}
  async function ensureMasterCaches(){var isAdmin=String(state.user&&state.user.role||'').toUpperCase()==='ADMIN';if(isAdmin){var r=await Promise.all([apiFinal('listProducts',{includeInactive:false}),apiFinal('listSuppliers',{}),apiFinal('listCategories',{})]);state.products=r[0].data.items||[];state.suppliers=r[1].data.items||[];state.categories=r[2].data.items||[];return;}var rp=await apiFinal('listProducts',{includeInactive:false});state.products=rp.data.items||[];state.suppliers=[];state.categories=[];}
  async function refreshProductsFinal(){var r=await apiFinal('listProducts',{includeInactive:true});state.products=r.data.items||[];}
  function apiFinal(a,d){return apiRequest(a,d);}
  function byIdFinal(id){return document.getElementById(id)}
  function valFinal(id){var e=byIdFinal(id);return e?e.value:''}
  function onFinal(id,event,fn){var e=byIdFinal(id);if(e)e.addEventListener(event,fn)}
  function setHTMLFinal(id,h){var e=byIdFinal(id);if(e)e.innerHTML=h}
  function setTextFinal(id,v){var e=byIdFinal(id);if(e)e.textContent=String(v==null?'':v)}
  function escFinal(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
  function formatRequestDateTimeFinal(value){
    if(!value)return '-';
    var d=new Date(value);
    if(isNaN(d.getTime()))return String(value);
    try{return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);}catch(err){return d.toLocaleString('id-ID');}
  }
    function fmtFinal(v){return new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(Number(v||0))}
  function moneyFinal(v){return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v||0))}
  function todayFinal(){
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return String(map.year) + '-' + String(map.month) + '-' + String(map.day);
  }
  function emptyRowFinal(c,t){return '<tr><td colspan="'+c+'" class="empty-cell">'+escFinal(t)+'</td></tr>'}
  function statusFinal(s){return '<span class="badge '+(s==='MENUNGGU'?'warning':(s==='DISETUJUI_PENUH'||s==='COMPLETED'?'success':(s==='DITOLAK'?'danger':'')))+'">'+escFinal(s)+'</span>'}
  function setBtnFinal(b,on,label){if(!b)return;b.disabled=on;b.textContent=label}
  function messageFinal(e,m,t){if(!e)return;e.className='form-message '+(t||'error');e.textContent=String(m||'');e.classList.remove('hidden')}
  function friendlyFinal(e){return e&&e.message?String(e.message):'Terjadi kesalahan server.'}
  function openModalFinal(title,body,footer){closeModalFinal();var o=document.createElement('div');o.id='modalOverlay';o.className='modal-overlay';o.innerHTML='<div class="modal-card"><div class="modal-header"><h3>'+escFinal(title)+'</h3><button class="icon-btn" data-close-modal>×</button></div><div class="modal-body">'+body+'</div><div class="modal-footer" id="modalFooter">'+footer+'</div></div>';document.body.appendChild(o);o.querySelectorAll('[data-close-modal]').forEach(function(b){b.onclick=closeModalFinal;});o.addEventListener('click',function(e){if(e.target===o)closeModalFinal();});}
  function closeModalFinal(){stopFinalScanner();stopProductScanner();stopReceiveScanner();stopPOScanner();var o=byIdFinal('modalOverlay');if(o)o.remove()}
  function printHtmlFinal(id,title){
    var e=byIdFinal(id);
    if(!e){showGlobalMessage('Area cetak tidak ditemukan.','error');return;}
    var html='<!doctype html><html><head><meta charset="utf-8"><title>'+escFinal(title)+'</title><style>@page{size:A4 portrait;margin:12mm}body{font-family:Arial,sans-serif;padding:0;color:#111;font-size:12px}h2{margin:0 0 14px;font-size:20px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #aaa;padding:6px;text-align:left;vertical-align:top}th{background:#eee}.no-print{display:none!important}.badge{display:inline-block;padding:3px 7px;border-radius:999px}.print-meta{display:flex;justify-content:space-between;gap:16px;margin-bottom:10px}.print-meta strong{display:block;font-size:16px}.print-meta span{display:block;font-size:11px;line-height:1.5}.print-general-note{border:1px solid #aaa;padding:8px;margin-top:10px;font-size:11px;line-height:1.45}.print-general-note strong{display:block;margin-bottom:4px}.print-signature{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:26px;page-break-inside:avoid;width:100%}.signature-box{box-sizing:border-box;border:1px solid #777;min-height:135px;padding:10px;text-align:center;display:flex;flex-direction:column;justify-content:flex-start}.signature-title{font-weight:700;font-size:12px}.signature-space{height:82px;flex:0 0 82px}.signature-name{min-height:18px;font-weight:600;font-size:11px}.selected-print-area section{page-break-after:always}.selected-print-area section:last-child{page-break-after:auto}</style></head><body><h2>'+escFinal(title)+'</h2>'+e.innerHTML+'</body></html>';
    var w=window.open('','_blank','width=1100,height=800');
    if(!w){showGlobalMessage('Jendela cetak diblokir browser. Izinkan pop-up untuk situs ATK Inventory lalu klik Print kembali.','warning');return;}
    try{w.document.open();w.document.write(html);w.document.close();w.focus();setTimeout(function(){try{w.print();}catch(err){}},400);}catch(err){try{w.close();}catch(closeErr){}showGlobalMessage('Gagal membuka halaman cetak.','error');}
  }

  async function exportExcelFinal(name,rows){try{await ensureExcelLibraryFinal();}catch(err){showGlobalMessage('Library Excel tidak tersedia.','error');return;}var wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(rows||[]);XLSX.utils.book_append_sheet(wb,ws,'Data');XLSX.writeFile(wb,name+'.xlsx');}
  function exportReportFinal(d){if(!d)return;var rows=d.reportType==='requests'?(d.items||[]).map(function(x){return {requestNo:x.request.requestNo,date:x.request.requestDate,staff:x.request.staffName,status:x.request.status,items:x.items.length,rejectionReason:x.request.rejectionReason};}):d.reportType==='po'?(d.items||[]).map(function(x){return {poNo:x.purchaseOrder.poNo,date:x.purchaseOrder.orderDate,supplier:x.purchaseOrder.supplierName,status:x.purchaseOrder.status,total:x.purchaseOrder.totalAmount};}):(d.items||[]);exportExcelFinal('Laporan-'+d.reportType,rows);}

  function renderPlaceholder(content, action, title) {
    content.innerHTML =
      '<div class="page-heading"><h3>' + escapeHtml(title) + '</h3>' +
      '<p>' + escapeHtml(getModuleDescription(action)) + '</p></div>' +
      '<div class="placeholder-card"><h3>Modul berikutnya</h3>' +
      '<p>Menu dan permission sudah tersedia. Implementasi bisnis modul ini akan dibuat pada tahap berikutnya tanpa mengubah fondasi Master Data yang sudah selesai.</p></div>';
  }

  function getModuleDescription(action) {
    var descriptions = {
      receiveStock: 'Catat transaksi barang masuk dan tambah stok.',
      barcodeScanner: 'Scan barcode menggunakan kamera browser atau input manual.',
      adjustStock: 'Lakukan adjustment dan opname dengan kontrol transaksi.',
      listMovements: 'Lihat histori mutasi stok berdasarkan filter.',
      reorderRecommendations: 'Rekomendasi order berdasarkan min/max dan outstanding PO.',
      listPurchaseOrders: 'Kelola Purchase Order.',
      receivePurchaseOrder: 'Penerimaan PO termasuk partial receipt.',
      listRequests: 'Approval pengajuan Staff.',
      stockReport: 'Laporan stok dan transaksi.',
      bulkUpsertProducts: 'Import Master Barang dari Excel.',
      exportExcel: 'Export data ke Excel.',
      createRequest: 'Buat pengajuan barang.',
      myRequests: 'Lihat pengajuan sendiri.',
      printRequests: 'Cetak pengajuan.'
    };
    return descriptions[action] || 'Modul ATK Inventory.';
  }

  function getPageTitle(action) {
    var role = String(state.user && state.user.role || '').toUpperCase();
    var items = NAV_ITEMS[role] || [];

    for (var i = 0; i < items.length; i++) {
      if (items[i].action === action) return items[i].label;
    }

    return 'Dashboard';
  }

  function pageHeaderBlock(title, description, actionHtml) {
    return '<div class="page-heading flex-heading">' +
      '<div><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(description) + '</p></div>' +
      (actionHtml || '') +
      '</div>';
  }

  function tableToolbar(id, placeholder) {
    return '<div class="table-toolbar">' +
      '<input id="' + escapeAttribute(id) + '" class="field" placeholder="' +
      escapeAttribute(placeholder) + '">' +
      '</div>';
  }

  function fieldHtml(id, label, value, maxlength, required, type) {
    return '<div class="form-group"><label for="' + id + '">' +
      escapeHtml(label) + '</label><input id="' + id + '" class="field" type="' +
      (type || 'text') + '" maxlength="' + maxlength + '"' +
      (required ? ' required' : '') + ' value="' + escapeAttribute(value || '') + '"></div>';
  }

  function fieldHtmlNumber(id, label, value, required, type) {
    return '<div class="form-group"><label for="' + id + '">' +
      escapeHtml(label) + '</label><input id="' + id + '" class="field" type="' +
      (type || 'number') + '" min="0" step="0.01"' +
      (required ? ' required' : '') + ' value="' + escapeAttribute(value == null ? 0 : value) + '"></div>';
  }

  function openModal(config) {
    closeModal();

    var overlay = document.createElement('div');
    overlay.id = 'modalOverlay';
    overlay.className = 'modal-overlay';

    overlay.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
      '<div class="modal-header"><h3 id="modalTitle">' + escapeHtml(config.title) + '</h3>' +
      '<button type="button" class="icon-btn" data-close-modal aria-label="Tutup">×</button></div>' +
      '<div class="modal-body">' + config.body + '</div>' +
      '<div class="modal-footer" id="modalFooter">' + config.footer + '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var closeButtons = overlay.querySelectorAll('[data-close-modal]');
    for (var i = 0; i < closeButtons.length; i++) {
      closeButtons[i].addEventListener('click', closeModal);
    }

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeModal();
    });

    var firstInput = overlay.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
  }

  function closeModal() {
    stopProductScanner();
    var existing = document.getElementById('modalOverlay');
    if (existing) existing.remove();
  }

  function statCard(label, value) {
    return '<div class="stat-card"><div class="stat-label">' +
      escapeHtml(label) + '</div><div class="stat-value">' + escapeHtml(value) + '</div></div>';
  }

  function activeItems(items) {
    return items.filter(function (item) { return item.active; });
  }

  function findCacheName(items, idField, idValue, nameField) {
    var found = items.find(function (row) {
      return String(row[idField]) === String(idValue);
    });

    return found ? String(found[nameField] || '') : '';
  }

  function emptyRow(colspan, text) {
    return '<tr><td colspan="' + colspan + '" class="empty-cell">' +
      escapeHtml(text) + '</td></tr>';
  }

  function statusBadge(active) {
    return active
      ? '<span class="badge success">Aktif</span>'
      : '<span class="badge">Nonaktif</span>';
  }

  function formatMoney(value) {
    try {
      return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
      }).format(Number(value || 0));
    } catch (err) {
      return 'Rp ' + number(value);
    }
  }

  function formatDate(value) {
    if (!value) return '-';

    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);

    return date.toLocaleString('id-ID', {
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  function number(value) {
    var n = Number(value || 0);
    return new Intl.NumberFormat('id-ID', {
      maximumFractionDigits: 2
    }).format(n);
  }

  function setConnectionStatus(mode) {
    var element = document.getElementById('connectionStatus');
    if (!element) return;

    var label = 'Online';
    if (mode === 'checking') label = 'Memeriksa';
    else if (mode === 'offline') label = 'Offline';
    else if (mode === 'error') label = 'Error';

    element.innerHTML =
      '<span class="status-dot"></span><span>' + escapeHtml(label) + '</span>';
  }

  function showGlobalMessage(message, type) {
    var element = document.getElementById('globalMessage');
    if (!element) return;

    showMessageElement(element, message, type);
    window.setTimeout(function () {
      hideElement(element);
    }, 5000);
  }

  function showMessageElement(element, message, type) {
    if (!element) return;
    element.className = 'form-message ' + (type || 'error');
    element.textContent = String(message || '');
    element.classList.remove('hidden');
  }

  function hideElement(element) {
    if (element) element.classList.add('hidden');
  }

  function showElement(element) {
    if (element) element.classList.remove('hidden');
  }

  function setButtonLoading(button, loading) {
    if (!button) return;

    button.disabled = loading;

    var label = button.querySelector('.btn-label');
    var spinner = button.querySelector('.spinner');

    if (label) label.textContent = loading ? 'Memproses...' : 'Login';

    if (spinner) {
      if (loading) spinner.classList.remove('hidden');
      else spinner.classList.add('hidden');
    }
  }

  function setButtonLoadingGeneric(button, loading, labelText) {
    if (!button) return;
    button.disabled = loading;

    if (loading) {
      button.setAttribute('data-original-label', button.textContent);
      button.textContent = labelText || 'Memproses...';
    } else {
      button.textContent = labelText || button.getAttribute('data-original-label') || 'Simpan';
    }
  }

  function persistSession() {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.SESSION,
        JSON.stringify({
          sessionToken: state.sessionToken,
          expiresAt: state.expiresAt
        })
      );
    } catch (err) {
      showGlobalMessage('Browser tidak mengizinkan penyimpanan session lokal.', 'warning');
    }
  }

  function clearSession() {
    state.sessionToken = '';
    state.expiresAt = '';
    state.user = null;
    state.staffRequestCart = [];
    state.caches = {
      categories: [],
      suppliers: [],
      products: [],
      users: []
    };

    try {
      window.localStorage.removeItem(STORAGE_KEYS.SESSION);
    } catch (err) {
      /* Ignore. */
    }
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = String(value == null ? '' : value);
  }

  function getInitials(name) {
    var text = String(name || '').trim();
    if (!text) return 'U';

    var parts = text.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (parts[0].charAt(0) +
      parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function extractErrorMessage(result) {
    if (!result || !result.error) return '';
    return String(result.error.message || '');
  }

  function getFriendlyError(error) {
    if (!error) return 'Terjadi kesalahan yang tidak diketahui.';
    if (typeof error === 'string') return error;

    var code = String(error.code || '');

    if (code === 'NETWORK_ERROR') return 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
    if (code === 'TIMEOUT_ERROR' || code === 'UPSTREAM_TIMEOUT') return 'Server terlalu lama merespons. Silakan coba lagi.';
    if (code === 'INVALID_JSON' || code === 'UPSTREAM_INVALID_JSON') return 'Server sedang mengalami gangguan. Silakan coba lagi.';
    if (code === 'UNAUTHORIZED') return String(error.message || 'Username atau password salah.');
    if (code === 'RATE_LIMITED') return 'Terlalu banyak percobaan login. Coba lagi setelah beberapa menit.';
    if (error.message) return String(error.message);

    return 'Terjadi kesalahan pada server.';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function openSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.remove('hidden');
  }

  function closeSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.add('hidden');
  }
})();
