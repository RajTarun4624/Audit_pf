// Records page: every submitted audit from the database, with filters.
// Downloads (Excel / CSV) always export exactly the rows currently shown by the filters.
(function () {
"use strict";
const { esc, plural, fmtDate, sevChip, verdictChip, VERDICTS, VERDICT_CLS, SEV_LABEL } = PA;
const topEl = document.getElementById("top");
const filtersEl = document.getElementById("filters");
const tableEl = document.getElementById("table");

const S = {
  records: [], loaded: false, loading: false, error: null, at: null,
  outbox: PA.loadOutbox(), sending: false,
  open: null,
  filter: { q: "", auditor: "", verdict: "", queue: "", from: "", to: "" },
};

// ── Data ──────────────────────────────────────────────────────────────────
function allRecords() {
  const ids = new Set(S.records.map(r => r.record_id));
  const pending = S.outbox.filter(r => !ids.has(r.record_id)).map(r => Object.assign({}, r, { _local: true }));
  return S.records.concat(pending).sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));
}
function localDay(iso) {
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function filtered() {
  const f = S.filter, q = f.q.trim().toLowerCase();
  return allRecords().filter(r => {
    if (f.auditor && (r.auditor || "") !== f.auditor) return false;
    if (f.verdict && r.verdict !== f.verdict) return false;
    if (f.queue && (r.queue_name || "") !== f.queue) return false;
    const day = localDay(r.submitted_at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (q) {
      const notes = (r.checks || []).map(c => c.check_id + " " + (c.note || "")).join(" ");
      const hay = [r.record_id, r.batch_id, r.task_id, r.queue_name, r.auditor, r.annotator, r.failed_checks, notes].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function filterActive() { return Object.values(S.filter).some(v => v); }
function filterLabel() {
  const f = S.filter, parts = [];
  if (f.auditor) parts.push(f.auditor); if (f.verdict) parts.push(f.verdict); if (f.queue) parts.push(f.queue);
  if (f.from || f.to) parts.push((f.from || "start") + "_to_" + (f.to || "today"));
  if (f.q.trim()) parts.push(f.q.trim());
  return parts.join("_");
}

async function load() {
  S.loading = true; S.error = null; renderTop();
  try {
    const d = await PA.api("/api/records");
    S.records = Array.isArray(d.records) ? d.records : [];
    S.loaded = true; S.at = new Date().toISOString();
    const ids = new Set(S.records.map(r => r.record_id));
    const before = S.outbox.length;
    S.outbox = S.outbox.filter(r => !ids.has(r.record_id));
    if (S.outbox.length !== before) PA.saveOutbox(S.outbox);
    PA.setHeaderHealth(true, null, S.records.length);
  } catch (e) { S.error = e.message; PA.setHeaderHealth(false, e.message); }
  S.loading = false;
  renderAll();
}
async function sendOutbox() {
  if (S.sending || !S.outbox.length) return;
  S.sending = true; renderTop();
  await PA.flushOutbox();
  S.outbox = PA.loadOutbox(); S.sending = false;
  await load();
}
async function deleteRecord(id) {
  const local = S.outbox.some(r => r.record_id === id);
  const onServer = S.records.some(r => r.record_id === id);
  if (!window.confirm(onServer ? "Delete " + id + " from the shared database for everyone?" : "Delete " + id + " from this browser?")) return;
  if (onServer) {
    try { await PA.api("/api/records/" + encodeURIComponent(id), { method: "DELETE" }); }
    catch (e) { if (!/not found/i.test(e.message)) { window.alert("Could not delete from the database: " + e.message); return; } }
    S.records = S.records.filter(r => r.record_id !== id);
    PA.setHeaderHealth(true, null, S.records.length);
  }
  if (local) { S.outbox = S.outbox.filter(r => r.record_id !== id); PA.saveOutbox(S.outbox); }
  if (S.open === id) S.open = null;
  renderAll();
}

// ── Render: top card ──────────────────────────────────────────────────────
function renderTop() {
  const all = allRecords(), shown = filtered();
  const counts = {}; shown.forEach(r => { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
  let status;
  if (S.loading && !S.loaded) status = '<span class="spin"></span> Loading records…';
  else if (S.error) status = '<span class="red">Could not reach the backend: ' + esc(S.error) + '.</span>' + (S.loaded ? " Showing the last list that loaded." : "");
  else status = plural(all.length, "record") + " in the shared PostgreSQL database, from every auditor and device." + (S.at ? " Last refreshed " + fmtDate(S.at) + "." : "") + (S.loading ? ' <span class="spin"></span>' : "");
  const n = shown.length, active = filterActive();
  const dlLabel = active ? " (" + n + " filtered)" : n ? " (" + n + ")" : "";
  topEl.innerHTML = '<div class="row"><div><h3>Audit records</h3><p>' + status + '</p></div>' +
    '<div class="actions"><button class="btn" data-act="refresh"' + (S.loading ? " disabled" : "") + '>↻ Refresh</button>' +
    '<button class="btn primary" data-act="export-xlsx"' + (n ? "" : " disabled") + ' title="Exports the rows currently shown">⬇ Download Excel' + dlLabel + '</button>' +
    '<button class="btn" data-act="export-csv"' + (n ? "" : " disabled") + ' title="Exports the rows currently shown">Download CSV' + dlLabel + '</button></div></div>' +
    '<div class="chips">' + VERDICTS.map(v => '<span class="chip ' + VERDICT_CLS[v] + '">' + (counts[v] || 0) + ' ' + v + '</span>').join("") +
    (active ? '<span class="dim" style="font-size:11px">· showing <b style="color:var(--text)">' + n + '</b> of ' + all.length + '</span>' : "") +
    (S.outbox.length ? '<span class="outbox">' + plural(S.outbox.length, "audit") + ' on this browser not yet in the database. <button class="btn amber" data-act="send-outbox"' + (S.sending ? " disabled" : "") + '>' + (S.sending ? "Sending…" : "Send now") + '</button></span>' : "") +
    '</div>';
}

// ── Render: filter bar (built once; option lists refreshed on load) ───────
function renderFilters() {
  const all = allRecords();
  filtersEl.hidden = !all.length && !filterActive();
  const uniq = key => [...new Set(all.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const opts = (list, cur, any) => '<option value="">' + any + '</option>' + list.map(v => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + '>' + esc(v) + '</option>').join("");
  const f = S.filter;
  if (!filtersEl.dataset.built) {
    filtersEl.innerHTML = '<div class="card-hd">FILTERS <span style="font-weight:400;letter-spacing:0">downloads use these filters</span></div><div class="filters">' +
      '<div class="field search"><label>Search</label><input type="search" data-f="q" placeholder="record, batch, task, QE, annotator, checkpoint, note…" value="' + esc(f.q) + '"></div>' +
      '<div class="field"><label>Quality Executive</label><select data-f="auditor"></select></div>' +
      '<div class="field"><label>Verdict</label><select data-f="verdict">' + opts(VERDICTS, f.verdict, "All verdicts") + '</select></div>' +
      '<div class="field"><label>Queue</label><select data-f="queue"></select></div>' +
      '<div class="field date"><label>Submitted from</label><input type="date" data-f="from" value="' + esc(f.from) + '"></div>' +
      '<div class="field date"><label>Submitted to</label><input type="date" data-f="to" value="' + esc(f.to) + '"></div>' +
      '<div class="fclear"><button class="btn" data-act="clear-filters">Clear filters</button></div></div>' +
      '<div class="filter-info" id="finfo"></div>';
    filtersEl.dataset.built = "1";
  }
  filtersEl.querySelector('[data-f=auditor]').innerHTML = opts(uniq("auditor"), f.auditor, "All QEs");
  filtersEl.querySelector('[data-f=queue]').innerHTML = opts(uniq("queue_name"), f.queue, "All queues");
  renderFilterInfo();
}
function renderFilterInfo() {
  const el = document.getElementById("finfo"); if (!el) return;
  const all = allRecords().length, n = filtered().length;
  el.innerHTML = filterActive() ? 'Showing <b>' + n + '</b> of ' + all + ' records. Download Excel / CSV exports these ' + n + '.' : 'No filters applied. Downloads export all ' + all + ' records.';
  const clr = filtersEl.querySelector('[data-act=clear-filters]'); if (clr) clr.disabled = !filterActive();
}

// ── Render: table ─────────────────────────────────────────────────────────
function renderTable() {
  const all = allRecords(), rows = filtered();
  if (!all.length) {
    tableEl.innerHTML = S.loaded || S.error
      ? '<div class="card empty-state"><h4>No audits recorded yet</h4><p>Complete and submit a checklist to add the first record. Every submission is stored in the database and can be downloaded as Excel.</p><a class="btn primary" href="index.html">Start an audit</a></div>'
      : "";
    return;
  }
  if (!rows.length) {
    tableEl.innerHTML = '<div class="card empty-state"><h4>No records match these filters</h4><p>Adjust or clear the filters to see records.</p><button class="btn" data-act="clear-filters">Clear filters</button></div>';
    return;
  }
  const body = rows.map(r => {
    const open = S.open === r.record_id;
    const issues = (r.checks || []).filter(x => x.result === "fail");
    let html = '<tr><td><div class="mono">' + esc(r.record_id) + '</div></td>' +
      '<td><div>' + esc(r.batch_id || "—") + '</div><div class="sub">' + esc(r.queue_name || "") + '</div></td>' +
      '<td>' + esc(r.task_id || "—") + '</td>' +
      '<td><div>' + esc(r.auditor || "—") + '</div><div class="sub">Annot. ' + esc(r.annotator || "—") + '</div></td>' +
      '<td>' + esc(fmtDate(r.submitted_at)) + '</td>' +
      '<td>' + verdictChip(r.verdict) + '</td>' +
      '<td class="r green">' + r.passed + '</td><td class="r ' + (r.failed ? "red" : "muted") + '">' + r.failed + '</td><td class="r muted">' + r.na + '</td>' +
      '<td><span class="' + (r.critical_fails ? "red" : "muted") + '">' + r.critical_fails + '</span> / <span class="' + (r.major_fails ? "amber" : "muted") + '">' + r.major_fails + '</span> / <span class="' + (r.minor_fails ? "gold" : "muted") + '">' + r.minor_fails + '</span></td>' +
      '<td>' + (r._local ? '<span class="amber" style="font-size:11px">not uploaded ✕</span>' : '<span class="green" style="font-size:11px">Database ✓</span>') + '</td>' +
      '<td class="r"><button class="btn ghost accent" data-act="details" data-id="' + esc(r.record_id) + '">' + (open ? "Hide" : "Details") + '</button>' +
      '<button class="btn ghost red" data-act="delete" data-id="' + esc(r.record_id) + '">Delete</button></td></tr>';
    if (open) {
      const det = issues.length
        ? '<div class="det">' + issues.map(x => '<div class="it">' + sevChip(SEV_LABEL[x.severity] ? x.severity : "minor") + '<div><span class="cid">' + esc(x.check_id) + '</span><span class="sec"> · ' + esc(x.section) + '</span><div class="nt' + (x.note ? "" : " empty") + '">' + esc(x.note || "No note recorded.") + '</div></div></div>').join("") + '</div>'
        : '<div class="green">No failed checkpoints. ' + r.na + ' marked N/A.</div>';
      html += '<tr><td class="details" colspan="12">' + det + '</td></tr>';
    }
    return html;
  }).join("");
  tableEl.innerHTML = '<div class="card tbl-wrap"><table><thead><tr><th>Record</th><th>Batch</th><th>Task</th><th>QE</th><th>Submitted</th><th>Verdict</th>' +
    '<th class="r">Pass</th><th class="r">Fail</th><th class="r">N/A</th><th>Crit / Maj / Min</th><th>Saved to</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>';
}
function renderAll() { renderTop(); renderFilters(); renderTable(); }
function applyFilters() { renderTop(); renderFilterInfo(); renderTable(); }

// ── Events ────────────────────────────────────────────────────────────────
document.getElementById("main").addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case "refresh": load(); break;
    case "send-outbox": sendOutbox(); break;
    case "export-xlsx": PA.exportRecords(filtered(), window.XLSX ? "xlsx" : "csv", filterLabel()); break;
    case "export-csv": PA.exportRecords(filtered(), "csv", filterLabel()); break;
    case "details": S.open = S.open === id ? null : id; renderTable(); break;
    case "delete": deleteRecord(id); break;
    case "clear-filters":
      S.filter = { q: "", auditor: "", verdict: "", queue: "", from: "", to: "" };
      filtersEl.querySelectorAll("[data-f]").forEach(i => { i.value = ""; });
      applyFilters(); break;
  }
});
filtersEl.addEventListener("input", e => {
  const el = e.target; if (!el.dataset.f) return;
  S.filter[el.dataset.f] = el.value; applyFilters();
});
filtersEl.addEventListener("change", e => {
  const el = e.target; if (!el.dataset.f) return;
  S.filter[el.dataset.f] = el.value; applyFilters();
});

// ── Boot ──────────────────────────────────────────────────────────────────
renderAll();
PA.initHeader("records").then(async h => {
  if (h.health && S.outbox.length) { await PA.flushOutbox(); S.outbox = PA.loadOutbox(); }
  load();
});
})();
