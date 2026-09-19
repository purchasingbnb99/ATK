/**
 * ATK Inventory - SetupDatabase.gs
 * Shared database definitions. SHEETS and HEADERS must exist only here.
 */

var SHEETS = {
  USERS: '01_USERS',
  CATEGORIES: '02_CATEGORIES',
  SUPPLIERS: '03_SUPPLIERS',
  PRODUCTS: '04_PRODUCTS',
  STOCK_RECEIPTS: '05_STOCK_RECEIPTS',
  STOCK_MOVEMENTS: '06_STOCK_MOVEMENTS',
  STOCK_ADJUSTMENTS: '07_STOCK_ADJUSTMENTS',
  REQUESTS: '08_REQUESTS',
  REQUEST_ITEMS: '09_REQUEST_ITEMS',
  PURCHASE_ORDERS: '10_PURCHASE_ORDERS',
  PURCHASE_ITEMS: '11_PURCHASE_ITEMS',
  PURCHASE_RECEIPTS: '12_PURCHASE_RECEIPTS',
  PURCHASE_RECEIPT_ITEMS: '13_PURCHASE_RECEIPT_ITEMS',
  APP_SETTINGS: '14_APP_SETTINGS'
};

var HEADERS = {
  '01_USERS': [
    'userId', 'username', 'name', 'email', 'role', 'department',
    'passwordSalt', 'passwordHash', 'active', 'createdAt', 'updatedAt'
  ],
  '02_CATEGORIES': [
    'categoryId', 'categoryName', 'active', 'createdAt', 'updatedAt'
  ],
  '03_SUPPLIERS': [
    'supplierId', 'code', 'name', 'pic', 'phone', 'email',
    'address', 'active', 'createdAt', 'updatedAt'
  ],
  '04_PRODUCTS': [
    'productId', 'sku', 'barcode', 'name', 'categoryId', 'unit',
    'minStock', 'maxStock', 'currentStock', 'price', 'supplierId',
    'location', 'active', 'createdAt', 'updatedAt'
  ],
  '05_STOCK_RECEIPTS': [
    'receiptId', 'receiptNo', 'receiptDate', 'supplierId', 'poId',
    'documentNo', 'note', 'createdBy', 'createdAt'
  ],
  '06_STOCK_MOVEMENTS': [
    'movementId', 'movementDate', 'productId', 'sku', 'productName',
    'type', 'qty', 'stockBefore', 'stockAfter', 'referenceType',
    'referenceId', 'userId', 'userName', 'note', 'createdAt'
  ],
  '07_STOCK_ADJUSTMENTS': [
    'adjustmentId', 'adjustmentNo', 'adjustmentDate', 'productId',
    'sku', 'productName', 'systemStock', 'physicalStock', 'difference',
    'reason', 'createdBy', 'createdAt'
  ],
  '08_REQUESTS': [
    'requestId', 'requestNo', 'requestDate', 'staffId', 'staffName',
    'department', 'status', 'rejectionReason', 'approvedBy',
    'approvedAt', 'rejectedBy', 'rejectedAt', 'createdAt', 'updatedAt'
  ],
  '09_REQUEST_ITEMS': [
    'requestItemId', 'requestId', 'productId', 'sku', 'productName',
    'unit', 'qtyRequested', 'qtyApproved', 'stockAtRequest', 'note'
  ],
  '10_PURCHASE_ORDERS': [
    'poId', 'poNo', 'supplierId', 'supplierName', 'orderDate',
    'status', 'totalAmount', 'createdBy', 'createdAt', 'updatedAt'
  ],
  '11_PURCHASE_ITEMS': [
    'poItemId', 'poId', 'productId', 'sku', 'productName', 'unit',
    'qtyOrdered', 'qtyReceived', 'qtyRemaining', 'price', 'subtotal'
  ],
  '12_PURCHASE_RECEIPTS': [
    'purchaseReceiptId', 'receiptId', 'poId', 'receiptNo',
    'receiptDate', 'documentNo', 'createdBy', 'createdAt'
  ],
  '13_PURCHASE_RECEIPT_ITEMS': [
    'purchaseReceiptItemId', 'purchaseReceiptId', 'poItemId',
    'productId', 'sku', 'productName', 'unit', 'qtyReceived'
  ],
  '14_APP_SETTINGS': [
    'settingKey', 'settingValue', 'description', 'updatedAt'
  ]
};

var DATABASE_TIMEZONE = 'Asia/Jakarta';

