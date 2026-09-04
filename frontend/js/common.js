// PA Task Audit — shared helpers: config, browser storage, API calls, header, exports.
// Every page loads checks.js, then this file, then its own page script.
(function () {
"use strict";

const CFG = window.PA_AUDIT_CONFIG || {};
const API = String(CFG.apiUrl || "").replace(/\/+$/, "");

const DRAFT_KEY  = "pa_audit_draft_v3";   // the checklist in progress
const LAST_KEY   = "pa_audit_last_v3";    // snapshot of the most recent submission
const OUTBOX_KEY = "pa_audit_outbox_v3";  // submissions the backend has not accepted yet

const SECTIONS = window.PA_SECTIONS;
const ALL = SECTIONS.flatMap(s => s.checks.map(c => Object.assign({ section: s.label }, c)));
const ALL_IDS = ALL.map(c => c.id);
const SEV_LABEL = { critical:"Critical", major:"Major", minor:"Minor" };
const VERDICT_CLS = { "Approved":"green", "Conditional pass":"amber", "Hold":"red" };
const VERDICTS = ["Approved", "Conditional pass", "Hold"];
const META_FIELDS = [
  ["taskId","Task ID"], ["queueName","Queue"], ["batchId","Batch"], ["auditor","QE"],
  ["annotatorName","Annotator"], ["annotationDate","Annotated"], ["auditDate","Audited"],
];

// ── Basic helpers ─────────────────────────────────────────────────────────
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
}
function verdictOf(crit, maj) { return crit > 0 ? "Hold" : maj > 0 ? "Conditional pass" : "Approved"; }
function newRecordId(d) {
  return "AUD-" + d.toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ── Storage ───────────────────────────────────────────────────────────────
function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; } catch (e) { return fallback; } }
function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
function removeKey(key) { try { localStorage.removeItem(key); } catch (e) {} }

const blankVals  = () => Object.fromEntries(ALL_IDS.map(id => [id, null]));
const blankNotes = () => Object.fromEntries(ALL_IDS.map(id => [id, ""]));
const blankMeta  = () => ({ taskId:"", queueName:"", batchId:"", auditor:"", annotatorName:"", annotationDate:"", auditDate:"" });
const blankDraft = () => ({ vals: blankVals(), notes: blankNotes(), meta: blankMeta() });

function normalizeDraft(d) {
  const out = blankDraft();
  if (!d || typeof d !== "object") return out;
  ALL_IDS.forEach(id => {
    const v = d.vals && d.vals[id];
    out.vals[id] = (v === "pass" || v === "fail" || v === "na") ? v : null;
    out.notes[id] = d.notes && typeof d.notes[id] === "string" ? d.notes[id] : "";
  });
  Object.keys(out.meta).forEach(k => { if (d.meta && typeof d.meta[k] === "string") out.meta[k] = d.meta[k]; });
  return out;
}
const loadDraft  = () => normalizeDraft(loadJSON(DRAFT_KEY, null));
const saveDraft  = d => saveJSON(DRAFT_KEY, { vals: d.vals, notes: d.notes, meta: d.meta });
const clearDraft = () => removeKey(DRAFT_KEY);
function hasProgress(d) {
  return ALL_IDS.some(id => d.vals[id] !== null) || Object.values(d.meta).some(v => v) || ALL_IDS.some(id => d.notes[id]);
}

const loadLast  = () => { const l = loadJSON(LAST_KEY, null); return l && l.record ? Object.assign(l, normalizeDraft(l)) : null; };
const saveLast  = l => saveJSON(LAST_KEY, l);
const clearLast = () => removeKey(LAST_KEY);

const loadOutbox = () => loadJSON(OUTBOX_KEY, []).filter(r => r && r.record_id);
const saveOutbox = list => saveJSON(OUTBOX_KEY, list);

// ── Derived numbers for a set of values ───────────────────────────────────
function computed(vals) {
  const stats = {
    total: ALL_IDS.length,
    passed:  ALL_IDS.filter(id => vals[id] === "pass").length,
    failed:  ALL_IDS.filter(id => vals[id] === "fail").length,
    na:      ALL_IDS.filter(id => vals[id] === "na").length,
    pending: ALL_IDS.filter(id => vals[id] === null).length,
  };
  const fails = sev => ALL.filter(c => vals[c.id] === "fail" && c.severity === sev);
  const criticalFails = fails("critical"), majorFails = fails("major"), minorFails = fails("minor");
  const ready = stats.pending === 0;
  return { stats, criticalFails, majorFails, minorFails, ready, canSubmit: ready && criticalFails.length === 0 };
}

