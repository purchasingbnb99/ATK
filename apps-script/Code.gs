/**
 * ATK Inventory - Code.gs
 * Stage 4: Master Data
 *
 * Routes:
 * - authentication/session
 * - categories
 * - suppliers
 * - products
 * - users
 *
 * SHEETS and HEADERS are defined only in SetupDatabase.gs.
 */

var SESSION_PREFIX = 'ATK_SESSION_';
var SESSION_TTL_SECONDS = 8 * 60 * 60;
var LOGIN_FAILURE_PREFIX = 'ATK_LOGIN_FAIL_';
var LOGIN_MAX_FAILURES = 5;
var LOGIN_WINDOW_SECONDS = 15 * 60;
var LOGIN_USER_CACHE_PREFIX = 'ATK_LOGIN_USER_';
var LOGIN_USER_CACHE_SECONDS = 30;

var PUBLIC_ACTIONS = {
  login: true,
  createStaffSession: true
};

var ADMIN_ACTIONS = {
  listCategories: true,
  createCategory: true,
  updateCategory: true,
  listSuppliers: true,
  createSupplier: true,
  updateSupplier: true,
  createProduct: true,
  updateProduct: true,
  toggleProduct: true,
  receiveStock: true,
  listMovements: true,
  adjustStock: true,
  approveRequest: true,
  rejectRequest: true,
  editRejectedRequest: true,
  reorderRecommendations: true,
  createPurchaseOrder: true,
  listPurchaseOrders: true,
  receivePurchaseOrder: true,
  stockReport: true,
  bulkUpsertProducts: true,
  updatePurchaseOrderStatus: true,
  listUsers: true,
  saveUser: true
};

var AUTHENTICATED_ACTIONS = {
  listPrintableRequests: true,
  logout: true,
  me: true,
  dashboard: true,
  listProducts: true,
  searchProducts: true,
  getProduct: true,
  listRequests: true,
  createRequest: true,
  cancelRequest: true,
  changePassword: true
};

var STAFF_ONLY_ACTIONS = {
  createRequest: true,
  cancelRequest: true
};

function doGet(e) {
  return jsonOutput_({
    ok: true,
    service: 'ATK Inventory API',
    version: '1.0.0'
  });
}

function doPost(e) {
  try {
    var body = parseJsonBody_(e);
    validateApiKey_(body.apiKey);

    var action = String(body.action || '').trim();
    if (!action) {
      throw createApiError_(
        'VALIDATION_ERROR',
        'Action wajib diisi.',
        400
      );
    }

    var data = body.data || {};
    var sessionToken = String(body.sessionToken || '');

    if (action === 'login') {
      return jsonOutput_({
        ok: true,
        action: 'login',
        data: handleLogin_(data)
      });
    }

    if (action === 'createStaffSession') {
      return jsonOutput_({
        ok: true,
        action: 'createStaffSession',
        data: createStaffSession_(data)
      });
    }

    var session = requireSession_(sessionToken);
    authorizeAction_(action, session.user);

    var result = routeAction_(action, data, session.user);

    return jsonOutput_({
      ok: true,
      action: action,
      data: result
    });
  } catch (err) {
    return handleApiError_(err);
  }
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'POST body JSON tidak ditemukan.',
      400
    );
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    throw createApiError_(
      'INVALID_JSON',
      'Request body bukan JSON yang valid.',
      400
    );
  }

  if (!body || typeof body !== 'object') {
    throw createApiError_(
      'INVALID_JSON',
      'Request body harus berupa object JSON.',
      400
    );
  }

  return body;
}

function validateApiKey_(apiKey) {
  var expected = getOrCreateApiKey();

  if (!apiKey || String(apiKey) !== String(expected)) {
    throw createApiError_(
      'UNAUTHORIZED',
      'API key tidak valid.',
      401
    );
  }
}

function getOrCreateApiKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ATK_API_KEY');

  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') +
      Utilities.getUuid().replace(/-/g, '');
    props.setProperty('ATK_API_KEY', key);
  }

  return key;
}

function createStaffSession_(data) {
  var name = String(data.name || '').trim();
  var department = String(data.department || '').trim();

  if (!name) {
    throw createApiError_('VALIDATION_ERROR', 'Nama Staff wajib diisi.', 400);
  }
  if (name.length > 100) {
    throw createApiError_('VALIDATION_ERROR', 'Nama Staff maksimal 100 karakter.', 400);
  }
  if (department.length > 100) {
    throw createApiError_('VALIDATION_ERROR', 'Departemen maksimal 100 karakter.', 400);
  }

  var clientId = String(data.clientId || '').trim();
  if (!clientId) {
    throw createApiError_('VALIDATION_ERROR', 'Identitas perangkat Staff tidak ditemukan. Silakan masuk Mode Staff kembali.', 400);
  }
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(clientId)) {
    throw createApiError_('VALIDATION_ERROR', 'Identitas perangkat Staff tidak valid.', 400);
  }

  var token = Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clientId, Utilities.Charset.UTF_8);
  var digestHex = '';
  for (var di = 0; di < digest.length; di++) {
    var hv = (digest[di] < 0 ? digest[di] + 256 : digest[di]).toString(16);
    digestHex += hv.length === 1 ? '0' + hv : hv;
  }
  var publicUserId = 'PUBLIC_STAFF_' + digestHex;
  var now = nowIso_();
  var expiresAt = new Date(new Date().getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  var session = {
    token: token,
    userId: publicUserId,
    username: publicUserId,
    name: name,
    role: 'STAFF',
    department: department,
    publicStaff: true,
    createdAt: now,
    expiresAt: expiresAt
  };

  PropertiesService.getScriptProperties().setProperty(
    SESSION_PREFIX + token,
    JSON.stringify(session)
  );

  return {
    sessionToken: token,
    expiresAt: expiresAt,
    user: sanitizeSessionUser_(session)
  };
}

function getLoginUserByUsername_(username) {
  var normalized = normalizeUsername_(username);
  var cache = CacheService.getScriptCache();
  var cacheKey = LOGIN_USER_CACHE_PREFIX + normalized;
  var cached = cache.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (err) {
      cache.remove(cacheKey);
    }
  }

  var users = getRowsAsObjects_(getSheet_(SHEETS.USERS));
  for (var i = 0; i < users.length; i++) {
    if (normalizeUsername_(users[i].username) === normalized) {
      var user = users[i];
      try {
        cache.put(cacheKey, JSON.stringify(user), LOGIN_USER_CACHE_SECONDS);
      } catch (cacheErr) {
        /* Cache failure must never block login. */
      }
      return user;
    }
  }

  return null;
}

function clearLoginUserCache_(username) {
  if (!username) return;
  try {
    CacheService.getScriptCache().remove(
      LOGIN_USER_CACHE_PREFIX + normalizeUsername_(username)
    );
  } catch (err) {
    /* Cache failure must never block user changes. */
  }
}

function handleLogin_(data) {
  var username = String(data.username || '').trim();
  var password = String(data.password || '');

  if (!username || !password) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Username dan password wajib diisi.',
      400
    );
  }

  enforceLoginRateLimit_(username);

  var user = getLoginUserByUsername_(username);

  if (!user || !toBoolean_(user.active)) {
    recordLoginFailure_(username);
    throw createApiError_(
      'UNAUTHORIZED',
      'Username atau password salah.',
      401
    );
  }

  var calculatedHash = sha256Hex_(
    String(user.passwordSalt || '') + ':' + password
  );

  if (calculatedHash !== String(user.passwordHash || '')) {
    recordLoginFailure_(username);
    throw createApiError_(
      'UNAUTHORIZED',
      'Username atau password salah.',
      401
    );
  }

  clearLoginFailures_(username);

  var token = Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');

  var expiresAt = new Date(
    new Date().getTime() + SESSION_TTL_SECONDS * 1000
  ).toISOString();

  var session = {
    token: token,
    userId: String(user.userId),
    username: String(user.username),
    name: String(user.name || ''),
    role: normalizeRole_(user.role),
    department: String(user.department || ''),
    createdAt: nowIso_(),
    expiresAt: expiresAt
  };

  PropertiesService.getScriptProperties().setProperty(
    SESSION_PREFIX + token,
    JSON.stringify(session)
  );

  return {
    sessionToken: token,
    expiresAt: expiresAt,
    user: sanitizeUser_(user)
  };
}

function requireSession_(token) {
  if (!token) {
    throw createApiError_(
      'UNAUTHORIZED',
      'Session tidak ditemukan.',
      401
    );
  }

  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(SESSION_PREFIX + token);

  if (!raw) {
    throw createApiError_(
      'SESSION_EXPIRED',
      'Session sudah tidak valid.',
      401
    );
  }

  var session;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    props.deleteProperty(SESSION_PREFIX + token);
    throw createApiError_(
      'SESSION_EXPIRED',
      'Session tidak valid.',
      401
    );
  }

  if (!session.expiresAt ||
      new Date(session.expiresAt).getTime() <= new Date().getTime()) {
    props.deleteProperty(SESSION_PREFIX + token);
    throw createApiError_(
      'SESSION_EXPIRED',
      'Session sudah kedaluwarsa.',
      401
    );
  }

  return {
    user: session,
    token: token
  };
}

function authorizeAction_(action, user) {
  var role = normalizeRole_(user.role);

  if (PUBLIC_ACTIONS[action]) {
    return;
  }

  if (AUTHENTICATED_ACTIONS[action]) {
    if (action === 'changePassword' && user.publicStaff) {
      throw createApiError_(
        'FORBIDDEN',
        'Mode Staff tanpa login tidak memiliki password.',
        403
      );
    }
    if (STAFF_ONLY_ACTIONS[action] && role !== 'STAFF') {
      throw createApiError_(
        'FORBIDDEN',
        'Aksi ini hanya dapat dilakukan oleh STAFF.',
        403
      );
    }
    return;
  }

  if (ADMIN_ACTIONS[action]) {
    if (role !== 'ADMIN') {
      throw createApiError_(
        'FORBIDDEN',
        'Aksi ini hanya dapat dilakukan oleh ADMIN.',
        403
      );
    }
    return;
  }

  throw createApiError_(
    'NOT_IMPLEMENTED',
    'Action belum terdaftar: ' + action,
    501
  );
}

function routeAction_(action, data, user) {
  switch (action) {
    case 'logout':
      return handleLogout_(user);

    case 'me':
      return handleMe_(user);

    case 'dashboard':
      return handleDashboard_(user);

    case 'listCategories':
      return listCategories_();

    case 'createCategory':
      return createCategory_(data, user);

    case 'updateCategory':
      return updateCategory_(data, user);

    case 'listSuppliers':
      return listSuppliers_();

    case 'createSupplier':
      return createSupplier_(data, user);

    case 'updateSupplier':
      return updateSupplier_(data, user);

    case 'listProducts':
      return listProducts_(data);

    case 'searchProducts':
      return searchProducts_(data);

    case 'getProduct':
      return getProduct_(data);

    case 'createProduct':
      return createProduct_(data, user);

    case 'updateProduct':
      return updateProduct_(data, user);

    case 'toggleProduct':
      return toggleProduct_(data, user);

    case 'receiveStock':
      return receiveStockFinal_(data, user);

    case 'listMovements':
      return listMovementsFinal_(data);

    case 'adjustStock':
      return adjustStockFinal_(data, user);

    case 'listRequests':
      return listRequestsFinal_(data, user);

    case 'listPrintableRequests':
      return listPrintableRequestsFinal_(data, user);

    case 'createRequest':
      return createRequestFinal_(data, user);

    case 'approveRequest':
      return approveRequestFinal_(data, user);

    case 'rejectRequest':
      return rejectRequestFinal_(data, user);

    case 'editRejectedRequest':
      return editRejectedRequestFinal_(data, user);

    case 'cancelRequest':
      return cancelRequestFinal_(data, user);

    case 'reorderRecommendations':
      return reorderRecommendationsFinal_();

    case 'createPurchaseOrder':
      return createPurchaseOrderFinal_(data, user);

    case 'listPurchaseOrders':
      return listPurchaseOrdersFinal_(data);

    case 'receivePurchaseOrder':
      return receivePurchaseOrderFinal_(data, user);

    case 'stockReport':
      return stockReportFinal_(data, user);

    case 'bulkUpsertProducts':
      return bulkUpsertProductsFinal_(data, user);

    case 'updatePurchaseOrderStatus':
      return updatePurchaseOrderStatusFinal_(data, user);

    case 'listUsers':
      return listUsers_();

    case 'saveUser':
      return saveUser_(data, user);

    case 'changePassword':
      return changePassword_(data, user);

    default:
      throw createApiError_(
        'NOT_IMPLEMENTED',
        'Action belum diimplementasikan pada tahap ini: ' + action,
        501
      );
  }
}

