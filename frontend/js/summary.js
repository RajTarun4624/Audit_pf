// Summary page.
//   Right after a submission (or whenever nothing is in progress) it shows the last submitted audit.
//   While a checklist is in progress it shows that audit instead, with a link to the last submission.
(function () {
"use strict";
const { SECTIONS, esc, plural, fmtDate, computed, sevChip, issueHTML, verdictBox } = PA;
const main = document.getElementById("main");
const params = new URLSearchParams(window.location.search);

function summaryBody(d, c) {
  const { stats } = c;
  const reviewed = stats.passed + stats.failed + stats.na;
  const pct = stats.total ? Math.round(reviewed / stats.total * 100) : 0;
  const radius = 42, circ = 2 * Math.PI * radius, dash = pct / 100 * circ;
  const m = d.meta;
  const kvs = [["Task ID", m.taskId], ["Queue", m.queueName], ["QE", m.auditor], ["Annotator", m.annotatorName], ["Annotated", m.annotationDate], ["Audited", m.auditDate]]
    .map(([l, v]) => '<span class="kv"><span class="k">' + l + ':</span> <span class="v' + (v ? "" : " empty") + '">' + esc(v || "—") + '</span></span>').join("");
  const gauge = '<div class="gauge"><svg width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--border)" stroke-width="7"/>' +
    '<circle cx="50" cy="50" r="' + radius + '" fill="none" stroke="var(--' + (stats.failed > 0 ? "amber" : "green") + ')" stroke-width="7" stroke-dasharray="' + dash + ' ' + (circ - dash) + '" stroke-dashoffset="' + (circ / 4) + '" stroke-linecap="round"/>' +
    '<text x="50" y="47" text-anchor="middle" fill="var(--text)" font-size="20" font-weight="700">' + pct + '%</text><text x="50" y="61" text-anchor="middle" fill="var(--dim)" font-size="9">reviewed</text></svg>' +
    '<div class="gauge-legend">' + [["Passed", "green", stats.passed], ["Failed", "red", stats.failed], ["N/A", "muted", stats.na], ["Pending", "dim", stats.pending]].map(([l, col, n]) =>
      '<div><div class="sw" style="background:var(--' + col + ')"></div><span>' + l + '</span><b class="' + col + '">' + n + '</b></div>').join("") + '</div></div>';
  const sections = SECTIONS.map(s => {
    const fails = s.checks.filter(x => d.vals[x.id] === "fail").length, pending = s.checks.filter(x => d.vals[x.id] === null).length;
    return '<div class="sec-line"><span style="font-size:16px">' + s.icon + '</span><div class="lab">' + esc(s.label) + '</div><div style="display:flex;gap:6px">' +
      (fails ? '<span class="chip red">' + fails + ' fail</span>' : "") + (pending ? '<span class="chip muted">' + pending + ' left</span>' : "") +
      (!fails && !pending ? '<span class="chip green">✓</span>' : "") + '</div></div>';
  }).join("");
  const log = c.criticalFails.concat(c.majorFails);
  return '<div class="card sum-hd"><div><div class="batch">' + esc(m.batchId || "—") + '</div><div class="kvs">' + kvs + '</div><div class="dim" style="font-size:11px;margin-top:6px">PA Data Collection Audit · GR16</div></div>' + gauge + '</div>' +
    verdictBox(c) +
    '<div class="card"><div class="card-hd">SECTION BREAKDOWN</div>' + sections + '</div>' +
    (log.length ? '<div class="card"><div class="card-hd">FAILED ITEMS LOG</div>' + log.map(x => issueHTML(x, d.notes[x.id], true)).join("") + '</div>' : "");
}

function render() {
  const draft = PA.loadDraft();
  const last = PA.loadLast();
  const inProgress = PA.hasProgress(draft);
  const showLast = last && (!inProgress || params.get("submitted") === "1" || params.get("last") === "1");

  if (showLast) {
    const rec = last.record;
    const outbox = PA.loadOutbox();
    const stillWaiting = outbox.some(r => r.record_id === rec.record_id);
    const banner = !stillWaiting
      ? '<div class="banner green"><span style="font-size:18px">✓</span><div class="grow">Audit submitted · ' + esc(fmtDate(last.at)) + ' · saved to the database as ' + esc(rec.record_id) +
          '<div class="sub">The checklist has been reset for the next audit.</div></div>' +
          '<a class="btn primary" href="index.html">Start next audit</a><a class="btn" href="records.html">Open records</a></div>'
      : '<div class="banner amber"><span style="font-size:18px">!</span><div class="grow">Audit recorded on this browser at ' + esc(fmtDate(last.at)) + ' but the backend could not be reached' + (last.error ? " (" + esc(last.error) + ")" : "") + '.' +
          '<div class="sub">It will upload automatically when the backend is back, or use Send now on the Records page. The checklist has been reset for the next audit.</div></div>' +
          '<a class="btn primary" href="index.html">Start next audit</a><a class="btn" href="records.html">Open records</a></div>';
    const c = computed(last.vals);
    main.innerHTML = '<div class="section-title">Last submitted audit</div>' + banner + summaryBody(last, c) +
      (inProgress ? '<div class="dim" style="font-size:12px;margin-top:8px">A new checklist is already in progress. <a href="summary.html">Show its summary</a>.</div>' : "");
    return;
  }
  if (inProgress) {
    const c = computed(draft.vals);
    main.innerHTML = '<div class="section-title">Current audit · in progress</div>' +
      '<div class="banner blue"><div class="grow">' + (c.ready ? "All checkpoints answered — submit it from the checklist." : plural(c.stats.pending, "checkpoint") + " still to review.") + '</div>' +
      '<a class="btn primary" href="index.html">' + (c.ready ? "Go to submit" : "Continue checklist") + '</a></div>' +
      summaryBody(draft, c) +
      (last ? '<div class="dim" style="font-size:12px;margin-top:8px"><a href="summary.html?last=1">Show the last submitted audit</a> (' + esc(last.record.record_id) + ').</div>' : "");
    return;
  }
  main.innerHTML = '<div class="card empty-state"><h4>Nothing to summarise yet</h4><p>No checklist is in progress on this browser and nothing has been submitted from it. Submitted audits from every device are on the Records page.</p>' +
    '<a class="btn primary" href="index.html">Start an audit</a> <a class="btn" href="records.html">Open records</a></div>';
}

render();
PA.initHeader("summary").then(async h => {
  if (h.health && PA.loadOutbox().length) { await PA.flushOutbox(); PA.initHeader("summary"); render(); }
});
})();
