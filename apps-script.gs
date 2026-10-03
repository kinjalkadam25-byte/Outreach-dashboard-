/**
 * Finance outreach dashboard <-> Google Sheet bridge.
 *
 * Setup (once, about five minutes):
 *   1. Create a Google Sheet for the team. Extensions -> Apps Script.
 *   2. Replace everything in Code.gs with this file. Change TOKEN below to a
 *      long random phrase and save.
 *   3. Pick "setup" in the function menu and press Run. Allow the permissions
 *      it asks for (Sheets, and Gmail for sending emails and spotting replies).
 *      It also starts a 10-minute timer that checks for replies.
 *   4. Deploy -> New deployment -> type "Web app".
 *        Execute as:       Me
 *        Who has access:   Anyone
 *      Authorise when asked. Copy the Web app URL (ends in /exec).
 *   5. In the dashboard's "Sheet sync" tab, paste the URL and the same TOKEN.
 *
 * Emails sent from the dashboard go out from the Gmail account of whoever did
 * this setup, whoever presses Send. Gmail allows about 100 recipients a day on
 * a personal account.
 *
 * "Anyone" means anyone with the URL *and* the token. Only share the token
 * with the finance team. After editing this script, deploy again
 * (Deploy -> Manage deployments -> edit -> New version) or changes won't apply.
 *
 * The script creates three tabs on first use: "Brands", "Drafts" and "Emails". People can
 * read and sort them freely. Don't rename or reorder the header columns.
 */

const TOKEN = 'change-me-to-a-long-random-phrase';

// New columns go on the end, so a sheet made by an older version keeps lining up.
const BRAND_COLS = ['id', 'brand', 'contact', 'phone', 'email', 'status', 'notes', 'createdAt', 'updatedAt', 'type', 'addedBy'];
const DRAFT_COLS = ['id', 'title', 'subject', 'body', 'whatsapp'];
const EMAIL_COLS = ['id', 'brandId', 'brand', 'to', 'subject', 'sentBy', 'sentAt', 'threadId', 'repliedAt', 'reply'];
// Replies to emails older than this stop being looked for.
const REPLY_WINDOW_DAYS = 60;

function doGet(e) {
  if (!authorised_(e.parameter.token)) return json_({ ok: false, error: 'Wrong token' });
  if (e.parameter.replies) checkReplies();
  return json_({ ok: true, brands: read_('Brands', BRAND_COLS), drafts: read_('Drafts', DRAFT_COLS), emails: read_('Emails', EMAIL_COLS) });
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
    else if (req.action === 'upsertBrands') upsertMany_('Brands', BRAND_COLS, req.rows || []);
    else if (req.action === 'deleteBrand') remove_('Brands', req.id);
    else if (req.action === 'clearBrands') replaceAll_('Brands', BRAND_COLS, []);
    else if (req.action === 'saveDrafts') replaceAll_('Drafts', DRAFT_COLS, req.drafts || []);
    else if (req.action === 'sendEmail') return json_({ ok: true, email: sendEmail_(req.email || {}) });
    else return json_({ ok: false, error: 'Unknown action' });
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// Run once from the editor: grants permissions and starts the reply timer.
function setup() {
  sheet_('Emails', EMAIL_COLS);
  GmailApp.getInboxUnreadCount();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkReplies')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkReplies').timeBased().everyMinutes(10).create();
}

function sendEmail_(m) {
  if (!m.id) throw new Error('Email has no id');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to || '')) throw new Error('That email address looks wrong');
  if (!m.subject || !m.body) throw new Error('Add a subject and a message');
  const sh = sheet_('Emails', EMAIL_COLS);
  // A retry after a lost response must not send the same email twice.
  const at = rowIndex_(sh, m.id);
  if (at > 0) return rowObj_(sh, at, EMAIL_COLS);
  const draft = GmailApp.createDraft(m.to, m.subject, m.body, m.name ? { name: m.name } : {});
  const sent = draft.send();
  const row = {
    id: m.id, brandId: m.brandId, brand: m.brand, to: m.to, subject: m.subject, sentBy: m.sentBy,
    sentAt: new Date().toISOString(), threadId: sent.getThread().getId(), repliedAt: '', reply: '',
  };
  write_(sh.getRange(sh.getLastRow() + 1, 1, 1, EMAIL_COLS.length), [EMAIL_COLS.map((c) => safe_(row[c]))]);
  return row;
}

// Marks logged emails that have had a reply. Runs on the timer from setup()
// and when someone presses "Sync now".
function checkReplies() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // the next run will catch up
  try {
    checkReplies_();
  } finally {
    lock.releaseLock();
  }
}

function checkReplies_() {
  const sh = sheet_('Emails', EMAIL_COLS);
  const last = sh.getLastRow();
  if (last < 2) return;
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const since = Date.now() - REPLY_WINDOW_DAYS * 864e5;
  const rows = sh.getRange(2, 1, last - 1, EMAIL_COLS.length).getDisplayValues();
  const col = (c) => EMAIL_COLS.indexOf(c);
  rows.forEach((r, i) => {
    const sentAt = new Date(r[col('sentAt')]).getTime();
    if (!r[col('id')] || r[col('repliedAt')] || !(sentAt > since)) return;
    const reply = findReply_(r[col('threadId')], r[col('to')], sentAt, me);
    if (!reply) return;
    const snippet = reply.getPlainBody().split(/\n\s*(On .+wrote:|-{2,}|>)/)[0].replace(/\s+/g, ' ').trim().slice(0, 200);
    write_(sh.getRange(i + 2, col('repliedAt') + 1, 1, 2), [[reply.getDate().toISOString(), safe_(snippet)]]);
  });
}

// A reply in the same thread, or a fresh email from the brand's address.
function findReply_(threadId, to, sentAt, me) {
  const notMine = (msg) => msg.getDate().getTime() > sentAt && msg.getFrom().toLowerCase().indexOf(me) < 0;
  if (threadId) {
    try {
      const hit = GmailApp.getThreadById(threadId).getMessages().find(notMine);
      if (hit) return hit;
    } catch (err) {} // thread deleted
  }
  const threads = GmailApp.search('from:' + to + ' after:' + Math.floor(sentAt / 1000), 0, 5);
  for (const t of threads) {
    const hit = t.getMessages().find(notMine);
    if (hit) return hit;
  }
  return null;
}

function rowObj_(sh, at, cols) {
  const r = sh.getRange(at, 1, 1, cols.length).getDisplayValues()[0];
  return Object.fromEntries(cols.map((c, i) => [c, r[i]]));
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

// For imports: one read of the id column and one write for all new rows, so a
// batch of hundreds stays well inside Apps Script's time limit. Rows already in
// the sheet (a retried batch) are updated in place, never added twice.
function upsertMany_(name, cols, rows) {
  const sh = sheet_(name, cols);
  const last = sh.getLastRow();
  const ids = last < 2 ? [] : sh.getRange(2, 1, last - 1, 1).getDisplayValues().map((r) => r[0]);
  const fresh = [];
  rows.forEach((row) => {
    if (!row || !row.id) throw new Error('Row has no id');
    const values = cols.map((c) => safe_(row[c]));
    const i = ids.indexOf(row.id);
    if (i >= 0) write_(sh.getRange(i + 2, 1, 1, cols.length), [values]);
    else fresh.push(values);
  });
  if (fresh.length) write_(sh.getRange(sh.getLastRow() + 1, 1, fresh.length, cols.length), fresh);
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