function handleDashboard_(user) {
  var products = getRowsAsObjects_(getSheet_(SHEETS.PRODUCTS));
  var categories = getRowsAsObjects_(getSheet_(SHEETS.CATEGORIES));
  var suppliers = getRowsAsObjects_(getSheet_(SHEETS.SUPPLIERS));
  var users = getRowsAsObjects_(getSheet_(SHEETS.USERS));
  var requests = getRowsAsObjects_(getSheet_(SHEETS.REQUESTS));
  var purchaseOrders = getRowsAsObjects_(getSheet_(SHEETS.PURCHASE_ORDERS));
  var movementRows = getRecentRowsAsObjectsFinal_(getSheet_(SHEETS.STOCK_MOVEMENTS), 3000);

  var activeProducts = 0;
  var lowStock = 0;
  for (var i = 0; i < products.length; i++) {
    if (toBoolean_(products[i].active)) {
      activeProducts++;
      if (toNumber_(products[i].currentStock) <= toNumber_(products[i].minStock)) lowStock++;
    }
  }

  var today = Utilities.formatDate(new Date(), DATABASE_TIMEZONE, 'yyyy-MM-dd');
  var startDateObj = new Date();
  startDateObj.setDate(startDateObj.getDate() - 29);
  var startDate = Utilities.formatDate(startDateObj, DATABASE_TIMEZONE, 'yyyy-MM-dd');
  var usageMap = {};
  var productUsage = {};
  for (var d = 0; d < 30; d++) {
    var dt = new Date();
    dt.setDate(dt.getDate() - (29 - d));
    var ds = Utilities.formatDate(dt, DATABASE_TIMEZONE, 'yyyy-MM-dd');
    usageMap[ds] = 0;
  }
  var totalOut30 = 0;
  movementRows.forEach(function (row) {
    if (String(row.type || '').toUpperCase() !== 'OUT') return;
    var movementDate = dateOnlyFinal_(row.movementDate);
    if (!movementDate || movementDate < startDate || movementDate > today) return;
    var qty = Math.abs(toNumber_(row.qty));
    usageMap[movementDate] = (usageMap[movementDate] || 0) + qty;
    totalOut30 += qty;
    var pid = String(row.productId || '');
    if (!productUsage[pid]) productUsage[pid] = { productId: pid, sku: String(row.sku || ''), productName: String(row.productName || ''), qty: 0 };
    productUsage[pid].qty += qty;
  });

  var usage30Days = Object.keys(usageMap).sort().map(function (ds) {
    return { date: ds, label: ds.slice(5), qty: usageMap[ds] || 0 };
  });
  var topUsedProducts = Object.keys(productUsage).map(function (k) { return productUsage[k]; });
  topUsedProducts.sort(function (a, c) { return Number(c.qty) - Number(a.qty) || String(a.sku).localeCompare(String(c.sku)); });
  // Kirim Top 10 agar dashboard dapat menampilkan nama barang secara langsung.
  // Frontend menggunakan 10 item untuk grafik kiri dan 5 item untuk ringkasan kanan.
  topUsedProducts = topUsedProducts.slice(0, 10);

  var pendingRequests = 0;
  requests.forEach(function (x) { if (String(x.status || '').toUpperCase() === 'MENUNGGU') pendingRequests++; });
  var openPurchaseOrders = 0;
  purchaseOrders.forEach(function (x) { if (['DRAFT', 'ORDERED', 'PARTIAL'].indexOf(String(x.status || '').toUpperCase()) >= 0) openPurchaseOrders++; });

  return {
    user: sanitizeSessionUser_(user),
    summary: { products: activeProducts, categories: categories.length, suppliers: suppliers.length, users: users.length },
    usage30Days: usage30Days,
    topUsedProducts: topUsedProducts,
    alerts: { lowStock: lowStock, pendingRequests: pendingRequests, openPurchaseOrders: openPurchaseOrders, totalOut30Days: totalOut30 }
  };
}

/* ----------------------------- Categories ----------------------------- */

function listCategories_() {
  var rows = getRowsAsObjects_(getSheet_(SHEETS.CATEGORIES));
  rows.sort(function (a, b) {
    return String(a.categoryName || '').localeCompare(
      String(b.categoryName || ''),
      'id'
    );
  });

  return {
    items: rows.map(function (item) {
      return {
        categoryId: String(item.categoryId || ''),
        categoryName: String(item.categoryName || ''),
        active: toBoolean_(item.active),
        createdAt: String(item.createdAt || ''),
        updatedAt: String(item.updatedAt || '')
      };
    })
  };
}

function createCategory_(data, user) {
  requireAdminUser_(user);

  var categoryName = normalizeName_(data.categoryName);
  validateTextLength_(categoryName, 'Nama kategori', 1, 100);

  var sheet = getSheet_(SHEETS.CATEGORIES);
  var rows = getRowsAsObjects_(sheet);

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].categoryName || '').trim().toLowerCase() === categoryName.toLowerCase()) {
      throw createApiError_(
        'DUPLICATE',
        'Nama kategori sudah digunakan.',
        409
      );
    }
  }

  var now = nowIso_();
  var item = {
    categoryId: Utilities.getUuid(),
    categoryName: categoryName,
    active: true,
    createdAt: now,
    updatedAt: now
  };

  appendObjectRow_(sheet, HEADERS[SHEETS.CATEGORIES], item);

  return {
    item: item
  };
}

function updateCategory_(data, user) {
  requireAdminUser_(user);

  var categoryId = String(data.categoryId || '').trim();
  var categoryName = normalizeName_(data.categoryName);

  if (!categoryId) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'categoryId wajib diisi.',
      400
    );
  }

  validateTextLength_(categoryName, 'Nama kategori', 1, 100);

  var sheet = getSheet_(SHEETS.CATEGORIES);
  var rowNumber = findRowById_(sheet, 'categoryId', categoryId);

  if (rowNumber < 0) {
    throw createApiError_(
      'NOT_FOUND',
      'Kategori tidak ditemukan.',
      404
    );
  }

  var rows = getRowsAsObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].categoryId) !== categoryId &&
        String(rows[i].categoryName || '').trim().toLowerCase() === categoryName.toLowerCase()) {
      throw createApiError_(
        'DUPLICATE',
        'Nama kategori sudah digunakan.',
        409
      );
    }
  }

  setCellByHeader_(sheet, rowNumber, 'categoryName', categoryName);
  setCellByHeader_(sheet, rowNumber, 'updatedAt', nowIso_());

  return {
    item: getObjectByRow_(sheet, rowNumber)
  };
}

/* ------------------------------ Suppliers ----------------------------- */

function listSuppliers_() {
  var rows = getRowsAsObjects_(getSheet_(SHEETS.SUPPLIERS));
  rows.sort(function (a, b) {
    return String(a.name || '').localeCompare(
      String(b.name || ''),
      'id'
    );
  });

  return {
    items: rows.map(function (item) {
      return sanitizeSupplier_(item);
    })
  };
}

function createSupplier_(data, user) {
  requireAdminUser_(user);

  var code = normalizeCode_(data.code);
  var name = normalizeName_(data.name);
  var pic = normalizeText_(data.pic, 100);
  var phone = normalizeText_(data.phone, 50);
  var email = normalizeText_(data.email, 120);
  var address = normalizeText_(data.address, 500);

  validateTextLength_(code, 'Kode supplier', 1, 40);
  validateTextLength_(name, 'Nama supplier', 1, 150);

  if (email && !isValidEmail_(email)) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Format email supplier tidak valid.',
      400
    );
  }

  var sheet = getSheet_(SHEETS.SUPPLIERS);
  var rows = getRowsAsObjects_(sheet);

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].code || '').trim().toLowerCase() === code.toLowerCase()) {
      throw createApiError_(
        'DUPLICATE',
        'Kode supplier sudah digunakan.',
        409
      );
    }
  }

  var now = nowIso_();
  var item = {
    code: code,
    name: name,
    pic: pic,
    phone: phone,
    email: email,
    address: address
  };

  var supplier = {
    supplierId: Utilities.getUuid(),
    code: item.code,
    name: item.name,
    pic: item.pic,
    phone: item.phone,
    email: item.email,
    address: item.address,
    active: true,
    createdAt: now,
    updatedAt: now
  };

  appendObjectRow_(sheet, HEADERS[SHEETS.SUPPLIERS], supplier);

  return {
    item: supplier
  };
}

function updateSupplier_(data, user) {
  requireAdminUser_(user);

  var supplierId = String(data.supplierId || '').trim();
  var code = normalizeCode_(data.code);
  var name = normalizeName_(data.name);
  var pic = normalizeText_(data.pic, 100);
  var phone = normalizeText_(data.phone, 50);
  var email = normalizeText_(data.email, 120);
  var address = normalizeText_(data.address, 500);

  if (!supplierId) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'supplierId wajib diisi.',
      400
    );
  }

  validateTextLength_(code, 'Kode supplier', 1, 40);
  validateTextLength_(name, 'Nama supplier', 1, 150);

  if (email && !isValidEmail_(email)) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Format email supplier tidak valid.',
      400
    );
  }

  var sheet = getSheet_(SHEETS.SUPPLIERS);
  var rowNumber = findRowById_(sheet, 'supplierId', supplierId);

  if (rowNumber < 0) {
    throw createApiError_(
      'NOT_FOUND',
      'Supplier tidak ditemukan.',
      404
    );
  }

  var rows = getRowsAsObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].supplierId) !== supplierId &&
        String(rows[i].code || '').trim().toLowerCase() === code.toLowerCase()) {
      throw createApiError_(
        'DUPLICATE',
        'Kode supplier sudah digunakan.',
        409
      );
    }
  }

  setCellByHeader_(sheet, rowNumber, 'code', code);
  setCellByHeader_(sheet, rowNumber, 'name', name);
  setCellByHeader_(sheet, rowNumber, 'pic', pic);
  setCellByHeader_(sheet, rowNumber, 'phone', phone);
  setCellByHeader_(sheet, rowNumber, 'email', email);
  setCellByHeader_(sheet, rowNumber, 'address', address);
  setCellByHeader_(sheet, rowNumber, 'updatedAt', nowIso_());

  return {
    item: sanitizeSupplier_(getObjectByRow_(sheet, rowNumber))
  };
}

/* ------------------------------- Products ----------------------------- */

