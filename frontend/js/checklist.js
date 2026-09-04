// Checklist page: metadata form, the checkpoint sections, submit bar.
// The draft is saved to the browser on every change and cleared after a successful submission.
(function () {
"use strict";
const { SECTIONS, esc, plural, computed, sevChip, statusChip } = PA;
const main = document.getElementById("main");

const S = {
  draft: PA.loadDraft(),
  expanded: Object.fromEntries(SECTIONS.map(s => [s.id, true])),
  expandedCheck: {},
  submitting: false,
  error: null,
};
const save = () => PA.saveDraft(S.draft);

// ── Render ────────────────────────────────────────────────────────────────
function metaFormHTML() {
  const m = S.draft.meta;
  const f = (k, label, ph, cls, type) =>
    '<div class="field ' + (cls || "") + '"><label>' + label + '</label><input type="' + (type || "text") + '" data-meta="' + k + '" value="' + esc(m[k]) + '" placeholder="' + esc(ph || "") + '"></div>';
  return '<div class="card meta">' +
    '<div class="meta-row">' + f("taskId", "Task ID", "e.g. PA-2026-0801") + f("queueName", "Queue Name", "e.g. GR16-PA-Pilot") + f("batchId", "Batch ID / File Name", "e.g. single_turn_task001", "wide") + '</div>' +
    '<div class="meta-row">' + f("auditor", "Quality Executive Name", "QE full name") + f("annotatorName", "Annotator Name", "Annotator full name") +
      f("annotationDate", "Annotation Date", "", "date", "date") + f("auditDate", "Audit Date", "", "date", "date") + '</div></div>';
}

function checkRowHTML(c) {
  const v = S.draft.vals[c.id], open = !!S.expandedCheck[c.id];
  let html = '<div class="chk' + (v === "fail" ? " failed" : "") + '">' +
    '<div class="chk-hd" data-act="toggle-check" data-id="' + c.id + '">' +
      '<span class="chk-caret">' + (open ? "▾" : "▸") + '</span>' +
      '<div class="chk-sev">' + sevChip(c.severity) + '</div>' +
      '<div class="chk-text"><span class="accent" style="font-weight:700;margin-right:6px">' + esc(c.id) + '</span>' + esc(c.text) + '</div>' +
      '<div class="chk-status">' + statusChip(v) + '</div></div>';
  if (open) {
    html += '<div class="chk-body"><div class="guide"><b>Guidance:</b>' + esc(c.guidance) + '</div>' +
      '<div class="chk-ctl"><div class="radio">' +
        [["pass","Pass"],["fail","Fail"],["na","N/A"]].map(([val, label]) =>
          '<button class="' + val + (v === val ? " on" : "") + '" data-act="set" data-id="' + c.id + '" data-val="' + val + '">' + label + '</button>').join("") +
      '</div><input class="note" data-note="' + c.id + '" placeholder="QE note (optional)…" value="' + esc(S.draft.notes[c.id]) + '"></div></div>';
  }
  return html + '</div>';
}

function sectionHTML(s) {
  const fail = s.checks.filter(c => S.draft.vals[c.id] === "fail").length;
  const pending = s.checks.filter(c => S.draft.vals[c.id] === null).length;
  const done = s.checks.length - pending, pct = Math.round(done / s.checks.length * 100);
  const open = !!S.expanded[s.id];
  return '<div class="card"><div class="sec-hd' + (open ? " open" : "") + '" data-act="toggle-section" data-id="' + s.id + '">' +
      '<span class="sec-icon">' + s.icon + '</span>' +
      '<div style="flex:1"><div class="sec-title">' + esc(s.label) + '</div><div class="sec-desc">' + esc(s.desc) + '</div></div>' +
      '<div class="sec-right">' +
        (fail > 0 ? '<span class="chip red">' + fail + ' fail</span>' : "") +
        (pending > 0 ? '<span class="chip muted">' + pending + ' left</span>' : "") +
        (pending === 0 && fail === 0 ? '<span class="chip green">✓ Clear</span>' : "") +
        '<div class="bar w60"><i style="width:' + pct + '%;background:var(--' + (fail > 0 ? "amber" : "green") + ')"></i></div>' +
        '<span class="caret">' + (open ? "▾" : "▸") + '</span></div></div>' +
    (open ? s.checks.map(checkRowHTML).join("") : "") + '</div>';
}

function submitBarHTML(c) {
  const { stats, criticalFails, majorFails, ready } = c;
  const pending = stats.pending, done = stats.total - pending;
  const r = 14, circ = 2 * Math.PI * r, pct = stats.total ? done / stats.total : 0, dash = pct * circ;
  const statusText = pending > 0 ? plural(pending, "checkpoint") + " remaining"
    : criticalFails.length > 0 ? plural(criticalFails.length, "critical failure") + " — resolve before submitting"
    : majorFails.length > 0 ? plural(majorFails.length, "major issue") + " — submission allowed with remediation note"
    : "All checkpoints complete — ready to submit";
  const statusCls = pending > 0 ? "dim" : criticalFails.length > 0 ? "red" : majorFails.length > 0 ? "amber" : "green";
  const enabled = ready && !S.submitting;
  return '<div class="submit' + (ready ? " ready" : "") + '">' +
    '<svg width="36" height="36" viewBox="0 0 36 36" style="flex-shrink:0"><circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" stroke-width="4"/>' +
    '<circle cx="18" cy="18" r="14" fill="none" stroke="var(--' + (ready ? "green" : "accent") + ')" stroke-width="4" stroke-dasharray="' + dash + ' ' + (circ - dash) + '" stroke-dashoffset="' + (circ / 4) + '" stroke-linecap="round"/>' +
    '<text x="18" y="22" text-anchor="middle" fill="var(--dim)" font-size="9" font-weight="700">' + Math.round(pct * 100) + '%</text></svg>' +
    '<div style="display:flex;gap:16px;flex:1;flex-wrap:wrap;align-items:center"><div class="counts">' +
      '<div class="count"><b class="green">' + done + '</b><span>Done</span></div>' +
      '<div class="count"><b class="' + (pending > 0 ? "amber" : "dim") + '">' + pending + '</b><span>Pending</span></div>' +
      '<div class="count"><b class="' + (stats.failed > 0 ? "red" : "dim") + '">' + stats.failed + '</b><span>Failed</span></div></div>' +
      '<div class="' + statusCls + '" style="font-size:12px">' + statusText + '</div></div>' +
    '<div style="display:flex;gap:8px;align-items:center">' +
      '<button class="btn" data-act="clear"' + (PA.hasProgress(S.draft) && !S.submitting ? "" : " disabled") + '>Clear</button>' +
      '<button class="btn big' + (ready ? " primary" : "") + '" data-act="submit"' + (enabled ? "" : " disabled") + '>' + (S.submitting ? '<span class="spin"></span> Saving…' : "Submit Audit") + '</button>' +
    '</div></div>' +
    (S.error ? '<div class="banner red" style="margin-top:12px"><div class="grow">' + esc(S.error) + '</div></div>' : "");
}

function render() {
  const c = computed(S.draft.vals);
  main.innerHTML = metaFormHTML() + SECTIONS.map(sectionHTML).join("") + submitBarHTML(c);
}
// Re-render everything except the metadata inputs (so typing there keeps focus).
function renderBelowMeta() {
  const c = computed(S.draft.vals);
  const meta = main.querySelector(".meta");
  if (!meta) return render();
  let next = meta.nextElementSibling;
  while (next) { const n = next.nextElementSibling; next.remove(); next = n; }
  meta.insertAdjacentHTML("afterend", SECTIONS.map(sectionHTML).join("") + submitBarHTML(c));
}

// ── Submit ────────────────────────────────────────────────────────────────
async function submitAudit() {
  const c = computed(S.draft.vals);
  if (!c.ready || S.submitting) return;
  S.submitting = true; S.error = null; renderBelowMeta();
  const now = new Date();
  const rec = PA.buildRecord(S.draft, now);
  const res = await PA.pushRecord(rec);
  if (!res.ok) {
    const outbox = PA.loadOutbox(); outbox.push(rec); PA.saveOutbox(outbox);
  }
  // Snapshot for the Summary page, then reset the checklist for the next audit.
  PA.saveLast({ record: rec, vals: S.draft.vals, notes: S.draft.notes, meta: S.draft.meta, at: now.toISOString(), uploadOk: res.ok, error: res.error || null });
  PA.clearDraft();
  window.location.href = "summary.html?submitted=1";
}

function clearChecklist() {
  if (!window.confirm("Clear every answer and the metadata fields on this checklist?")) return;
  S.draft = PA.blankDraft(); S.expandedCheck = {}; PA.clearDraft(); render(); window.scrollTo(0, 0);
}

// ── Events ────────────────────────────────────────────────────────────────
main.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case "toggle-section": S.expanded[id] = !S.expanded[id]; renderBelowMeta(); break;
    case "toggle-check":   S.expandedCheck[id] = !S.expandedCheck[id]; renderBelowMeta(); break;
    case "set": {
      const val = el.dataset.val;
      S.draft.vals[id] = S.draft.vals[id] === val ? null : val;
      save(); renderBelowMeta(); break;
    }
    case "submit": submitAudit(); break;
    case "clear": clearChecklist(); break;
  }
});
main.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.meta) { S.draft.meta[el.dataset.meta] = el.value; save(); const b = main.querySelector('[data-act=clear]'); if (b) b.disabled = !PA.hasProgress(S.draft); }
  else if (el.dataset.note) { S.draft.notes[el.dataset.note] = el.value; save(); }
});

// ── Boot ──────────────────────────────────────────────────────────────────
render();
PA.initHeader("checklist").then(h => { if (h.health) PA.flushOutbox().then(() => PA.initHeader("checklist")); });
})();
