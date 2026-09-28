/**
 * Finance outreach dashboard <-> Google Sheet bridge.
 *
 * Setup (once, about five minutes):
 *   1. Create a Google Sheet for the team. Extensions -> Apps Script.
 *   2. Replace everything in Code.gs with this file. Change TOKEN below to a
 *      long random phrase and save.
 *   3. Deploy -> New deployment -> type "Web app".
 *        Execute as:       Me
 *        Who has access:   Anyone
 *      Authorise when asked. Copy the Web app URL (ends in /exec).
 *   4. In the dashboard's "Sheet sync" tab, paste the URL and the same TOKEN.
 *
 * "Anyone" means anyone with the URL *and* the token. Only share the token
 * with the finance team. After editing this script, deploy again
 * (Deploy -> Manage deployments -> edit -> New version) or changes won't apply.
 *
 * The script creates two tabs on first use: "Brands" and "Drafts". People can
 * read and sort them freely. Don't rename or reorder the header columns.
 */

const TOKEN = 'change-me-to-a-long-random-phrase';

// New columns go on the end, so a sheet made by an older version keeps lining up.
const BRAND_COLS = ['id', 'brand', 'contact', 'phone', 'email', 'status', 'notes', 'createdAt', 'updatedAt', 'type', 'addedBy'];
const DRAFT_COLS = ['id', 'title', 'subject', 'body', 'whatsapp'];

function doGet(e) {
  if (!authorised_(e.parameter.token)) return json_({ ok: false, error: 'Wrong token' });
  return json_({ ok: true, brands: read_('Brands', BRAND_COLS), drafts: read_('Drafts', DRAFT_COLS) });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  if (!authorised_(req.token)) return json_({ ok: false, error: 'Wrong token' });

  // Two teammates saving at the same moment must not interleave row writes.
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (req.action === 'upsertBrand') upsert_('Brands', BRAND_COLS, req.row);
    else if (req.action === 'deleteBrand') remove_('Brands', req.id);
    else if (req.action === 'saveDrafts') replaceAll_('Drafts', DRAFT_COLS, req.drafts || []);
    else return json_({ ok: false, error: 'Unknown action' });
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function authorised_(token) {
  return token === TOKEN;
}

function sheet_(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.setFrozenRows(1);
  }
  const head = sh.getRange(1, 1, 1, cols.length);
  if (head.getDisplayValues()[0].join() !== cols.join()) head.setValues([cols]).setFontWeight('bold');
  return sh;
}

function read_(name, cols) {
  const sh = sheet_(name, cols);
  const last = sh.getLastRow();
  if (last < 2) return [];
  // Display values are always strings, so phone numbers keep leading zeros.
  return sh.getRange(2, 1, last - 1, cols.length).getDisplayValues()
    .filter((r) => r[0])
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

function rowIndex_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  const i = ids.findIndex((r) => r[0] === id);
  return i < 0 ? -1 : i + 2;
}

function upsert_(name, cols, row) {
  if (!row || !row.id) throw new Error('Row has no id');
  const sh = sheet_(name, cols);
  const at = rowIndex_(sh, row.id);
  const r = at > 0 ? at : sh.getLastRow() + 1;
  write_(sh.getRange(r, 1, 1, cols.length), [cols.map((c) => safe_(row[c]))]);
}

function remove_(name, id) {
  const sh = sheet_(name, name === 'Brands' ? BRAND_COLS : DRAFT_COLS);
  const at = rowIndex_(sh, id);
  if (at > 0) sh.deleteRow(at);
}

function replaceAll_(name, cols, rows) {
  const sh = sheet_(name, cols);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  if (rows.length) write_(sh.getRange(2, 1, rows.length, cols.length), rows.map((row) => cols.map((c) => safe_(row[c]))));
}

// Plain-text format first, or Sheets turns phone numbers into numbers
// (dropping leading zeros) and ISO timestamps into dates.
function write_(range, values) {
  range.setNumberFormat('@');
  range.setValues(values);
}

// A cell starting with = + - @ would run as a formula. Store it as text.
function safe_(v) {
  const s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