function listProducts_(data) {
  var rows = getRowsAsObjects_(getSheet_(SHEETS.PRODUCTS));
  var includeInactive = toBoolean_(data && data.includeInactive);

  var items = [];

  for (var i = 0; i < rows.length; i++) {
    if (!includeInactive && !toBoolean_(rows[i].active)) {
      continue;
    }
    items.push(sanitizeProduct_(rows[i]));
  }

  items.sort(function (a, b) {
    return String(a.name || '').localeCompare(
      String(b.name || ''),
      'id'
    );
  });

  return {
    items: items
  };
}

function searchProducts_(data) {
  var query = normalizeText_(data.query, 100).toLowerCase();
  var barcode = normalizeText_(data.barcode, 100).toLowerCase();
  var sku = normalizeText_(data.sku, 100).toLowerCase();
  var name = normalizeText_(data.name, 150).toLowerCase();

  if (!query && !barcode && !sku && !name) {
    return {
      items: []
    };
  }

  var rows = getRowsAsObjects_(getSheet_(SHEETS.PRODUCTS));
  var items = [];

  for (var i = 0; i < rows.length; i++) {
    if (!toBoolean_(rows[i].active)) {
      continue;
    }

    var rowSku = String(rows[i].sku || '').toLowerCase();
    var rowBarcode = String(rows[i].barcode || '').toLowerCase();
    var rowName = String(rows[i].name || '').toLowerCase();

    var match = true;

    if (query) {
      match = rowSku.indexOf(query) >= 0 ||
        rowBarcode.indexOf(query) >= 0 ||
        rowName.indexOf(query) >= 0;
    }

    if (match && barcode) {
      match = rowBarcode === barcode;
    }

    if (match && sku) {
      match = rowSku === sku;
    }

    if (match && name) {
      match = rowName.indexOf(name) >= 0;
    }

    if (match) {
      items.push(sanitizeProduct_(rows[i]));
    }
  }

  return {
    items: items
  };
}

function getProduct_(data) {
  var productId = String(data.productId || '').trim();
  if (!productId) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'productId wajib diisi.',
      400
    );
  }

  var sheet = getSheet_(SHEETS.PRODUCTS);
  var rowNumber = findRowById_(sheet, 'productId', productId);

  if (rowNumber < 0) {
    throw createApiError_(
      'NOT_FOUND',
      'Barang tidak ditemukan.',
      404
    );
  }

  return {
    item: sanitizeProduct_(getObjectByRow_(sheet, rowNumber))
  };
}

function createProduct_(data, user) {
  requireAdminUser_(user);

  var product = validateProductInput_(data, null);

  var sheet = getSheet_(SHEETS.PRODUCTS);
  var rows = getRowsAsObjects_(sheet);

  ensureUniqueProductIdentifiers_(rows, product.sku, product.barcode, null);
  validateProductReferences_(product.categoryId, product.supplierId);

  var now = nowIso_();
  var item = {
    productId: Utilities.getUuid(),
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    categoryId: product.categoryId,
    unit: product.unit,
    minStock: product.minStock,
    maxStock: product.maxStock,
    currentStock: 0,
    price: product.price,
    supplierId: product.supplierId,
    location: product.location,
    active: true,
    createdAt: now,
    updatedAt: now
  };

  appendObjectRow_(sheet, HEADERS[SHEETS.PRODUCTS], item);

  return {
    item: sanitizeProduct_(item)
  };
}

function updateProduct_(data, user) {
  requireAdminUser_(user);

  var productId = String(data.productId || '').trim();

  if (!productId) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'productId wajib diisi.',
      400
    );
  }

  var sheet = getSheet_(SHEETS.PRODUCTS);
  var rowNumber = findRowById_(sheet, 'productId', productId);

  if (rowNumber < 0) {
    throw createApiError_(
      'NOT_FOUND',
      'Barang tidak ditemukan.',
      404
    );
  }

  var product = validateProductInput_(data, productId);
  var rows = getRowsAsObjects_(sheet);

  ensureUniqueProductIdentifiers_(rows, product.sku, product.barcode, productId);
  validateProductReferences_(product.categoryId, product.supplierId);

  setCellByHeader_(sheet, rowNumber, 'sku', product.sku);
  setCellByHeader_(sheet, rowNumber, 'barcode', product.barcode);
  setCellByHeader_(sheet, rowNumber, 'name', product.name);
  setCellByHeader_(sheet, rowNumber, 'categoryId', product.categoryId);
  setCellByHeader_(sheet, rowNumber, 'unit', product.unit);
  setCellByHeader_(sheet, rowNumber, 'minStock', product.minStock);
  setCellByHeader_(sheet, rowNumber, 'maxStock', product.maxStock);
  setCellByHeader_(sheet, rowNumber, 'price', product.price);
  setCellByHeader_(sheet, rowNumber, 'supplierId', product.supplierId);
  setCellByHeader_(sheet, rowNumber, 'location', product.location);
  setCellByHeader_(sheet, rowNumber, 'updatedAt', nowIso_());

  return {
    item: sanitizeProduct_(getObjectByRow_(sheet, rowNumber))
  };
}

function toggleProduct_(data, user) {
  requireAdminUser_(user);

  var productId = String(data.productId || '').trim();

  if (!productId) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'productId wajib diisi.',
      400
    );
  }

  var sheet = getSheet_(SHEETS.PRODUCTS);
  var rowNumber = findRowById_(sheet, 'productId', productId);

  if (rowNumber < 0) {
    throw createApiError_(
      'NOT_FOUND',
      'Barang tidak ditemukan.',
      404
    );
  }

  var current = getObjectByRow_(sheet, rowNumber);
  var active = !toBoolean_(current.active);

  setCellByHeader_(sheet, rowNumber, 'active', active);
  setCellByHeader_(sheet, rowNumber, 'updatedAt', nowIso_());

  return {
    item: sanitizeProduct_(getObjectByRow_(sheet, rowNumber))
  };
}

function validateProductInput_(data, currentProductId) {
  var sku = normalizeCode_(data.sku);
  var barcode = normalizeText_(data.barcode, 100);
  var name = normalizeName_(data.name);
  var categoryId = String(data.categoryId || '').trim();
  var unit = normalizeText_(data.unit, 40);
  var minStock = toNonNegativeNumber_(data.minStock, 'Min Stock');
  var maxStock = toNonNegativeNumber_(data.maxStock, 'Max Stock');
  var price = toNonNegativeNumber_(data.price, 'Harga');
  var supplierId = String(data.supplierId || '').trim();
  var location = normalizeText_(data.location, 150);

  validateTextLength_(sku, 'SKU', 1, 60);
  validateTextLength_(barcode, 'Barcode', 1, 100);
  validateTextLength_(name, 'Nama Barang', 1, 200);
  validateTextLength_(categoryId, 'Kategori', 1, 80);
  validateTextLength_(unit, 'Satuan', 1, 40);
  validateTextLength_(supplierId, 'Supplier', 1, 80);
  validateTextLength_(location, 'Lokasi', 1, 150);

  if (maxStock <= minStock) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Max Stock harus lebih besar dari Min Stock.',
      400
    );
  }

  return {
    productId: currentProductId || '',
    sku: sku,
    barcode: barcode,
    name: name,
    categoryId: categoryId,
    unit: unit,
    minStock: minStock,
    maxStock: maxStock,
    price: price,
    supplierId: supplierId,
    location: location
  };
}

function ensureUniqueProductIdentifiers_(rows, sku, barcode, currentProductId) {
  for (var i = 0; i < rows.length; i++) {
    if (currentProductId &&
        String(rows[i].productId) === String(currentProductId)) {
      continue;
    }

    if (String(rows[i].sku || '').trim().toLowerCase() === sku.toLowerCase()) {
      throw createApiError_(
        'DUPLICATE',
        'SKU sudah digunakan.',
        409
      );
    }

    if (String(rows[i].barcode || '').trim().toLowerCase() === barcode.toLowerCase()) {
      throw createApiError_(
        'DUPLICATE',
        'Barcode sudah digunakan.',
        409
      );
    }
  }
}

function validateProductReferences_(categoryId, supplierId) {
  var categories = getRowsAsObjects_(getSheet_(SHEETS.CATEGORIES));
  var suppliers = getRowsAsObjects_(getSheet_(SHEETS.SUPPLIERS));

  var categoryFound = false;
  for (var i = 0; i < categories.length; i++) {
    if (String(categories[i].categoryId) === categoryId) {
      categoryFound = true;
      if (!toBoolean_(categories[i].active)) {
        throw createApiError_(
          'VALIDATION_ERROR',
          'Kategori yang dipilih tidak aktif.',
          400
        );
      }
      break;
    }
  }

  if (!categoryFound) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Kategori tidak ditemukan.',
      400
    );
  }

  var supplierFound = false;
  for (var j = 0; j < suppliers.length; j++) {
    if (String(suppliers[j].supplierId) === supplierId) {
      supplierFound = true;
      if (!toBoolean_(suppliers[j].active)) {
        throw createApiError_(
          'VALIDATION_ERROR',
          'Supplier yang dipilih tidak aktif.',
          400
        );
      }
      break;
    }
  }

  if (!supplierFound) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Supplier tidak ditemukan.',
      400
    );
  }
}

/* -------------------------------- Users ------------------------------- */

function listUsers_() {
  var rows = getRowsAsObjects_(getSheet_(SHEETS.USERS));

  rows.sort(function (a, b) {
    return String(a.name || a.username || '').localeCompare(
      String(b.name || b.username || ''),
      'id'
    );
  });

  return {
    items: rows.map(function (item) {
      return sanitizeUser_(item);
    })
  };
}

function saveUser_(data, currentUser) {
  requireAdminUser_(currentUser);

  var userId = String(data.userId || '').trim();
  var username = normalizeUsername_(data.username);
  var name = normalizeName_(data.name);
  var email = normalizeText_(data.email, 120);
  var role = normalizeRole_(data.role);
  var department = normalizeText_(data.department, 120);
  var active = data.active === undefined ? true : toBoolean_(data.active);
  var password = String(data.password || '');

  validateTextLength_(username, 'Username', 3, 80);
  validateTextLength_(name, 'Nama', 1, 150);
  validateTextLength_(department, 'Department', 0, 120);

  if (!role) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Role hanya boleh ADMIN atau STAFF.',
      400
    );
  }

  if (email && !isValidEmail_(email)) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Format email tidak valid.',
      400
    );
  }

  var sheet = getSheet_(SHEETS.USERS);
  var rows = getRowsAsObjects_(sheet);

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].userId) !== userId &&
        String(rows[i].username || '').trim().toLowerCase() === username.toLowerCase()) {
      throw createApiError_(
        'DUPLICATE',
        'Username sudah digunakan.',
        409
      );
    }
  }

  if (!userId) {
    if (password.length < 8) {
      throw createApiError_(
        'VALIDATION_ERROR',
        'Password user baru minimal 8 karakter.',
        400
      );
    }

    var passwordData = hashPassword_(password);
    var now = nowIso_();

    var user = {
      userId: Utilities.getUuid(),
      username: username,
      name: name,
      email: email,
      role: role,
      department: department,
      passwordSalt: passwordData.salt,
      passwordHash: passwordData.hash,
      active: active,
      createdAt: now,
      updatedAt: now
    };

    appendObjectRow_(sheet, HEADERS[SHEETS.USERS], user);
    clearLoginUserCache_(user.username);

    return {
      item: sanitizeUser_(user)
    };
  }

  var rowNumber = findRowById_(sheet, 'userId', userId);
  if (rowNumber < 0) {
    throw createApiError_(
      'NOT_FOUND',
      'User tidak ditemukan.',
      404
    );
  }

  var existing = getObjectByRow_(sheet, rowNumber);
  var existingUsername = String(existing.username || '');

  if (String(existing.userId) === String(currentUser.userId) &&
      active === false) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Admin yang sedang login tidak boleh menonaktifkan akunnya sendiri.',
      400
    );
  }

  setCellByHeader_(sheet, rowNumber, 'username', username);
  setCellByHeader_(sheet, rowNumber, 'name', name);
  setCellByHeader_(sheet, rowNumber, 'email', email);
  setCellByHeader_(sheet, rowNumber, 'role', role);
  setCellByHeader_(sheet, rowNumber, 'department', department);
  setCellByHeader_(sheet, rowNumber, 'active', active);

  if (password) {
    if (password.length < 8) {
      throw createApiError_(
        'VALIDATION_ERROR',
        'Password minimal 8 karakter.',
        400
      );
    }

    var newPasswordData = hashPassword_(password);
    setCellByHeader_(sheet, rowNumber, 'passwordSalt', newPasswordData.salt);
    setCellByHeader_(sheet, rowNumber, 'passwordHash', newPasswordData.hash);
  }

  setCellByHeader_(sheet, rowNumber, 'updatedAt', nowIso_());
  clearLoginUserCache_(existingUsername);
  clearLoginUserCache_(username);

  return {
    item: sanitizeUser_(getObjectByRow_(sheet, rowNumber))
  };
}