function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheet tidak ditemukan. Jalankan script dari spreadsheet DATABASE_ATK.');
  }

  ss.setName('DATABASE_ATK');
  ss.setSpreadsheetTimeZone(DATABASE_TIMEZONE);

  var keys = Object.keys(SHEETS);
  for (var i = 0; i < keys.length; i++) {
    ensureSheet_(ss, SHEETS[keys[i]], HEADERS[SHEETS[keys[i]]]);
  }

  ensureInitialSettings_();
  seedDemoUsers_();
}

function ensureSheet_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getMaxRows() < 2) {
    sheet.insertRowsAfter(sheet.getMaxRows(), 2 - sheet.getMaxRows());
  }

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns()
    );
  }

  var needsHeader = sheet.getLastRow() < 1 || sheet.getLastColumn() < headers.length;
  if (!needsHeader) {
    var current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(current[i] || '') !== headers[i]) {
        needsHeader = true;
        break;
      }
    }
  }

  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setWrap(true);

  for (var c = 1; c <= headers.length; c++) {
    sheet.autoResizeColumn(c);
  }
}

function ensureInitialSettings_() {
  var sheet = getSheet_(SHEETS.APP_SETTINGS);
  var values = getRowsAsObjects_(sheet);
  var existing = {};
  for (var i = 0; i < values.length; i++) {
    existing[String(values[i].settingKey)] = true;
  }

  var defaults = [
    ['appName', 'ATK Inventory', 'Nama aplikasi'],
    ['appVersion', '1.0.0', 'Versi aplikasi'],
    ['timezone', DATABASE_TIMEZONE, 'Timezone aplikasi'],
    ['requestStatusDefault', 'MENUNGGU', 'Status awal pengajuan'],
    ['purchaseOrderDefaultStatus', 'DRAFT', 'Status awal PO']
  ];

  var rows = [];
  var now = nowIso_();
  for (var j = 0; j < defaults.length; j++) {
    if (!existing[defaults[j][0]]) {
      rows.push([defaults[j][0], defaults[j][1], defaults[j][2], now]);
    }
  }

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
}

function seedDemoUsers_() {
  var sheet = getSheet_(SHEETS.USERS);
  var users = getRowsAsObjects_(sheet);
  var usernames = {};

  for (var i = 0; i < users.length; i++) {
    usernames[String(users[i].username || '').toLowerCase()] = true;
  }

  var rows = [];
  var now = nowIso_();

  if (!usernames.admin) {
    var admin = hashPassword_('Admin123!');
    rows.push([
      Utilities.getUuid(), 'admin', 'Administrator', '', 'ADMIN', '',
      admin.salt, admin.hash, true, now, now
    ]);
  }

  if (!usernames.staff1) {
    var staff = hashPassword_('Staff123!');
    rows.push([
      Utilities.getUuid(), 'staff1', 'Staff 1', '', 'STAFF', '',
      staff.salt, staff.hash, true, now, now
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(
      sheet.getLastRow() + 1,
      1,
      rows.length,
      HEADERS[SHEETS.USERS].length
    ).setValues(rows);
  }
}

/* Shared helpers. Do not redeclare these in Code.gs. */

function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheet aktif tidak ditemukan.');
  }
  return ss;
}

function getSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet tidak ditemukan: ' + sheetName);
  }
  return sheet;
}

function getRowsAsObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow < 2 || lastColumn < 1) {
    return [];
  }

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  var result = [];

  for (var r = 0; r < values.length; r++) {
    var row = {};
    var hasValue = false;

    for (var c = 0; c < headers.length; c++) {
      row[String(headers[c])] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) {
        hasValue = true;
      }
    }

    if (hasValue) {
      result.push(row);
    }
  }

  return result;
}

function findRowById_(sheet, idField, idValue) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return -1;
  }

  var headers = values[0];
  var idIndex = headers.indexOf(idField);
  if (idIndex < 0) {
    throw new Error('Field ID tidak ditemukan: ' + idField);
  }

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idIndex]) === String(idValue)) {
      return r + 1;
    }
  }

  return -1;
}

function getHeaderIndex_(sheet, headerName) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var index = headers.indexOf(headerName);
  if (index < 0) {
    throw new Error('Header tidak ditemukan: ' + headerName);
  }
  return index;
}

function nowIso_() {
  return Utilities.formatDate(
    new Date(),
    DATABASE_TIMEZONE,
    "yyyy-MM-dd'T'HH:mm:ssXXX"
  );
}

function hashPassword_(password) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  var hash = sha256Hex_(salt + ':' + password);
  return {
    salt: salt,
    hash: hash
  };
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );

  var result = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b < 0) {
      b += 256;
    }
    var hex = b.toString(16);
    if (hex.length === 1) {
      hex = '0' + hex;
    }
    result += hex;
  }
  return result;
}
