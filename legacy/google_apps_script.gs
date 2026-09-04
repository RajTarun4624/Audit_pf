// PA Task Audit — shared database script
// Paste this whole file into Apps Script (Extensions → Apps Script) inside a blank Google Sheet,
// then Deploy → New deployment → Web app → Execute as "Me", Who has access "Anyone".
// The web app URL (ends in /exec) is what the audit site connects to.

var SHEET_AUDITS = "Audits";
var SHEET_ISSUES = "Issues";
var AUDIT_COLS = ["record_id", "submitted_at", "task_id", "queue_name", "batch_id", "auditor", "annotator",
  "annotation_date", "audit_date", "verdict", "total_checks", "passed", "failed", "na",
  "critical_fails", "major_fails", "minor_fails", "failed_checks"];
var ISSUE_COLS = ["record_id", "batch_id", "check_id", "section", "severity", "result", "note"];

function getSheet(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function rowsOf(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (!values[i][0]) continue;
    var o = {};
    for (var j = 0; j < head.length; j++) o[head[j]] = values[i][j] === null || values[i][j] === undefined ? "" : String(values[i][j]);
    out.push(o);
  }
  return out;
}

// GET  …/exec?action=list   → every audit with its issues
function doGet(e) {
  try {
    var audits = rowsOf(getSheet(SHEET_AUDITS, AUDIT_COLS));
    var issues = rowsOf(getSheet(SHEET_ISSUES, ISSUE_COLS));
    var byRecord = {};
    for (var i = 0; i < issues.length; i++) {
      var id = issues[i].record_id;
      if (!byRecord[id]) byRecord[id] = [];
      byRecord[id].push(issues[i]);
    }
    for (var k = 0; k < audits.length; k++) audits[k].checks = byRecord[audits[k].record_id] || [];
    return reply({ ok: true, records: audits });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

// POST body {action:"add", record:{…}}  or  {action:"delete", record_id:"…"}
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    if (body.action === "delete") return reply(deleteRecord(String(body.record_id || "")));
    if (body.action === "add" && body.record) return reply(addRecord(body.record));
    return reply({ ok: false, error: "Unknown action" });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function addRecord(rec) {
  var sh = getSheet(SHEET_AUDITS, AUDIT_COLS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(rec.record_id)) return { ok: true, duplicate: true };
  }
  var row = [];
  for (var c = 0; c < AUDIT_COLS.length; c++) {
    var v = rec[AUDIT_COLS[c]];
    row.push(v === null || v === undefined ? "" : String(v));
  }
  // Text format keeps dates and IDs exactly as sent (no automatic date conversion).
  sh.getRange(last + 1, 1, 1, AUDIT_COLS.length).setNumberFormat("@").setValues([row]);

  var checks = rec.checks || [];
  var issueRows = [];
  for (var k = 0; k < checks.length; k++) {
    var ch = checks[k];
    if (ch.result === "pass") continue;
    issueRows.push([String(rec.record_id), String(rec.batch_id || ""), String(ch.check_id || ""), String(ch.section || ""),
      String(ch.severity || ""), String(ch.result || ""), String(ch.note || "")]);
  }
  if (issueRows.length) {
    var is = getSheet(SHEET_ISSUES, ISSUE_COLS);
    is.getRange(is.getLastRow() + 1, 1, issueRows.length, ISSUE_COLS.length).setNumberFormat("@").setValues(issueRows);
  }
  return { ok: true };
}

function deleteRecord(recordId) {
  if (!recordId) return { ok: false, error: "record_id missing" };
  var sheets = [getSheet(SHEET_AUDITS, AUDIT_COLS), getSheet(SHEET_ISSUES, ISSUE_COLS)];
  var removed = 0;
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    var last = sh.getLastRow();
    if (last < 2) continue;
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === recordId) { sh.deleteRow(i + 2); removed++; }
    }
  }
  return { ok: true, removed: removed };
}