function changePassword_(data, user) {
  var currentPassword = String(data.currentPassword || '');
  var newPassword = String(data.newPassword || '');

  if (!currentPassword) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Password lama wajib diisi.',
      400
    );
  }

  if (newPassword.length < 8) {
    throw createApiError_(
      'VALIDATION_ERROR',
      'Password baru minimal 8 karakter.',
      400
    );
  }

  var sheet = getSheet_(SHEETS.USERS);
  var rowNumber = findRowById_(sheet, 'userId', String(user.userId));

  if (rowNumber < 0) {
    throw createApiError_(
      'NOT_FOUND',
      'User tidak ditemukan.',
      404
    );
  }

  var existing = getObjectByRow_(sheet, rowNumber);

  var oldHash = sha256Hex_(
    String(existing.passwordSalt || '') + ':' + currentPassword
  );

  if (oldHash !== String(existing.passwordHash || '')) {
    throw createApiError_(
      'UNAUTHORIZED',
      'Password lama salah.',
      401
    );
  }

  var passwordData = hashPassword_(newPassword);

  setCellByHeader_(sheet, rowNumber, 'passwordSalt', passwordData.salt);
  setCellByHeader_(sheet, rowNumber, 'passwordHash', passwordData.hash);
  setCellByHeader_(sheet, rowNumber, 'updatedAt', nowIso_());
  clearLoginUserCache_(existing.username);

  return {
    changed: true
  };
}

/* --------------------------- Authentication -------------------------- */

function handleLogout_(user) {
  var token = user && user.token ? String(user.token) : '';
  if (token) {
    PropertiesService.getScriptProperties()
      .deleteProperty(SESSION_PREFIX + token);
  }

  return {
    loggedOut: true
  };
}

function handleMe_(user) {
  return {
    user: sanitizeSessionUser_(user),
    expiresAt: user.expiresAt
  };
}

function enforceLoginRateLimit_(username) {
  var props = PropertiesService.getScriptProperties();
  var key = LOGIN_FAILURE_PREFIX + username.toLowerCase();
  var raw = props.getProperty(key);

  if (!raw) {
    return;
  }

  var item;
  try {
    item = JSON.parse(raw);
  } catch (err) {
    props.deleteProperty(key);
    return;
  }

  var now = new Date().getTime();

  if (!item.startedAt ||
      now - item.startedAt > LOGIN_WINDOW_SECONDS * 1000) {
    props.deleteProperty(key);
    return;
  }

  if (Number(item.count || 0) >= LOGIN_MAX_FAILURES) {
    throw createApiError_(
      'RATE_LIMITED',
      'Terlalu banyak percobaan login. Coba lagi setelah beberapa menit.',
      429
    );
  }
}

function recordLoginFailure_(username) {
  var props = PropertiesService.getScriptProperties();
  var key = LOGIN_FAILURE_PREFIX + username.toLowerCase();
  var raw = props.getProperty(key);

  var item = {
    count: 0,
    startedAt: new Date().getTime()
  };

  if (raw) {
    try {
      item = JSON.parse(raw);
    } catch (err) {
      item = {
        count: 0,
        startedAt: new Date().getTime()
      };
    }
  }

  var now = new Date().getTime();

  if (!item.startedAt ||
      now - item.startedAt > LOGIN_WINDOW_SECONDS * 1000) {
    item.count = 0;
    item.startedAt = now;
  }

  item.count = Number(item.count || 0) + 1;
  props.setProperty(key, JSON.stringify(item));
}

function clearLoginFailures_(username) {
  PropertiesService.getScriptProperties()
    .deleteProperty(LOGIN_FAILURE_PREFIX + username.toLowerCase());
}

/* ------------------------------- Helpers ------------------------------ */

function requireAdminUser_(user) {
  if (!user || normalizeRole_(user.role) !== 'ADMIN') {
    throw createApiError_(
      'FORBIDDEN',
      'Aksi ini hanya dapat dilakukan oleh ADMIN.',
      403
    );
  }
}

function sanitizeSessionUser_(user) {
  return {
    userId: String(user.userId || ''),
    username: String(user.username || ''),
    name: String(user.name || ''),
    role: normalizeRole_(user.role),
    department: String(user.department || ''),
    publicStaff: user && user.publicStaff === true
  };
}

function sanitizeUser_(user) {
  return {
    userId: String(user.userId || ''),
    username: String(user.username || ''),
    name: String(user.name || ''),
    email: String(user.email || ''),
    role: normalizeRole_(user.role),
    department: String(user.department || ''),
    active: toBoolean_(user.active),
    createdAt: String(user.createdAt || ''),
    updatedAt: String(user.updatedAt || '')
  };
}

function sanitizeSupplier_(supplier) {
  return {
    supplierId: String(supplier.supplierId || ''),
    code: String(supplier.code || ''),
    name: String(supplier.name || ''),
    pic: String(supplier.pic || ''),
    phone: String(supplier.phone || ''),
    email: String(supplier.email || ''),
    address: String(supplier.address || ''),
    active: toBoolean_(supplier.active),
    createdAt: String(supplier.createdAt || ''),
    updatedAt: String(supplier.updatedAt || '')
  };
}

function sanitizeProduct_(product) {
  return {
    productId: String(product.productId || ''),
    sku: String(product.sku || ''),
    barcode: String(product.barcode || ''),
    name: String(product.name || ''),
    categoryId: String(product.categoryId || ''),
    unit: String(product.unit || ''),
    minStock: toNumber_(product.minStock),
    maxStock: toNumber_(product.maxStock),
    currentStock: toNumber_(product.currentStock),
    price: toNumber_(product.price),
    supplierId: String(product.supplierId || ''),
    location: String(product.location || ''),
    active: toBoolean_(product.active),
    createdAt: String(product.createdAt || ''),
    updatedAt: String(product.updatedAt || '')
  };
}

function appendObjectRow_(sheet, headers, object) {
  var values = [];

  for (var i = 0; i < headers.length; i++) {
    values.push(object[headers[i]] === undefined ? '' : object[headers[i]]);
  }

  sheet.getRange(
    sheet.getLastRow() + 1,
    1,
    1,
    headers.length
  ).setValues([values]);
}

function getObjectByRow_(sheet, rowNumber) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  var item = {};

  for (var i = 0; i < headers.length; i++) {
    item[String(headers[i])] = values[i];
  }

  return item;
}

function setCellByHeader_(sheet, rowNumber, headerName, value) {
  var index = getHeaderIndex_(sheet, headerName);
  sheet.getRange(rowNumber, index + 1).setValue(value);
}

function normalizeText_(value, maxLength) {
  var text = String(value === undefined || value === null ? '' : value).trim();

  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength);
  }

  return text;
}

function normalizeName_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeCode_(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toUpperCase();
}

function normalizeUsername_(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase();
}

function validateTextLength_(value, label, minLength, maxLength) {
  var text = String(value || '');

  if (text.length < minLength) {
    throw createApiError_(
      'VALIDATION_ERROR',
      label + ' wajib diisi.',
      400
    );
  }

  if (maxLength && text.length > maxLength) {
    throw createApiError_(
      'VALIDATION_ERROR',
      label + ' terlalu panjang.',
      400
    );
  }
}

function toNumber_(value) {
  var n = Number(value);
  return isFinite(n) ? n : 0;
}

function toNonNegativeNumber_(value, label) {
  var raw = value;

  if (raw === '' || raw === null || raw === undefined) {
    throw createApiError_(
      'VALIDATION_ERROR',
      label + ' wajib diisi.',
      400
    );
  }

  var n = Number(raw);

  if (!isFinite(n) || n < 0) {
    throw createApiError_(
      'VALIDATION_ERROR',
      label + ' harus berupa angka >= 0.',
      400
    );
  }

  return n;
}

function toBoolean_(value) {
  if (value === true) {
    return true;
  }

  var text = String(value || '').toLowerCase().trim();
  return text === 'true' || text === '1' || text === 'yes';
}