function buildRecord(draft, now) {
  const checks = ALL.map(c => ({
    check_id: c.id.toUpperCase(), section: c.section, severity: c.severity,
    result: draft.vals[c.id] || "pending", note: draft.notes[c.id] || "",
  }));
  const failed = checks.filter(c => c.result === "fail");
  const crit = failed.filter(c => c.severity === "critical").length;
  const maj  = failed.filter(c => c.severity === "major").length;
  const min  = failed.filter(c => c.severity === "minor").length;
  const m = draft.meta;
  return {
    record_id: newRecordId(now),
    submitted_at: now.toISOString(),
    task_id: m.taskId, queue_name: m.queueName, batch_id: m.batchId,
    auditor: m.auditor, annotator: m.annotatorName,
    annotation_date: m.annotationDate, audit_date: m.auditDate,
    verdict: verdictOf(crit, maj),
    total_checks: checks.length,
    passed: checks.filter(c => c.result === "pass").length,
    failed: failed.length,
    na: checks.filter(c => c.result === "na").length,
    critical_fails: crit, major_fails: maj, minor_fails: min,
    failed_checks: failed.map(c => c.check_id).join(", "),
    checks: checks.filter(c => c.result !== "pass"),   // passes are implied by the counts
  };
}

// ── API ───────────────────────────────────────────────────────────────────
async function api(path, opts) {
  const r = await fetch(API + path, Object.assign({ headers: { "Content-Type": "application/json" }, cache: "no-store" }, opts || {}));
  let data = null;
  try { data = await r.json(); } catch (e) {}
  if (!r.ok || !data || data.ok === false) {
    const detail = data && data.detail;
    const msg = (data && data.error) || (typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "") || ("HTTP " + r.status);
    throw new Error(msg);
  }
  return data;
}
async function pushRecord(rec) {
  try { await api("/api/records", { method: "POST", body: JSON.stringify(rec) }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}
// Try to upload everything waiting in the outbox. Returns the number still waiting.
async function flushOutbox() {
  let outbox = loadOutbox();
  for (const rec of outbox.slice()) {
    const r = await pushRecord(rec);
    if (!r.ok) break;
    outbox = outbox.filter(x => x.record_id !== rec.record_id);
    saveOutbox(outbox);
  }
  return outbox.length;
}

// ── Header (shared) ───────────────────────────────────────────────────────
const PAGES = [["index.html", "checklist", "Checklist"], ["dashboard.html", "dashboard", "Dashboard"], ["summary.html", "summary", "Summary"], ["records.html", "records", "Records"]];
const hdrState = { health: null, error: null, records: null };
function headerHTML(page) {
  const outbox = loadOutbox().length;
  const n = hdrState.records == null ? null : hdrState.records + outbox;
  const db = hdrState.health === true ? '<span><span class="dot ok"></span>Database connected</span>'
           : hdrState.health === false ? '<span class="red" title="' + esc(hdrState.error || "") + '"><span class="dot bad"></span>Backend unreachable</span>'
           : '<span><span class="dot"></span>Connecting…</span>';
  return '<div><div class="hdr-title">PA Data Collection · Task Audit</div>' +
    '<div class="hdr-sub"><span>Quality Executive — GR16 · ' + ALL_IDS.length + ' checkpoints across ' + SECTIONS.length + ' sections</span>' + db + '</div></div>' +
    '<div class="tabs">' + PAGES.map(([href, id, label]) =>
      '<a class="tab' + (page === id ? " active" : "") + '" href="' + href + '">' + label + (id === "records" && n ? " (" + n + ")" : "") + '</a>').join("") + '</div>';
}
function renderHeader(page) {
  const el = document.getElementById("hdr"); if (el) el.innerHTML = headerHTML(page);
}
async function initHeader(page) {
  renderHeader(page);
  try {
    const d = await api("/api/health");
    hdrState.health = true; hdrState.error = null; hdrState.records = d.records;
  } catch (e) { hdrState.health = false; hdrState.error = e.message; }
  renderHeader(page);
  return hdrState;
}
function setHeaderHealth(ok, error, records) {
  hdrState.health = ok; hdrState.error = error || null;
  if (records != null) hdrState.records = records;
  const page = document.body.dataset.page; renderHeader(page);
}

// ── Small shared renderers ────────────────────────────────────────────────
const sevChip = sev => '<span class="sev ' + esc(sev) + '">' + esc(SEV_LABEL[sev] || sev) + '</span>';
const statusChip = v => v ? '<span class="status ' + v + '">' + (v === "na" ? "N/A" : v === "pass" ? "Pass" : "Fail") + '</span>' : '<span class="status none">—</span>';
const verdictChip = verdict => '<span class="chip ' + (VERDICT_CLS[verdict] || "red") + '">' + esc(verdict) + '</span>';
function metaStrip(meta) {
  return '<div class="card meta-strip">' + META_FIELDS.map(([k, label]) =>
    '<span class="kv"><span class="k">' + label + ':</span> <span class="v' + (meta[k] ? "" : " empty") + '">' + esc(meta[k] || "—") + '</span></span>').join("") + '</div>';
}
function issueHTML(c, note, withId) {
  return '<div class="issue">' + sevChip(c.severity) + '<div style="flex:1">' +
    (withId ? '<div class="id">' + c.id.toUpperCase() + '</div>' : "") +
    '<div class="t">' + esc(c.text) + '</div>' +
    (note ? '<div class="n">Note: ' + esc(note) + '</div>' : "") + '</div></div>';
}
function verdictBox(c) {
  if (!c.ready) return '<div class="verdict pending">Complete all checkpoints to generate the audit verdict.</div>';
  const ids = list => list.map(x => x.id.toUpperCase()).join(", ");
  if (c.criticalFails.length) return '<div class="verdict hold"><h4>⛔ HOLD — Critical Failures</h4>Batch cannot be submitted. ' + plural(c.criticalFails.length, "critical checkpoint") + ' failed: ' + ids(c.criticalFails) + '.</div>';
  if (c.majorFails.length) return '<div class="verdict cond"><h4>⚠ CONDITIONAL PASS — Major Issues</h4>' + plural(c.majorFails.length, "major issue") + ' noted. Batch may proceed with documented remediation plan: ' + ids(c.majorFails) + '.</div>';
  return '<div class="verdict ok"><h4>✓ CLEAR — Approved for Submission</h4>All critical and major checkpoints passed. Batch is approved for client delivery.</div>';
}

// ── Excel / CSV export of a list of records ───────────────────────────────
const EXPORT_COLS = ["record_id","submitted_at","task_id","queue_name","batch_id","auditor","annotator","annotation_date","audit_date",
  "verdict","total_checks","passed","failed","na","critical_fails","major_fails","minor_fails","failed_checks"];
function exportRecords(records, format, label) {
  if (!records.length) return;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = "pa_audits_" + (label ? label.replace(/[^A-Za-z0-9_-]+/g, "_") + "_" : "") + stamp;
  const main = records.map(r => {
    const o = {};
    EXPORT_COLS.forEach(k => { o[k] = r[k] == null ? "" : r[k]; });
    o.submitted_at_local = fmtDate(r.submitted_at);
    o.in_database = r._local ? "no" : "yes";
    return o;
  });
  const detail = records.flatMap(r => (r.checks || []).map(c => ({ record_id:r.record_id, batch_id:r.batch_id, check_id:c.check_id, section:c.section, severity:c.severity, result:c.result, note:c.note })));
  if (format === "xlsx" && window.XLSX) {
    const X = window.XLSX, wb = X.utils.book_new();
    const ws1 = X.utils.json_to_sheet(main);
    const ws2 = X.utils.json_to_sheet(detail.length ? detail : [{ record_id:"", batch_id:"", check_id:"", section:"", severity:"", result:"", note:"" }]);
    ws1["!cols"] = Object.keys(main[0]).map(k => ({ wch: Math.min(48, Math.max(12, k.length + 2)) }));
    ws2["!cols"] = [{wch:22},{wch:34},{wch:10},{wch:34},{wch:10},{wch:10},{wch:60}];
    X.utils.book_append_sheet(wb, ws1, "Audits");
    X.utils.book_append_sheet(wb, ws2, "Issues");
    X.writeFile(wb, base + ".xlsx");
    return;
  }
  const cols = Object.keys(main[0]);
  const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const csv = [cols.join(",")].concat(main.map(r => cols.map(c => q(r[c])).join(","))).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = base + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

window.PA = {
  API, SECTIONS, ALL, ALL_IDS, SEV_LABEL, VERDICT_CLS, VERDICTS, META_FIELDS,
  esc, plural, fmtDate, verdictOf,
  blankDraft, loadDraft, saveDraft, clearDraft, hasProgress,
  loadLast, saveLast, clearLast, loadOutbox, saveOutbox,
  computed, buildRecord, api, pushRecord, flushOutbox,
  initHeader, renderHeader, setHeaderHealth,
  sevChip, statusChip, verdictChip, metaStrip, issueHTML, verdictBox, exportRecords,
};
})();
