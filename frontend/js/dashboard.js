// Dashboard page.
//   Top:    every submitted audit in the database (live counts, refreshed on each visit).
//   Bottom: the checklist currently in progress on this browser.
(function () {
"use strict";
const { SECTIONS, esc, plural, fmtDate, computed, verdictChip, issueHTML } = PA;
const main = document.getElementById("main");

const S = { records: null, error: null };

// ── Submitted audits (database) ───────────────────────────────────────────
function submittedHTML() {
  const kpi = (icon, label, value, sub, cls) => '<div class="kpi"><div class="l"><span>' + icon + '</span>' + label + '</div><div class="v ' + (cls || "") + '">' + value + '</div><div class="s">' + sub + '</div></div>';
  if (S.records === null && !S.error) return '<div class="card card-pad dim"><span class="spin"></span> Loading submitted audits…</div>';
  if (S.error) return '<div class="banner red"><div class="grow">Could not load submitted audits: ' + esc(S.error) + '</div><button class="btn" data-act="reload">Retry</button></div>';
  const recs = S.records;
  const outbox = PA.loadOutbox();
  const count = v => recs.filter(r => r.verdict === v).length;
  const total = recs.length;
  const pct = n => total ? Math.round(n / total * 100) + "%" : "—";
  const latest = recs[0];
  const byQE = {};
  recs.forEach(r => { const k = r.auditor || "—"; byQE[k] = byQE[k] || { n:0, hold:0 }; byQE[k].n++; if (r.verdict === "Hold") byQE[k].hold++; });
  const qeRows = Object.entries(byQE).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const failCounts = {};
  recs.forEach(r => (r.checks || []).forEach(c => { if (c.result === "fail") failCounts[c.check_id] = (failCounts[c.check_id] || 0) + 1; }));
  const topFails = Object.entries(failCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const checkText = id => { const c = PA.ALL.find(x => x.id.toUpperCase() === id); return c ? c.text : ""; };

  return '<div class="kpis">' +
      kpi("🗄️", "Submitted audits", total, latest ? "latest " + fmtDate(latest.submitted_at) : "none yet") +
      kpi("✓", "Approved", count("Approved"), pct(count("Approved")) + " of audits", "green") +
      kpi("⚠", "Conditional pass", count("Conditional pass"), pct(count("Conditional pass")) + " of audits", "amber") +
      kpi("⛔", "Hold", count("Hold"), pct(count("Hold")) + " of audits", "red") +
      (outbox.length ? kpi("⏫", "Waiting to upload", outbox.length, "on this browser only", "amber") : "") +
    '</div>' +
    '<div class="grid2">' +
      '<div class="card" style="margin:0"><div class="card-hd">RECENT SUBMISSIONS <a href="records.html" style="font-weight:400;letter-spacing:0">all records →</a></div>' +
        (recs.length ? recs.slice(0, 6).map(r => '<div class="recent"><span class="mono">' + esc(r.record_id) + '</span><span class="grow">' + esc(r.batch_id || "—") + ' <span class="dim">· ' + esc(r.auditor || "—") + '</span></span>' + verdictChip(r.verdict) + '<span class="dim" style="white-space:nowrap">' + esc(fmtDate(r.submitted_at)) + '</span></div>').join("")
          : '<div class="empty-note" style="padding:16px">No audits submitted yet.</div>') + '</div>' +
      '<div class="card" style="margin:0"><div class="card-hd">BY QUALITY EXECUTIVE</div>' +
        (qeRows.length ? qeRows.map(([qe, v]) => '<div class="recent"><span class="grow">' + esc(qe) + '</span><span class="dim">' + plural(v.n, "audit") + '</span>' + (v.hold ? '<span class="chip red">' + v.hold + ' hold</span>' : '<span class="chip green">no holds</span>') + '</div>').join("")
          : '<div class="empty-note" style="padding:16px">—</div>') + '</div>' +
    '</div>' +
    (topFails.length ? '<div class="card"><div class="card-hd">MOST FREQUENTLY FAILED CHECKPOINTS</div>' +
      topFails.map(([id, n]) => '<div class="recent"><span class="mono" style="min-width:36px">' + esc(id) + '</span><span class="grow">' + esc(checkText(id)) + '</span><span class="chip red">' + plural(n, "fail") + '</span></div>').join("") + '</div>' : "");
}

// ── Current audit (this browser's draft) ──────────────────────────────────
function currentHTML() {
  const draft = PA.loadDraft();
  if (!PA.hasProgress(draft)) {
    return '<div class="card empty-state"><h4>No audit in progress</h4><p>Open the checklist to start one. Progress is saved in this browser as you go.</p><a class="btn primary" href="index.html">Open checklist</a></div>';
  }
  const c = computed(draft.vals);
  const { stats, criticalFails, majorFails, minorFails } = c;
  const reviewed = stats.passed + stats.failed + stats.na;
  const passPct = reviewed ? Math.round(stats.passed / reviewed * 100) : 0;
  const failPct = reviewed ? Math.round(stats.failed / reviewed * 100) : 0;
  const totalFails = criticalFails.length + majorFails.length + minorFails.length;
  const chip = !c.ready ? ["In Progress", "accent"] : criticalFails.length ? ["HOLD", "red"] : majorFails.length ? ["Conditional", "amber"] : ["Approved", "green"];
  const kpi = (icon, label, value, sub, cls) => '<div class="kpi"><div class="l"><span>' + icon + '</span>' + label + '</div><div class="v ' + (cls || "") + '">' + value + '</div><div class="s">' + sub + '</div></div>';

  const r = 28, circ = 2 * Math.PI * r;
  const arc = (count, offset, color) => {
    const d = reviewed ? count / stats.total * circ : 0;
    return { d, html: '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="var(--' + color + ')" stroke-width="6" stroke-dasharray="' + d + ' ' + (circ - d) + '" stroke-dashoffset="' + offset + '"/>' };
  };
  const a1 = arc(stats.passed, circ / 4, "green");
  const a2 = arc(stats.failed, circ / 4 - a1.d, "red");
  const a3 = arc(stats.na, circ / 4 - a1.d - a2.d, "muted");
  const legend = [["Passed", stats.passed, "green"], ["Failed", stats.failed, "red"], ["N/A", stats.na, "muted"], ["Pending", stats.pending, "dim"]].map(([l, n, col]) =>
    '<div class="legend-row"><div class="sw" style="background:var(--' + col + ')"></div><span class="lab">' + l + '</span><span class="num ' + col + '">' + n + '</span>' +
    '<div class="bar w60"><i style="width:' + (stats.total ? n / stats.total * 100 : 0) + '%;background:var(--' + col + ')"></i></div></div>').join("");
  const sevRows = [["Critical", criticalFails.length, "red"], ["Major", majorFails.length, "amber"], ["Minor", minorFails.length, "gold"]].map(([l, n, col]) => {
    const pct = totalFails ? Math.round(n / totalFails * 100) : 0;
    return '<div class="sev-row"><div class="top"><span class="' + col + '" style="font-weight:700">' + l + '</span><span class="' + col + '">' + n + ' ' + (n === 1 ? "fail" : "fails") + (totalFails ? " (" + pct + "%)" : "") + '</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:var(--' + col + ')"></i></div></div>';
  }).join("") + (totalFails === 0 ? '<div class="empty-note">' + (stats.pending > 0 ? "Complete all checkpoints to see failures." : "✓ No failures recorded.") + '</div>' : "");
  const progress = SECTIONS.map(s => {
    const total = s.checks.length, failed = s.checks.filter(x => draft.vals[x.id] === "fail").length, pending = s.checks.filter(x => draft.vals[x.id] === null).length;
    const done = total - pending, pct = Math.round(done / total * 100);
    const col = failed > 0 ? "amber" : pct === 100 ? "green" : "accent";
    return '<div class="prog-row"><span style="font-size:16px;min-width:20px">' + s.icon + '</span><div class="name">' + esc(s.label.split(". ")[1]) + '</div>' +
      '<div class="bar"><i style="width:' + pct + '%;background:var(--' + col + ')"></i></div>' +
      '<div class="tail"><span>' + done + '/' + total + '</span>' +
      (failed > 0 ? '<span class="chip red">' + failed + ' fail</span>' : "") +
      (pending > 0 ? '<span class="chip muted">' + pending + ' left</span>' : "") +
      (pending === 0 && failed === 0 ? '<span class="chip green">✓</span>' : "") + '</div></div>';
  }).join("");
  const issues = criticalFails.concat(majorFails, minorFails);

  return PA.metaStrip(draft.meta) +
    '<div class="kpis">' +
      kpi("📋", "Total Checkpoints", stats.total, reviewed + " reviewed") +
      kpi("✓", "Passed", stats.passed, passPct + "% of reviewed", "green") +
      kpi("✗", "Failed", stats.failed, failPct + "% of reviewed", stats.failed > 0 ? "red" : "") +
      kpi("—", "N/A", stats.na, "not applicable", "muted") +
      kpi("⏳", "Pending", stats.pending, "need review", stats.pending > 0 ? "amber" : "") +
      '<div class="kpi" style="align-items:flex-start"><div class="l">🏁 Verdict</div><span class="chip ' + chip[1] + '" style="font-size:15px;font-weight:800;padding:4px 10px;margin-top:4px">' + chip[0] + '</span></div>' +
    '</div>' +
    '<div class="grid2">' +
      '<div class="card" style="margin:0"><div class="card-hd">CHECKPOINT BREAKDOWN</div><div class="card-pad" style="display:flex;align-items:center;gap:20px">' +
        '<svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="6"/>' + a1.html + a2.html + a3.html +
        '<text x="40" y="44" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700">' + stats.total + '</text></svg>' +
        '<div style="flex:1">' + legend + '</div></div></div>' +
      '<div class="card" style="margin:0"><div class="card-hd">FAILURES BY SEVERITY</div><div class="card-pad">' + sevRows + '</div></div>' +
    '</div>' +
    '<div class="card"><div class="card-hd">SECTION PROGRESS</div><div style="padding:4px 0">' + progress + '</div></div>' +
    (issues.length ? '<div class="card"><div class="card-hd">OPEN ISSUES</div>' + issues.map(x => issueHTML(x, draft.notes[x.id], true)).join("") + '</div>' : "") +
    (c.ready && !issues.length ? '<div class="celebrate"><div class="big">🎉</div><div class="t">All checkpoints cleared — batch approved for delivery.</div></div>' : "") +
    '<div style="margin-top:12px"><a class="btn primary" href="index.html">Continue checklist →</a></div>';
}

function render() {
  main.innerHTML = '<div class="section-title">Submitted audits · shared database</div>' + submittedHTML() +
    '<div class="section-title">Current audit · this browser</div>' + currentHTML();
}

async function load() {
  S.records = null; S.error = null; render();
  try {
    const d = await PA.api("/api/records");
    S.records = d.records || []; PA.setHeaderHealth(true, null, S.records.length);
  } catch (e) { S.error = e.message; PA.setHeaderHealth(false, e.message); }
  render();
}

main.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  if (el.dataset.act === "reload") load();
});

render();
PA.initHeader("dashboard").then(h => { if (h.health) PA.flushOutbox(); load(); });
})();