function normalizeRole_(role) {
  var normalized = String(role || '').trim().toUpperCase();

  if (normalized !== 'ADMIN' && normalized !== 'STAFF') {
    return '';
  }

  return normalized;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createApiError_(code, message, status) {
  var err = new Error(message);
  err.apiCode = code;
  err.httpStatus = status;
  return err;
}

function handleApiError_(err) {
  var code = err && err.apiCode ? err.apiCode : 'SERVER_ERROR';
  var message = err && err.message
    ? err.message
    : 'Terjadi kesalahan pada server.';
  var status = err && err.httpStatus ? err.httpStatus : 500;

  return jsonError_(code, message, status);
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(code, message, status) {
  return jsonOutput_({
    ok: false,
    error: {
      code: code,
      message: message,
      status: status
    }
  });
}


/* ============================ FINAL BUSINESS ========================= */

function lockRun_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function requireAdminFinal_(user) {
  if (!user || String(user.role || '').toUpperCase() !== 'ADMIN') {
    throw createApiError_('FORBIDDEN', 'Aksi ini hanya dapat dilakukan oleh ADMIN.', 403);
  }
}

function requireStaffFinal_(user) {
  if (!user || String(user.role || '').toUpperCase() !== 'STAFF') {
    throw createApiError_('FORBIDDEN', 'Aksi ini hanya dapat dilakukan oleh STAFF.', 403);
  }
}

function nextDocumentNoFinal_(prefix) {
  var ym = Utilities.formatDate(new Date(), DATABASE_TIMEZONE, 'yyyyMM');
  var key = 'DOC_' + prefix + '_' + ym;
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty(key) || '0') + 1;
  props.setProperty(key, String(n));
  return String(prefix) + '-' + ym + '-' + ('0000' + n).slice(-4);
}

function objectRowsById_(sheet, field, value) {
  var rows = getRowsAsObjects_(sheet);
  return rows.filter(function(row) { return String(row[field]) === String(value); });
}

function rowObjectByIdFinal_(sheet, field, value) {
  var rowNo = findRowById_(sheet, field, value);
  if (rowNo < 0) return null;
  return getObjectByRow_(sheet, rowNo);
}

function setFieldFinal_(sheet, rowNo, field, value) {
  var idx = getHeaderIndex_(sheet, field);
  sheet.getRange(rowNo, idx + 1).setValue(value);
}

function appendRowsFinal_(sheet, headers, rows) {
  if (!rows.length) return;
  var values = rows.map(function(row) {
    return headers.map(function(h) { return row[h] === undefined ? '' : row[h]; });
  });
  sheet.getRange(sheet.getLastRow()+1,1,values.length,headers.length).setValues(values);
}

function receiveStockFinal_(data, user) {
  requireAdminFinal_(user);
  return lockRun_(function () {
    var productId = String(data.productId || '').trim();
    var qty = Number(data.qty);
    var supplierId = String(data.supplierId || '').trim();
    var poId = String(data.poId || '').trim();
    var documentNo = String(data.documentNo || '').trim();
    var note = String(data.note || '').trim();
    var receiptDate = normalizeDateFinal_(data.receiptDate);

    if (!productId || !isFinite(qty) || qty <= 0) {
      throw createApiError_('VALIDATION_ERROR','Product dan Qty > 0 wajib diisi.',400);
    }

    if (supplierId) {
      var supplierRows = getRowsAsObjects_(getSheet_(SHEETS.SUPPLIERS));
      var supplier = supplierRows.find(function (row) {
        return String(row.supplierId) === supplierId;
      });
      if (!supplier || !toBoolean_(supplier.active)) {
        throw createApiError_('VALIDATION_ERROR','Supplier tidak valid atau tidak aktif.',400);
      }
    }

    var ps = getSheet_(SHEETS.PRODUCTS);
    var prow = findRowById_(ps,'productId',productId);
    if (prow < 0) throw createApiError_('NOT_FOUND','Barang tidak ditemukan.',404);

    var product = getObjectByRow_(ps,prow);
    if (!toBoolean_(product.active)) throw createApiError_('VALIDATION_ERROR','Barang tidak aktif.',400);

    var before = toNonNegativeNumber_(product.currentStock,'Current Stock');
    var after = before + qty;
    var now = nowIso_();
    var receiptId = Utilities.getUuid();
    var receiptNo = nextDocumentNoFinal_('GR');

    var receipt = {
      receiptId: receiptId,
      receiptNo: receiptNo,
      receiptDate: receiptDate,
      supplierId: supplierId,
      poId: poId,
      documentNo: documentNo,
      note: note,
      createdBy: String(user.name || user.username),
      createdAt: now
    };

    var movement = {
      movementId: Utilities.getUuid(),
      movementDate: receiptDate,
      productId: productId,
      sku: String(product.sku || ''),
      productName: String(product.name || ''),
      type: 'IN',
      qty: qty,
      stockBefore: before,
      stockAfter: after,
      referenceType: 'STOCK_RECEIPT',
      referenceId: receiptId,
      userId: String(user.userId),
      userName: String(user.name || user.username),
      note: note,
      createdAt: now
    };

    appendObjectRow_(getSheet_(SHEETS.STOCK_RECEIPTS),HEADERS[SHEETS.STOCK_RECEIPTS],receipt);
    setFieldFinal_(ps,prow,'currentStock',after);
    setFieldFinal_(ps,prow,'updatedAt',now);
    appendObjectRow_(getSheet_(SHEETS.STOCK_MOVEMENTS),HEADERS[SHEETS.STOCK_MOVEMENTS],movement);

    return {
      receipt: receipt,
      movement: movement,
      product: sanitizeProduct_(getObjectByRow_(ps,prow))
    };
  });
}

function listMovementsFinal_(data) {
  var from=normalizeDateOptionalFinal_(data.dateFrom),to=normalizeDateOptionalFinal_(data.dateTo),sku=String(data.sku||'').toLowerCase(),name=String(data.productName||'').toLowerCase(),type=String(data.type||'').toUpperCase();
  var rows=getRowsAsObjects_(getSheet_(SHEETS.STOCK_MOVEMENTS));
  var items=[];
  rows.forEach(function(row){
    var d=dateOnlyFinal_(row.movementDate);
    if(from&&d&&d<from)return;if(to&&d&&d>to)return;if(from&&!d)return;if(to&&!d)return;
    if(sku&&String(row.sku||'').toLowerCase().indexOf(sku)<0)return;if(name&&String(row.productName||'').toLowerCase().indexOf(name)<0)return;if(type&&String(row.type||'').toUpperCase()!==type)return;
    items.push(sanitizeMovementFinal_(row));
  });
  items.sort(function(a,c){return String(c.createdAt).localeCompare(String(a.createdAt));});
  return {items:items};
}

function adjustStockFinal_(data,user){
  requireAdminFinal_(user);
  return lockRun_(function(){
    var productId=String(data.productId||'').trim(),physical=Number(data.physicalStock),reason=String(data.reason||'').trim(),mode=String(data.mode||'ADJUSTMENT').toUpperCase();
    if(!productId||!isFinite(physical)||physical<0||!reason)throw createApiError_('VALIDATION_ERROR','Produk, Physical Stock, dan alasan wajib diisi.',400);
    if(mode!=='ADJUSTMENT'&&mode!=='OPNAME')mode='ADJUSTMENT';
    var ps=getSheet_(SHEETS.PRODUCTS),ms=getSheet_(SHEETS.STOCK_MOVEMENTS),as=getSheet_(SHEETS.STOCK_ADJUSTMENTS),pr=findRowById_(ps,'productId',productId);
    if(pr<0)throw createApiError_('NOT_FOUND','Barang tidak ditemukan.',404);
    var p=getObjectByRow_(ps,pr),before=toNumber_(p.currentStock),diff=physical-before;
    if(diff===0)throw createApiError_('VALIDATION_ERROR','Tidak ada selisih stok.',400);
    var now=nowIso_(),id=Utilities.getUuid(),no=nextDocumentNoFinal_(mode==='OPNAME'?'OPN':'ADJ'),date=normalizeDateFinal_(data.adjustmentDate);
    var adjustment={adjustmentId:id,adjustmentNo:no,adjustmentDate:date,productId:productId,sku:String(p.sku||''),productName:String(p.name||''),systemStock:before,physicalStock:physical,difference:diff,reason:reason,createdBy:String(user.name||user.username),createdAt:now};
    appendObjectRow_(as,HEADERS[SHEETS.STOCK_ADJUSTMENTS],adjustment);setFieldFinal_(ps,pr,'currentStock',physical);setFieldFinal_(ps,pr,'updatedAt',now);
    var mv={movementId:Utilities.getUuid(),movementDate:date,productId:productId,sku:String(p.sku||''),productName:String(p.name||''),type:mode,qty:diff,stockBefore:before,stockAfter:physical,referenceType:'STOCK_ADJUSTMENT',referenceId:id,userId:String(user.userId),userName:String(user.name||user.username),note:reason,createdAt:now};
    appendObjectRow_(ms,HEADERS[SHEETS.STOCK_MOVEMENTS],mv);
    return {adjustment:adjustment,movement:mv,product:sanitizeProduct_(getObjectByRow_(ps,pr))};
  });
}

function createRequestFinal_(data,user){
  requireStaffFinal_(user);
  return lockRun_(function(){
    var items=Array.isArray(data.items)?data.items:[];if(!items.length)throw createApiError_('VALIDATION_ERROR','Minimal satu item wajib diisi.',400);
    var ps=getSheet_(SHEETS.PRODUCTS),rs=getSheet_(SHEETS.REQUESTS),is=getSheet_(SHEETS.REQUEST_ITEMS),products=getRowsAsObjects_(ps),seen={};
    var reqId=Utilities.getUuid(),reqNo=nextDocumentNoFinal_('REQ'),now=nowIso_(),req={requestId:reqId,requestNo:reqNo,requestDate:normalizeDateFinal_(data.requestDate),staffId:String(user.userId),staffName:String(user.name||user.username),department:String(user.department||''),status:'MENUNGGU',rejectionReason:'',approvedBy:'',approvedAt:'',rejectedBy:'',rejectedAt:'',createdAt:now,updatedAt:now};
    var out=[];
    items.forEach(function(it){
      var pid=String(it.productId||'').trim(),qty=Number(it.qtyRequested);if(!pid||!isFinite(qty)||qty<=0)throw createApiError_('VALIDATION_ERROR','Item pengajuan tidak valid.',400);if(seen[pid])throw createApiError_('VALIDATION_ERROR','Produk yang sama tidak boleh dua kali.',400);seen[pid]=1;
      var p=products.find(function(x){return String(x.productId)===pid;});if(!p)throw createApiError_('NOT_FOUND','Barang pengajuan tidak ditemukan.',404);if(!toBoolean_(p.active))throw createApiError_('VALIDATION_ERROR','Barang tidak aktif: '+p.name,400);
      out.push({requestItemId:Utilities.getUuid(),requestId:reqId,productId:pid,sku:String(p.sku||''),productName:String(p.name||''),unit:String(p.unit||''),qtyRequested:qty,qtyApproved:0,stockAtRequest:toNumber_(p.currentStock),note:String(it.note||'')});
    });
    appendObjectRow_(rs,HEADERS[SHEETS.REQUESTS],req);appendRowsFinal_(is,HEADERS[SHEETS.REQUEST_ITEMS],out);return {request:req,items:out};
  });
}

function samePublicStaffIdentityFinal_(row, user){
  if (!user || user.publicStaff !== true) return false;
  if (String(row.staffId || '') === String(user.userId || '')) return true;
  var rowName=String(row.staffName||'').trim().toLowerCase();
  var rowDept=String(row.department||'').trim().toLowerCase();
  var userName=String(user.name||'').trim().toLowerCase();
  var userDept=String(user.department||'').trim().toLowerCase();
  return rowName && userName && rowName===userName && rowDept===userDept;
}

function buildRequestListFinal_(data,user,allForPrint){
  var role=String(user.role||'').toUpperCase(),from=normalizeDateOptionalFinal_(data.dateFrom),to=normalizeDateOptionalFinal_(data.dateTo),status=String(data.status||'').toUpperCase();
  var rs=getRowsAsObjects_(getSheet_(SHEETS.REQUESTS)),is=getRowsAsObjects_(getSheet_(SHEETS.REQUEST_ITEMS)),items=[];
  rs.forEach(function(r){
    var d=dateOnlyFinal_(r.requestDate)||String(r.requestDate||'').slice(0,10);
    if(!allForPrint&&role==='STAFF'&&!samePublicStaffIdentityFinal_(r,user))return;
    if(from&&(!d||d<from))return;
    if(to&&(!d||d>to))return;
    if(status&&String(r.status||'').toUpperCase()!==status)return;
    items.push({request:sanitizeRequestFinal_(r),items:is.filter(function(x){return String(x.requestId)===String(r.requestId);}).map(sanitizeRequestItemFinal_)});
  });
  items.sort(function(a,b){return String(b.request.createdAt||'').localeCompare(String(a.request.createdAt||''))||String(b.request.requestNo||'').localeCompare(String(a.request.requestNo||''));});
  return {items:items};
}

function listRequestsFinal_(data,user){
  return buildRequestListFinal_(data,user,false);
}

function listPrintableRequestsFinal_(data,user){
  if (!user || (String(user.role||'').toUpperCase()!=='STAFF' && String(user.role||'').toUpperCase()!=='ADMIN')) {
    throw createApiError_('FORBIDDEN','Mode Staff atau Admin diperlukan.',403);
  }
  return buildRequestListFinal_(data,user,true);
}

function approveRequestFinal_(data, user) {
  requireAdminFinal_(user);
  return lockRun_(function () {
    var rid = String(data.requestId || '').trim();
    var approvalItems = Array.isArray(data.items) ? data.items : [];
    if (!rid) throw createApiError_('VALIDATION_ERROR','requestId wajib diisi.',400);

    var rs = getSheet_(SHEETS.REQUESTS);
    var is = getSheet_(SHEETS.REQUEST_ITEMS);
    var ps = getSheet_(SHEETS.PRODUCTS);
    var rr = findRowById_(rs,'requestId',rid);
    if (rr < 0) throw createApiError_('NOT_FOUND','Pengajuan tidak ditemukan.',404);

    var req = getObjectByRow_(rs,rr);
    if (String(req.status) !== 'MENUNGGU') {
      throw createApiError_('VALIDATION_ERROR','Pengajuan sudah diproses dan tidak dapat diproses ulang.',400);
    }

    var all = getRowsAsObjects_(is).filter(function (x) { return String(x.requestId) === rid; });
    if (!all.length) throw createApiError_('VALIDATION_ERROR','Pengajuan tidak memiliki item.',400);

    var map = {};
    approvalItems.forEach(function (x) {
      var itemId = String(x.requestItemId || '').trim();
      if (!itemId) throw createApiError_('VALIDATION_ERROR','requestItemId wajib diisi.',400);
      var q = Number(x.qtyApproved);
      if (!isFinite(q) || q < 0) throw createApiError_('VALIDATION_ERROR','Qty Approved tidak valid.',400);
      if (map[itemId] !== undefined) throw createApiError_('VALIDATION_ERROR','Request item duplicate.',400);
      map[itemId] = q;
    });

    var totalReq = 0;
    var totalApp = 0;
    var changes = [];
    var now = nowIso_();

    /* First pass: validate every line against the latest stock.
       No database write happens before all lines are valid. */
    all.forEach(function (it) {
      var itemId = String(it.requestItemId);
      var q = map[itemId];
      if (q === undefined) q = 0;

      var reqQty = Number(it.qtyRequested);
      if (!isFinite(reqQty) || reqQty < 0) {
        throw createApiError_('VALIDATION_ERROR','Qty Requested tidak valid.',400);
      }
      if (q > reqQty) {
        throw createApiError_('VALIDATION_ERROR','Qty Approved melebihi Qty Requested.',400);
      }

      var productRow = findRowById_(ps,'productId',String(it.productId));
      if (productRow < 0) {
        throw createApiError_('NOT_FOUND','Barang pengajuan tidak ditemukan.',404);
      }

      var product = getObjectByRow_(ps,productRow);
      var stock = toNonNegativeNumber_(product.currentStock,'Current Stock');
      if (q > stock) {
        throw createApiError_('VALIDATION_ERROR','Stok terbaru tidak cukup untuk '+String(product.name||it.productName)+'. Stok: '+stock,400);
      }

      totalReq += reqQty;
      totalApp += q;
      changes.push({ item: it, itemId: itemId, qty: q, productRow: productRow, product: product, stockBefore: stock });
    });

    if (totalApp <= 0) {
      throw createApiError_('VALIDATION_ERROR','Minimal satu item harus disetujui > 0.',400);
    }

    var status = totalApp >= totalReq ? 'DISETUJUI_PENUH' : 'DISETUJUI_SEBAGIAN';
    var movements = [];

    /* Second pass: apply all validated changes. */
    changes.forEach(function (change) {
      var itemRow = findRowById_(is,'requestItemId',change.itemId);
      if (itemRow < 0) throw createApiError_('SERVER_ERROR','Request item tidak ditemukan.',500);

      setFieldFinal_(is,itemRow,'qtyApproved',change.qty);

      if (change.qty > 0) {
        var after = change.stockBefore - change.qty;
        setFieldFinal_(ps,change.productRow,'currentStock',after);
        setFieldFinal_(ps,change.productRow,'updatedAt',now);

        movements.push({
          movementId: Utilities.getUuid(),
          movementDate: String(req.requestDate),
          productId: String(change.item.productId),
          sku: String(change.product.sku || change.item.sku || ''),
          productName: String(change.product.name || change.item.productName || ''),
          type: 'OUT',
          qty: -change.qty,
          stockBefore: change.stockBefore,
          stockAfter: after,
          referenceType: 'REQUEST',
          referenceId: rid,
          userId: String(user.userId),
          userName: String(user.name || user.username),
          note: 'Approval ' + String(req.requestNo),
          createdAt: now
        });
      }
    });

    appendRowsFinal_(getSheet_(SHEETS.STOCK_MOVEMENTS),HEADERS[SHEETS.STOCK_MOVEMENTS],movements);
    setFieldFinal_(rs,rr,'status',status);
    setFieldFinal_(rs,rr,'approvedBy',String(user.name || user.username));
    setFieldFinal_(rs,rr,'approvedAt',now);
    setFieldFinal_(rs,rr,'updatedAt',now);

    return {
      request: sanitizeRequestFinal_(getObjectByRow_(rs,rr)),
      movementCount: movements.length
    };
  });
}

function rejectRequestFinal_(data,user){
  requireAdminFinal_(user);return lockRun_(function(){var rid=String(data.requestId||'').trim(),reason=String(data.rejectionReason||'').trim();if(!rid||!reason)throw createApiError_('VALIDATION_ERROR','Request dan alasan reject wajib.',400);var s=getSheet_(SHEETS.REQUESTS),r=findRowById_(s,'requestId',rid);if(r<0)throw createApiError_('NOT_FOUND','Pengajuan tidak ditemukan.',404);var cur=getObjectByRow_(s,r);if(cur.status!=='MENUNGGU')throw createApiError_('VALIDATION_ERROR','Pengajuan sudah diproses.',400);var now=nowIso_();setFieldFinal_(s,r,'status','DITOLAK');setFieldFinal_(s,r,'rejectionReason',reason);setFieldFinal_(s,r,'rejectedBy',String(user.name||user.username));setFieldFinal_(s,r,'rejectedAt',now);setFieldFinal_(s,r,'updatedAt',now);return {request:sanitizeRequestFinal_(getObjectByRow_(s,r))};});
}

function editRejectedRequestFinal_(data,user){
  var role=String(user&&user.role||'').toUpperCase();
  if(role!=='ADMIN'&&role!=='STAFF')throw createApiError_('FORBIDDEN','Mode Staff atau Admin diperlukan.',403);
  return lockRun_(function(){
    var rid=String(data.requestId||'').trim(),items=Array.isArray(data.items)?data.items:[],date=String(data.requestDate||'').trim();
    if(!rid||!date||!items.length)throw createApiError_('VALIDATION_ERROR','Request, tanggal, dan minimal satu item wajib diisi.',400);
    var rs=getSheet_(SHEETS.REQUESTS),is=getSheet_(SHEETS.REQUEST_ITEMS),ps=getSheet_(SHEETS.PRODUCTS);
    var rr=findRowById_(rs,'requestId',rid);
    if(rr<0)throw createApiError_('NOT_FOUND','Pengajuan tidak ditemukan.',404);
    var req=getObjectByRow_(rs,rr);
    if(String(req.status||'')!=='DITOLAK')throw createApiError_('VALIDATION_ERROR','Hanya pengajuan yang DITOLAK yang dapat diedit.',400);
    if(role==='STAFF'&&!samePublicStaffIdentityFinal_(req,user))throw createApiError_('FORBIDDEN','Bukan pengajuan milik Anda.',403);

    var products=getRowsAsObjects_(ps),seen={},out=[];
    items.forEach(function(it){
      var pid=String(it.productId||'').trim(),qty=Number(it.qtyRequested);
      if(!pid||!isFinite(qty)||qty<=0)throw createApiError_('VALIDATION_ERROR','Item pengajuan tidak valid.',400);
      if(seen[pid])throw createApiError_('VALIDATION_ERROR','Produk yang sama tidak boleh dua kali.',400);
      seen[pid]=1;
      var prod=products.find(function(x){return String(x.productId)===pid;});
      if(!prod)throw createApiError_('NOT_FOUND','Barang pengajuan tidak ditemukan.',404);
      if(!toBoolean_(prod.active))throw createApiError_('VALIDATION_ERROR','Barang tidak aktif: '+String(prod.name||''),400);
      out.push({requestItemId:Utilities.getUuid(),requestId:rid,productId:pid,sku:String(prod.sku||''),productName:String(prod.name||''),unit:String(prod.unit||''),qtyRequested:qty,qtyApproved:0,stockAtRequest:toNumber_(prod.currentStock),note:String(it.note||'')});
    });

    var existing=getRowsAsObjects_(is),rows=[];
    for(var i=0;i<existing.length;i++)if(String(existing[i].requestId)===rid)rows.push(i+2);
    rows.sort(function(a,b){return b-a;});
    var now=nowIso_();
    // Rebuild only this request's item rows. No stock is changed by an edit.
    rows.forEach(function(rowNum){is.deleteRow(rowNum);});
    appendRowsFinal_(is,HEADERS[SHEETS.REQUEST_ITEMS],out);
    setFieldFinal_(rs,rr,'requestDate',normalizeDateFinal_(date));
    setFieldFinal_(rs,rr,'status','MENUNGGU');
    setFieldFinal_(rs,rr,'rejectionReason','');
    setFieldFinal_(rs,rr,'rejectedBy','');
    setFieldFinal_(rs,rr,'rejectedAt','');
    setFieldFinal_(rs,rr,'approvedBy','');
    setFieldFinal_(rs,rr,'approvedAt','');
    setFieldFinal_(rs,rr,'updatedAt',now);
    return {request:sanitizeRequestFinal_(getObjectByRow_(rs,rr)),items:out};
  });
}

function cancelRequestFinal_(data,user){
  requireStaffFinal_(user);return lockRun_(function(){var rid=String(data.requestId||'').trim(),s=getSheet_(SHEETS.REQUESTS),r=findRowById_(s,'requestId',rid);if(r<0)throw createApiError_('NOT_FOUND','Pengajuan tidak ditemukan.',404);var cur=getObjectByRow_(s,r);if(String(cur.staffId)!==String(user.userId)&&!samePublicStaffIdentityFinal_(cur,user))throw createApiError_('FORBIDDEN','Bukan pengajuan milik Anda.',403);if(cur.status!=='MENUNGGU')throw createApiError_('VALIDATION_ERROR','Hanya status MENUNGGU yang dapat dibatalkan.',400);setFieldFinal_(s,r,'status','DIBATALKAN');setFieldFinal_(s,r,'updatedAt',nowIso_());return {request:sanitizeRequestFinal_(getObjectByRow_(s,r))};});
}

function reorderRecommendationsFinal_(){
  var products=getRowsAsObjects_(getSheet_(SHEETS.PRODUCTS)),pos=getRowsAsObjects_(getSheet_(SHEETS.PURCHASE_ORDERS)),pis=getRowsAsObjects_(getSheet_(SHEETS.PURCHASE_ITEMS)),eligible={};pos.forEach(function(p){if(['DRAFT','ORDERED','PARTIAL'].indexOf(String(p.status))>=0)eligible[String(p.poId)]=1;});var out={};pis.forEach(function(x){if(!eligible[String(x.poId)])return;var rem=Math.max(0,Number(x.qtyOrdered||0)-Number(x.qtyReceived||0));out[String(x.productId)]=(out[String(x.productId)]||0)+rem;});var items=[];products.forEach(function(p){if(!toBoolean_(p.active))return;var stock=Number(p.currentStock||0),min=Number(p.minStock||0),max=Number(p.maxStock||0);if(stock>min)return;var outstanding=out[String(p.productId)]||0;items.push({productId:String(p.productId),sku:String(p.sku||''),productName:String(p.name||''),unit:String(p.unit||''),minStock:min,maxStock:max,currentStock:stock,outstandingOrder:outstanding,recommendedQty:Math.max(0,max-stock-outstanding),price:Number(p.price||0),supplierId:String(p.supplierId||''),location:String(p.location||'')});});items.sort(function(a,b){return b.recommendedQty-a.recommendedQty||a.sku.localeCompare(b.sku);});return {items:items};
}

function createPurchaseOrderFinal_(data,user){
  requireAdminFinal_(user);return lockRun_(function(){var sid=String(data.supplierId||'').trim(),items=Array.isArray(data.items)?data.items:[];if(!sid||!items.length)throw createApiError_('VALIDATION_ERROR','Supplier dan minimal satu item wajib.',400);var ss=getRowsAsObjects_(getSheet_(SHEETS.SUPPLIERS));var supplier=ss.find(function(x){return String(x.supplierId)===sid;});if(!supplier||!toBoolean_(supplier.active))throw createApiError_('VALIDATION_ERROR','Supplier tidak valid atau tidak aktif.',400);var ps=getSheet_(SHEETS.PRODUCTS),pos=getSheet_(SHEETS.PURCHASE_ORDERS),pis=getSheet_(SHEETS.PURCHASE_ITEMS),prod=getRowsAsObjects_(ps),seen={},out=[],total=0;items.forEach(function(x){var pid=String(x.productId||''),q=Number(x.qtyOrdered),price=Number(x.price);if(seen[pid])throw createApiError_('VALIDATION_ERROR','Produk duplicate dalam PO.',400);seen[pid]=1;if(!isFinite(q)||q<=0||!isFinite(price)||price<0)throw createApiError_('VALIDATION_ERROR','Qty/Harga PO tidak valid.',400);var p=prod.find(function(z){return String(z.productId)===pid;});if(!p)throw createApiError_('NOT_FOUND','Produk PO tidak ditemukan.',404);var sub=q*price;total+=sub;out.push({poItemId:Utilities.getUuid(),poId:'',productId:pid,sku:String(p.sku||''),productName:String(p.name||''),unit:String(p.unit||''),qtyOrdered:q,qtyReceived:0,qtyRemaining:q,price:price,subtotal:sub});});var poId=Utilities.getUuid(),po={poId:poId,poNo:nextDocumentNoFinal_('PO'),supplierId:sid,supplierName:String(supplier.name),orderDate:normalizeDateFinal_(data.orderDate),status:'DRAFT',totalAmount:total,createdBy:String(user.name||user.username),createdAt:nowIso_(),updatedAt:nowIso_()};out.forEach(function(x){x.poId=poId;});appendObjectRow_(pos,HEADERS[SHEETS.PURCHASE_ORDERS],po);appendRowsFinal_(pis,HEADERS[SHEETS.PURCHASE_ITEMS],out);return {purchaseOrder:po,items:out};});
}

function updatePurchaseOrderStatusFinal_(data,user){
  requireAdminFinal_(user);
  return lockRun_(function(){
    var poId=String(data.poId||'').trim(),status=String(data.status||'').toUpperCase();
    if(!poId||['ORDERED','CANCELLED'].indexOf(status)<0)throw createApiError_('VALIDATION_ERROR','PO dan status tujuan tidak valid.',400);
    var sheet=getSheet_(SHEETS.PURCHASE_ORDERS),row=findRowById_(sheet,'poId',poId);
    if(row<0)throw createApiError_('NOT_FOUND','PO tidak ditemukan.',404);
    var po=getObjectByRow_(sheet,row),current=String(po.status||'').toUpperCase();
    if(status==='ORDERED'&&current!=='DRAFT')throw createApiError_('VALIDATION_ERROR','Hanya PO DRAFT yang dapat ditandai ORDERED.',400);
    if(status==='CANCELLED'&&['DRAFT','ORDERED','PARTIAL'].indexOf(current)<0)throw createApiError_('VALIDATION_ERROR','PO ini tidak dapat dibatalkan.',400);
    var now=nowIso_();setFieldFinal_(sheet,row,'status',status);setFieldFinal_(sheet,row,'updatedAt',now);
    return {purchaseOrder:sanitizePurchaseOrderFinal_(getObjectByRow_(sheet,row))};
  });
}

function listPurchaseOrdersFinal_(data){var status=String(data.status||'').toUpperCase(),from=normalizeDateOptionalFinal_(data.dateFrom),to=normalizeDateOptionalFinal_(data.dateTo),pos=getRowsAsObjects_(getSheet_(SHEETS.PURCHASE_ORDERS)),pis=getRowsAsObjects_(getSheet_(SHEETS.PURCHASE_ITEMS)),items=[];pos.forEach(function(p){var d=String(p.orderDate||'').slice(0,10);if(status&&String(p.status||'')!==status)return;if(from&&d<from)return;if(to&&d>to)return;items.push({purchaseOrder:sanitizePurchaseOrderFinal_(p),items:pis.filter(function(x){return String(x.poId)===String(p.poId);}).map(sanitizePurchaseItemFinal_)});});items.sort(function(a,b){return String(b.purchaseOrder.createdAt).localeCompare(String(a.purchaseOrder.createdAt));});return {items:items};}

function receivePurchaseOrderFinal_(data, user) {
  requireAdminFinal_(user);
  return lockRun_(function () {
    var poId = String(data.poId || '').trim();
    var receiptItemsInput = Array.isArray(data.items) ? data.items : [];
    if (!poId || !receiptItemsInput.length) {
      throw createApiError_('VALIDATION_ERROR','PO dan item penerimaan wajib.',400);
    }

    var pos=getSheet_(SHEETS.PURCHASE_ORDERS);
    var pis=getSheet_(SHEETS.PURCHASE_ITEMS);
    var prs=getSheet_(SHEETS.PURCHASE_RECEIPTS);
    var pris=getSheet_(SHEETS.PURCHASE_RECEIPT_ITEMS);
    var ps=getSheet_(SHEETS.PRODUCTS);
    var ms=getSheet_(SHEETS.STOCK_MOVEMENTS);
    var poRow=findRowById_(pos,'poId',poId);

    if(poRow<0) throw createApiError_('NOT_FOUND','PO tidak ditemukan.',404);

    var po=getObjectByRow_(pos,poRow);
    if(['COMPLETED','CANCELLED'].indexOf(String(po.status))>=0){
      throw createApiError_('VALIDATION_ERROR','PO sudah selesai atau dibatalkan.',400);
    }

    var poItems=getRowsAsObjects_(pis).filter(function(x){return String(x.poId)===poId;});
    var map={};

    receiptItemsInput.forEach(function(x){
      var itemId=String(x.poItemId||'').trim();
      var q=Number(x.qtyReceived);
      if(!itemId||!isFinite(q)||q<=0) throw createApiError_('VALIDATION_ERROR','PO item dan Qty Received > 0 wajib.',400);
      if(map[itemId]!==undefined) throw createApiError_('VALIDATION_ERROR','PO item duplicate.',400);
      map[itemId]=q;
    });

    var changes=[];
    var total=0;

    /* Validate every receipt line before changing any sheet. */
    Object.keys(map).forEach(function(itemId){
      var item=poItems.find(function(x){return String(x.poItemId)===itemId;});
      if(!item) throw createApiError_('NOT_FOUND','PO item tidak ditemukan.',404);
      var q=map[itemId];
      var remaining=toNonNegativeNumber_(item.qtyRemaining,'Qty Remaining');
      if(q>remaining) throw createApiError_('VALIDATION_ERROR','Qty lebih besar dari remaining untuk '+String(item.productName),400);

      var prow=findRowById_(ps,'productId',String(item.productId));
      if(prow<0) throw createApiError_('NOT_FOUND','Produk PO tidak ditemukan.',404);
      var product=getObjectByRow_(ps,prow);
      if(!toBoolean_(product.active)) throw createApiError_('VALIDATION_ERROR','Produk PO tidak aktif.',400);

      changes.push({item:item,itemId:itemId,qty:q,productRow:prow,product:product,stockBefore:toNonNegativeNumber_(product.currentStock,'Current Stock')});
      total+=q;
    });

    if(total<=0) throw createApiError_('VALIDATION_ERROR','Total penerimaan harus lebih dari 0.',400);

    var now=nowIso_();
    var receiptId=Utilities.getUuid();
    var receiptNo=nextDocumentNoFinal_('GR');
    var header={
      purchaseReceiptId:receiptId,
      receiptId:Utilities.getUuid(),
      poId:poId,
      receiptNo:receiptNo,
      receiptDate:normalizeDateFinal_(data.receiptDate),
      documentNo:String(data.documentNo||'').trim(),
      createdBy:String(user.name||user.username),
      createdAt:now
    };

    var out=[];
    var mvs=[];

    changes.forEach(function(change){
      var received=Number(change.item.qtyReceived||0)+change.qty;
      var remaining=Math.max(0,Number(change.item.qtyOrdered||0)-received);
      var after=change.stockBefore+change.qty;
      var pir=findRowById_(pis,'poItemId',change.itemId);

      if(pir<0) throw createApiError_('SERVER_ERROR','PO item tidak ditemukan.',500);

      setFieldFinal_(ps,change.productRow,'currentStock',after);
      setFieldFinal_(ps,change.productRow,'updatedAt',now);
      setFieldFinal_(pis,pir,'qtyReceived',received);
      setFieldFinal_(pis,pir,'qtyRemaining',remaining);

      out.push({
        purchaseReceiptItemId:Utilities.getUuid(),
        purchaseReceiptId:receiptId,
        poItemId:change.itemId,
        productId:String(change.item.productId),
        sku:String(change.item.sku||''),
        productName:String(change.item.productName||''),
        unit:String(change.item.unit||''),
        qtyReceived:change.qty
      });

      mvs.push({
        movementId:Utilities.getUuid(),
        movementDate:header.receiptDate,
        productId:String(change.item.productId),
        sku:String(change.product.sku||change.item.sku||''),
        productName:String(change.product.name||change.item.productName||''),
        type:'IN',qty:change.qty,
        stockBefore:change.stockBefore,stockAfter:after,
        referenceType:'PURCHASE_RECEIPT',referenceId:receiptId,
        userId:String(user.userId),userName:String(user.name||user.username),
        note:'Penerimaan '+String(po.poNo),createdAt:now
      });
    });

    appendObjectRow_(prs,HEADERS[SHEETS.PURCHASE_RECEIPTS],header);
    appendRowsFinal_(pris,HEADERS[SHEETS.PURCHASE_RECEIPT_ITEMS],out);
    appendRowsFinal_(ms,HEADERS[SHEETS.STOCK_MOVEMENTS],mvs);

    var refreshed=getRowsAsObjects_(pis).filter(function(x){return String(x.poId)===poId;});
    var complete=refreshed.every(function(x){return Number(x.qtyRemaining||0)<=0;});
    var newStatus=complete?'COMPLETED':'PARTIAL';

    setFieldFinal_(pos,poRow,'status',newStatus);
    setFieldFinal_(pos,poRow,'updatedAt',now);

    return {purchaseReceipt:header,receiptItems:out,status:newStatus};
  });
}

function stockReportFinal_(data,user){
  requireAdminFinal_(user);var type=String(data.reportType||'stock').toLowerCase();if(type==='movements')return listMovementsFinal_(data);if(type==='requests')return listRequestsFinal_(data,{role:'ADMIN',userId:''});if(type==='po')return listPurchaseOrdersFinal_(data);if(type==='receipts')return receiptReportFinal_(data);var products=getRowsAsObjects_(getSheet_(SHEETS.PRODUCTS)),cats=getRowsAsObjects_(getSheet_(SHEETS.CATEGORIES)),sups=getRowsAsObjects_(getSheet_(SHEETS.SUPPLIERS)),cn={},sn={};cats.forEach(function(x){cn[String(x.categoryId)]=String(x.categoryName||'')});sups.forEach(function(x){sn[String(x.supplierId)]=String(x.name||'')});var items=[],total=0;products.forEach(function(p){if(!toBoolean_(p.active))return;var stock=Number(p.currentStock||0),price=Number(p.price||0),sub=stock*price;total+=sub;items.push({sku:String(p.sku||''),name:String(p.name||''),category:cn[String(p.categoryId)]||'',minStock:Number(p.minStock||0),maxStock:Number(p.maxStock||0),unit:String(p.unit||''),currentStock:stock,difference:stock-Number(p.minStock||0),price:price,subtotal:sub,supplier:sn[String(p.supplierId)]||'',location:String(p.location||'')});});return {reportType:'stock',generatedAt:nowIso_(),items:items,totalInventoryValue:total};}

function receiptReportFinal_(data){var from=normalizeDateOptionalFinal_(data.dateFrom),to=normalizeDateOptionalFinal_(data.dateTo),items=[];getRowsAsObjects_(getSheet_(SHEETS.STOCK_RECEIPTS)).forEach(function(x){var d=String(x.receiptDate||'').slice(0,10);if(from&&d<from)return;if(to&&d>to)return;items.push({type:'BARANG_MASUK',receiptNo:String(x.receiptNo||''),receiptDate:d,poId:String(x.poId||''),documentNo:String(x.documentNo||''),createdBy:String(x.createdBy||''),createdAt:String(x.createdAt||'')});});getRowsAsObjects_(getSheet_(SHEETS.PURCHASE_RECEIPTS)).forEach(function(x){var d=String(x.receiptDate||'').slice(0,10);if(from&&d<from)return;if(to&&d>to)return;items.push({type:'PENERIMAAN_PO',receiptNo:String(x.receiptNo||''),receiptDate:d,poId:String(x.poId||''),documentNo:String(x.documentNo||''),createdBy:String(x.createdBy||''),createdAt:String(x.createdAt||'')});});items.sort(function(a,b){return b.createdAt.localeCompare(a.createdAt)});return {reportType:'receipts',generatedAt:nowIso_(),items:items};}

function bulkUpsertProductsFinal_(data,user){
  requireAdminFinal_(user);return lockRun_(function(){var rows=Array.isArray(data.rows)?data.rows:[];if(!rows.length)throw createApiError_('VALIDATION_ERROR','Data import kosong.',400);var ps=getSheet_(SHEETS.PRODUCTS),products=getRowsAsObjects_(ps),cats=getRowsAsObjects_(getSheet_(SHEETS.CATEGORIES)),sups=getRowsAsObjects_(getSheet_(SHEETS.SUPPLIERS)),bySku={},byBarcode={},cn={},sk={},seenSku={},seenBarcode={},created=0,updated=0,errors=[];products.forEach(function(x){bySku[String(x.sku||'').toLowerCase()]=x;byBarcode[String(x.barcode||'').toLowerCase()]=x});cats.forEach(function(x){cn[String(x.categoryName||'').toLowerCase()]=x});sups.forEach(function(x){sk[String(x.name||'').toLowerCase()]=x;sk[String(x.code||'').toLowerCase()]=x});rows.forEach(function(raw,index){try{var sku=String(firstValueFinal_(raw,['SKU','sku'])||'').trim().toUpperCase(),barcode=String(firstValueFinal_(raw,['Barcode','barcode'])||'').trim(),name=String(firstValueFinal_(raw,['Nama Barang','name','Name'])||'').trim(),cat=String(firstValueFinal_(raw,['Kategori','category','categoryName'])||'').trim().toLowerCase(),unit=String(firstValueFinal_(raw,['Satuan','unit'])||'').trim(),min=Number(firstValueFinal_(raw,['Min','min','minStock'])),max=Number(firstValueFinal_(raw,['Max','max','maxStock'])),price=Number(firstValueFinal_(raw,['Harga','price','Price'])),supplier=String(firstValueFinal_(raw,['Supplier','supplier','supplierName','supplierCode'])||'').trim().toLowerCase(),loc=String(firstValueFinal_(raw,['Lokasi','location'])||'').trim();if(!sku||!barcode||!name||!unit||!isFinite(min)||min<0||!isFinite(max)||max<=min||!isFinite(price)||price<0||!loc)throw new Error('Data wajib/Min-Max/Harga tidak valid.');if(seenSku[sku.toLowerCase()])throw new Error('SKU duplicate di file.');if(seenBarcode[barcode.toLowerCase()])throw new Error('Barcode duplicate di file.');seenSku[sku.toLowerCase()]=1;seenBarcode[barcode.toLowerCase()]=1;var c=cn[cat],s=sk[supplier];if(!c||!toBoolean_(c.active))throw new Error('Kategori tidak ditemukan/tidak aktif.');if(!s||!toBoolean_(s.active))throw new Error('Supplier tidak ditemukan/tidak aktif.');var a=bySku[sku.toLowerCase()]||null,b=byBarcode[barcode.toLowerCase()]||null;if(a&&b&&String(a.productId)!==String(b.productId))throw new Error('SKU dan Barcode menunjuk ke barang berbeda.');var ex=a||b,now=nowIso_();if(ex){var r=findRowById_(ps,'productId',String(ex.productId));setFieldFinal_(ps,r,'sku',sku);setFieldFinal_(ps,r,'barcode',barcode);setFieldFinal_(ps,r,'name',name);setFieldFinal_(ps,r,'categoryId',String(c.categoryId));setFieldFinal_(ps,r,'unit',unit);setFieldFinal_(ps,r,'minStock',min);setFieldFinal_(ps,r,'maxStock',max);setFieldFinal_(ps,r,'price',price);setFieldFinal_(ps,r,'supplierId',String(s.supplierId));setFieldFinal_(ps,r,'location',loc);setFieldFinal_(ps,r,'updatedAt',now);updated++;}else{var n={productId:Utilities.getUuid(),sku:sku,barcode:barcode,name:name,categoryId:String(c.categoryId),unit:unit,minStock:min,maxStock:max,currentStock:0,price:price,supplierId:String(s.supplierId),location:loc,active:true,createdAt:now,updatedAt:now};appendObjectRow_(ps,HEADERS[SHEETS.PRODUCTS],n);created++;}}catch(e){errors.push({row:index+2,message:String(e.message||'Invalid row')});}});return {totalRows:rows.length,created:created,updated:updated,errors:errors};});
}

function dateOnlyFinal_(value){
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, DATABASE_TIMEZONE, 'yyyy-MM-dd');
  }
  var s=String(value===undefined||value===null?'':value).trim();
  if(!s)return'';
  var m=s.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  if(m){return m[1]+'-'+('0'+Number(m[2])).slice(-2)+'-'+('0'+Number(m[3])).slice(-2);}
  var dmy=s.match(/^([0-3]?\d)[\/-]([01]?\d)[\/-](\d{4})/);
  if(dmy){return dmy[3]+'-'+('0'+Number(dmy[2])).slice(-2)+'-'+('0'+Number(dmy[1])).slice(-2);}
  var dt=new Date(s);
  if(!isNaN(dt.getTime()))return Utilities.formatDate(dt,DATABASE_TIMEZONE,'yyyy-MM-dd');
  return s.slice(0,10);
}
function getRecentRowsAsObjectsFinal_(sheet, maxRows){
  var lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();
  if(lastRow<2||lastColumn<1)return[];
  var count=Math.min(maxRows||1000,lastRow-1),start=lastRow-count+1;
  var headers=sheet.getRange(1,1,1,lastColumn).getValues()[0],values=sheet.getRange(start,1,count,lastColumn).getValues(),result=[];
  for(var r=0;r<values.length;r++){
    var row={},hasValue=false;
    for(var c=0;c<headers.length;c++){row[String(headers[c])]=values[r][c];if(values[r][c]!==''&&values[r][c]!==null)hasValue=true;}
    if(hasValue)result.push(row);
  }
  return result;
}
function normalizeDateFinal_(value){var t=String(value||'').trim();if(!t)t=Utilities.formatDate(new Date(),DATABASE_TIMEZONE,'yyyy-MM-dd');if(!/^\d{4}-\d{2}-\d{2}$/.test(t))throw createApiError_('VALIDATION_ERROR','Tanggal harus YYYY-MM-DD.',400);return t;}
function normalizeDateOptionalFinal_(value){if(value===undefined||value===null||value==='')return'';return normalizeDateFinal_(value)}
function firstValueFinal_(o,keys){for(var i=0;i<keys.length;i++){if(o[keys[i]]!==undefined&&o[keys[i]]!==null&&o[keys[i]]!=='')return o[keys[i]];}return'';}
function sanitizeMovementFinal_(x){return {movementId:String(x.movementId||''),movementDate:dateOnlyFinal_(x.movementDate)||String(x.movementDate||''),productId:String(x.productId||''),sku:String(x.sku||''),productName:String(x.productName||''),type:String(x.type||''),qty:Number(x.qty||0),stockBefore:Number(x.stockBefore||0),stockAfter:Number(x.stockAfter||0),referenceType:String(x.referenceType||''),referenceId:String(x.referenceId||''),userId:String(x.userId||''),userName:String(x.userName||''),note:String(x.note||''),createdAt:String(x.createdAt||'')};}
function sanitizeRequestFinal_(x){return {requestId:String(x.requestId||''),requestNo:String(x.requestNo||''),requestDate:String(x.requestDate||''),staffId:String(x.staffId||''),staffName:String(x.staffName||''),department:String(x.department||''),status:String(x.status||''),rejectionReason:String(x.rejectionReason||''),approvedBy:String(x.approvedBy||''),approvedAt:String(x.approvedAt||''),rejectedBy:String(x.rejectedBy||''),rejectedAt:String(x.rejectedAt||''),createdAt:String(x.createdAt||''),updatedAt:String(x.updatedAt||'')};}
function sanitizeRequestItemFinal_(x){return {requestItemId:String(x.requestItemId||''),requestId:String(x.requestId||''),productId:String(x.productId||''),sku:String(x.sku||''),productName:String(x.productName||''),unit:String(x.unit||''),qtyRequested:Number(x.qtyRequested||0),qtyApproved:Number(x.qtyApproved||0),stockAtRequest:Number(x.stockAtRequest||0),note:String(x.note||'')};}
function sanitizePurchaseOrderFinal_(x){return {poId:String(x.poId||''),poNo:String(x.poNo||''),supplierId:String(x.supplierId||''),supplierName:String(x.supplierName||''),orderDate:String(x.orderDate||''),status:String(x.status||''),totalAmount:Number(x.totalAmount||0),createdBy:String(x.createdBy||''),createdAt:String(x.createdAt||''),updatedAt:String(x.updatedAt||'')};}
function sanitizePurchaseItemFinal_(x){return {poItemId:String(x.poItemId||''),poId:String(x.poId||''),productId:String(x.productId||''),sku:String(x.sku||''),productName:String(x.productName||''),unit:String(x.unit||''),qtyOrdered:Number(x.qtyOrdered||0),qtyReceived:Number(x.qtyReceived||0),qtyRemaining:Number(x.qtyRemaining||0),price:Number(x.price||0),subtotal:Number(x.subtotal||0)};}


/* TEMPORARY SETUP HELPER - remove after initial Vercel configuration. */
function showATKApiKey() {
  var key = getOrCreateApiKey();
  Logger.log('ATK_API_KEY=' + key);
  console.log('ATK_API_KEY=' + key);
  return key;
}
