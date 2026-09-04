import { useState, useCallback } from "react";

// ── Design tokens ─────────────────────────────────────────────────────────
const C = {
  bg:       "#0F1117",
  surface:  "#181C27",
  panel:    "#1E2435",
  border:   "#2A3048",
  accent:   "#4F7FFF",
  accentLo: "#1A2A55",
  gold:     "#F5C842",
  goldLo:   "#3A2E08",
  red:      "#FF4D4D",
  redLo:    "#3A1010",
  green:    "#3DBA77",
  greenLo:  "#0F2E1D",
  amber:    "#F5924A",
  amberLo:  "#3A2010",
  muted:    "#6B7599",
  text:     "#D6DBF0",
  textDim:  "#8A91B4",
  badge:    "#252B3D",
};

// ── Checkpoint definitions ────────────────────────────────────────────────
const SECTIONS = [
  {
    id: "schema", label: "1. Schema & File Integrity", icon: "⬡",
    desc: "Verify JSONL structure, required fields, and format consistency before any content review.",
    checks: [
      { id:"s1",  severity:"critical", text:"Every sample is a valid single-line JSON object (no broken lines, trailing commas, or unescaped characters).", guidance:"Parse each line; any parse error = fail. Use jq or Python json.loads in a loop." },
      { id:"s2",  severity:"critical", text:"All required top-level fields are present: dataset, input, meta_data, output, annotation, source.", guidance:"Missing any field = fail. Null values count as absent." },
      { id:"s3",  severity:"critical", text:"meta_data contains all sub-fields: data_type, data_length_chars, data_length_bucket, data_structure, attack_type, attack_subcategory, domain, role, verified, language, source_description.", guidance:"Check sub-field presence independently from parent presence." },
      { id:"s4",  severity:"critical", text:"output object contains all three boolean fields: jailbreak, prompt_injection, prompt_leakage.", guidance:"All three must be present; value must be boolean true/false, not string." },
      { id:"s5",  severity:"critical", text:"annotation.severity contains J, I, L keys each with integer 0–5. annotation.intention is one of: benign | adversarial | hard_to_say.", guidance:"Out-of-range scores or misspelled intention values = fail." },
      { id:"s6",  severity:"critical", text:"input field is non-empty. For multi-turn/agentic types, input is a JSON array of role/content objects; for single-turn and general_text it is a plain string.", guidance:"Empty string or empty array = fail." },
      { id:"s7",  severity:"major",    text:"meta_data.data_length_chars matches the actual character count of the input field (±10 chars tolerance).", guidance:"Count chars server-side and compare. Common discrepancy source: multi-turn inputs where annotators measured only one turn." },
      { id:"s8",  severity:"major",    text:"meta_data.data_length_bucket correctly maps to the stated data_length_chars value (e.g., 500 chars → '100-500 char' bucket).", guidance:"Use the 11-bucket range table from the SOP Section 6." },
      { id:"s9",  severity:"major",    text:"meta_data.language is 'en' for all samples in this batch.", guidance:"Batch is English-only per SOP." },
      { id:"s10", severity:"major",    text:"No duplicate samples exist within or across previously delivered batches (check on input field hash).", guidance:"SHA-256 the input value; compare against a running dedup ledger." },
    ],
  },
  {
    id: "label", label: "2. Label Logic & Consistency", icon: "◈",
    desc: "Check that output labels, severity scores, and intention values are internally coherent and follow the SOP decision flow.",
    checks: [
      { id:"l1", severity:"critical", text:"If output.jailbreak is true, annotation.severity.J is ≥ 1. If output.jailbreak is false, annotation.severity.J is 0.", guidance:"A true label with severity 0 (or a false label with severity >0) is a direct contradiction. Flag both directions." },
      { id:"l2", severity:"critical", text:"Same consistency rule for prompt_injection ↔ severity.I and prompt_leakage ↔ severity.L.", guidance:"Apply identical check as l1 for the I and L axes independently." },
      { id:"l3", severity:"major",    text:"Samples with all three output labels false have severity J=0, I=0, L=0 and intention=benign (unless annotator flags hard_to_say with justification).", guidance:"A fully-benign output label paired with adversarial intention is logically inconsistent; flag for review." },
      { id:"l4", severity:"major",    text:"The annotator applied the Appendix A exemption correctly: samples coded as educational/defensive/academic are labeled benign (severity=0) even when surface text resembles an attack.", guidance:"Spot-check 10% of severity-0 samples that contain attack-adjacent language. Confirm exemption criteria genuinely apply." },
      { id:"l5", severity:"major",    text:"Dual-label samples (both jailbreak and prompt_injection = true) genuinely exhibit both attack types simultaneously in the input, not just thematic overlap.", guidance:"Read each dual-label sample carefully. If only one attack type is detectable, downgrade the secondary label." },
      { id:"l6", severity:"major",    text:"Severity boundary guidance is respected: score 3 requires a recognizable attack pattern; score 4 requires clear intentional sophistication; score 5 requires explicit, blatant attack with zero benign interpretation.", guidance:"Check every score-5 sample — if any benign reading is plausible, it is at most a 4." },
      { id:"l7", severity:"minor",    text:"Severity scores are differentiated appropriately across the 0–5 scale. Batch does not show excessive clustering (>50% of labelled samples at a single score).", guidance:"Compute distribution histogram. Clustering at 3 or 5 is a common pattern that indicates calibration drift." },
      { id:"l8", severity:"major",    text:"Intention annotation is applied at the user's underlying goal level, not the surface request. A security researcher asking about jailbreaks should be benign intention, not adversarial.", guidance:"Spot-check intention labels on samples with clearly defensive or academic framing." },
    ],
  },
  {
    id: "metadata", label: "3. Metadata Accuracy", icon: "◉",
    desc: "Confirm that taxonomy fields correctly describe the actual input content.",
    checks: [
      { id:"m1", severity:"major",    text:"meta_data.data_type matches the actual input structure: 'single_turn', 'multi_turn', 'agentic', 'general_text'.", guidance:"For multi_turn: final turn must be user role. For agentic: must include at least one non-user/assistant role." },
      { id:"m2", severity:"major",    text:"meta_data.data_structure correctly identifies the dominant format: general_text | JSON | Code | XML/HTML | List/Table/CSV | Markdown | YAML/TOML | Mixed.", guidance:"Mixed should only be used when two or more distinct formats are embedded." },
      { id:"m3", severity:"critical", text:"meta_data.attack_type matches the output labels (e.g., if output.jailbreak=true, attack_type should be 'jailbreak', not 'benign').", guidance:"Benign attack_type must align with all-false output labels." },
      { id:"m4", severity:"minor",    text:"meta_data.attack_subcategory is a valid subcategory from the SOP tables for the stated attack_type (or 'N/A' for benign).", guidance:"Cross-reference against Sections 5.1–5.3 subcategory lists. 'Any' is a valid value for novel attacks." },
      { id:"m5", severity:"major",    text:"meta_data.domain is one of the 15 domains listed in Section 9 (or 'Other'). No single domain exceeds 15% of the batch.", guidance:"Compute domain distribution. Flag if any domain is over-represented." },
      { id:"m6", severity:"major",    text:"meta_data.role correctly identifies the primary role of the input.", guidance:"Compare stated role against the actual message objects in the input array." },
      { id:"m7", severity:"major",    text:"meta_data.verified is a boolean. 'true' samples must have source_description explaining the confirmed real-world PA behavior.", guidance:"Verified=true without a meaningful source_description = flag as unverified." },
      { id:"m8", severity:"critical", text:"meta_data.source is either 'real_customer' or 'real_user'.", guidance:"Any other value (e.g., 'synthetic', 'generated') is not permitted per the data request." },
    ],
  },
  {
    id: "content", label: "4. Content & Annotation Quality", icon: "◇",
    desc: "Qualitative review of input content appropriateness, attack authenticity, and benign tier classification.",
    checks: [
      { id:"c1", severity:"major",    text:"Positive (attack) samples contain a genuine, identifiable attack pattern — not just attack-adjacent language or a misidentified legitimate request.", guidance:"Read each attack sample end-to-end. If the attack intent is not discernible without stretching interpretation, downgrade to benign or flag for re-annotation." },
      { id:"c2", severity:"minor",    text:"Benign Tier 3 (hard benign) samples are genuinely deceptive to a surface classifier — they contain instruction-like or override-like language in a non-adversarial context.", guidance:"If a Tier 3 sample looks clearly benign without any effort, it should be reclassified as Tier 1 or 2." },
      { id:"c3", severity:"major",    text:"For structure-exploiting attacks (JSON, Code, XML, HTML, YAML, Markdown), the attack payload exploits the specific structure format — not just a plain-text attack inside a structured wrapper.", guidance:"E.g., a jailbreak string in a JSON value field should use the JSON field semantics as part of the attack mechanism." },
      { id:"c4", severity:"major",    text:"Long-context samples (>20K chars) contain naturally embedded attacks at varied positions (beginning, middle, end) — not all attacks at the document end.", guidance:"For long attack samples, record the character position of the attack payload. Flag batches where >70% of attacks appear in the final 10% of the document." },
      { id:"c5", severity:"major",    text:"Agentic samples include at least one non-user/assistant role and the role distribution is realistic for an agentic workflow.", guidance:"A 'agentic' sample that is just [user, assistant, user] is mis-typed — reclassify as multi_turn." },
      { id:"c6", severity:"minor",    text:"Multi-turn attack samples place attacks at varied turn positions — not exclusively in the final user turn.", guidance:"Crescendo/compliance-momentum attacks should show escalation across turns." },
      { id:"c7", severity:"critical", text:"No input contains real PII (names, emails, phone numbers, IDs) that should have been redacted prior to annotation.", guidance:"Spot-check using a regex scan for common PII patterns. Escalate any confirmed PII to the data privacy lead immediately." },
      { id:"c8", severity:"critical", text:"No input contains literal harmful instructions (e.g., actual synthesis routes, working exploit code) that passed through without appropriate labeling and escalation.", guidance:"Any sample with severity=5 and genuinely actionable harmful content must be flagged to the trust & safety lead, not just labeled." },
    ],
  },
  {
    id: "distribution", label: "5. Batch Distribution Compliance", icon: "◫",
    desc: "Validate that the batch meets the SOP-mandated distribution requirements before submission.",
    checks: [
      { id:"d1", severity:"critical", text:"All four data types are represented: single_turn, multi_turn, agentic, general_text.", guidance:"A batch missing any of the four data types is incomplete per Section 12 pilot requirements." },
      { id:"d2", severity:"critical", text:"All four attack categories are represented: jailbreak, prompt_injection, prompt_leakage, benign.", guidance:"Zero samples in any category = batch fails distribution requirement." },
      { id:"d3", severity:"major",    text:"Long-context coverage: at least some samples are >20K chars, and at least 10% of the batch is >10K chars.", guidance:"Per Section 12, long-context data must be represented in the pilot." },
      { id:"d4", severity:"major",    text:"Verified data is at least 25% of the batch (per Section 13 target ratio).", guidance:"Compute: count(verified=true) / total. If below 25%, flag as distribution gap." },
      { id:"d5", severity:"major",    text:"No single domain exceeds 15% of total samples (per Section 9).", guidance:"Compute per-domain counts. A domain at 16%+ is a distribution violation." },
      { id:"d6", severity:"minor",    text:"Role distribution is roughly within the target ranges from Section 8: user ~30%, system ~20%, assistant ~20%, tool ~10%, memory ~10%, env_feedback ~10%.", guidance:"Allow ±10pp deviation. Extreme imbalance (e.g., 80% user role) is a structural gap." },
      { id:"d7", severity:"minor",    text:"Data structure distribution is approximately 70% general_text and 30% structured formats.", guidance:"Flag if structured formats are <15% or >50% of batch." },
      { id:"d8", severity:"minor",    text:"Benign data covers all three tiers: Easy (~30%), Moderate (~40%), Hard (~30%). Tier is documented in source_description.", guidance:"If tier breakdown is not logged in source_description, ask annotators to add it before submission." },
      { id:"d9", severity:"major",    text:"Data length distribution includes samples across at least 6 of the 11 length buckets.", guidance:"A batch concentrated in 1–3 buckets fails the length diversity requirement." },
    ],
  },
  {
    id: "iaa", label: "6. Inter-Annotator Agreement", icon: "◌",
    desc: "Review IAA statistics and flag calibration issues before sign-off.",
    checks: [
      { id:"i1", severity:"critical", text:"README deliverable includes IAA statistics (Cohen's Kappa or Fleiss' Kappa) for overall label, severity, and intention separately.", guidance:"If README is missing IAA, hold batch until it is provided — it is a required deliverable per Section 16." },
      { id:"i2", severity:"major",    text:"Overall label IAA (jailbreak/injection/leakage/benign) is ≥ 0.70 (acceptable) or ≥ 0.80 (good). Flag if <0.70.", guidance:"<0.70 indicates annotators are disagreeing significantly on what constitutes an attack; escalate for calibration session." },
      { id:"i3", severity:"major",    text:"Severity score IAA (weighted Kappa or correlation) is ≥ 0.60. Severity is inherently harder to agree on than labels.", guidance:"Severity IAA <0.50 is a red flag — convene annotator calibration with worked examples from Appendix C." },
      { id:"i4", severity:"major",    text:"Intention label IAA is ≥ 0.65. 'Hard to say' should not be used by annotators to avoid judgment — check that 'hard_to_say' rate is <20% of all samples.", guidance:">20% hard_to_say suggests annotators are avoiding difficult calls. Facilitate a calibration review." },
      { id:"i5", severity:"major",    text:"Annotation was done independently — no evidence of cross-copying (e.g., identical annotation rationale strings across multiple annotators).", guidance:"Spot-check source_description or any rationale fields for near-duplicate text across different annotators." },
    ],
  },
  {
    id: "delivery", label: "7. Delivery Package", icon: "◻",
    desc: "Confirm all required deliverables are present and meet spec before submission to client.",
    checks: [
      { id:"dv1", severity:"critical", text:"Four JSONL files delivered: single_turn.jsonl, multi_turn.jsonl, agentic_turn.jsonl, general_text.jsonl.", guidance:"Missing any file = incomplete delivery. Empty files also count as missing." },
      { id:"dv2", severity:"major",    text:"File naming follows the SOP convention: {data_type}_{batch_number}_{date}.jsonl (e.g., single_turn_batch01_20260801.jsonl).", guidance:"Reject non-conforming filenames — they affect the client's ingestion pipeline." },
      { id:"dv3", severity:"critical", text:"README is present and includes: per-category counts, data type counts, structure format counts, length bucket counts, domain breakdown, role breakdown, severity distribution, verified vs. unverified breakdown, and IAA statistics.", guidance:"Check each section of the README against the checklist in Section 16. Missing subsections = incomplete." },
      { id:"dv4", severity:"major",    text:"All JSONL files are UTF-8 encoded with no BOM. Line endings are Unix (LF), not Windows (CRLF).", guidance:"Use file --mime-encoding and check for \\r characters. CRLF causes parse errors in some pipelines." },
      { id:"dv5", severity:"major",    text:"README distribution numbers match the actual file contents (cross-validate by counting).", guidance:"README stating 500 samples but file containing 487 is a discrepancy that must be resolved before delivery." },
      { id:"dv6", severity:"critical", text:"Batch has been validated against all Section 16 automated checks: no empty inputs, severity in range, label-severity consistency, char count accuracy, no intra-batch duplicates.", guidance:"Run the validation script before QE sign-off. Attach the validation report to the delivery package." },
    ],
  },
];

const SEV_META = {
  critical: { label:"Critical", color:C.red,   bg:C.redLo   },
  major:    { label:"Major",    color:C.amber,  bg:C.amberLo },
  minor:    { label:"Minor",    color:C.gold,   bg:C.goldLo  },
};

// ── State hook ────────────────────────────────────────────────────────────
function useBatchState() {
  const allIds = SECTIONS.flatMap(s => s.checks.map(c => c.id));
  const [vals,           setVals]           = useState(() => Object.fromEntries(allIds.map(id => [id, null])));
  const [notes,          setNotes]          = useState(() => Object.fromEntries(allIds.map(id => [id, ""])));
  const [taskId,         setTaskId]         = useState("");
  const [queueName,      setQueueName]      = useState("");
  const [batchId,        setBatchId]        = useState("");
  const [auditor,        setAuditor]        = useState("");
  const [annotatorName,  setAnnotatorName]  = useState("");
  const [annotationDate, setAnnotationDate] = useState("");
  const [auditDate,      setAuditDate]      = useState("");
  const [expanded,       setExpanded]       = useState(() => Object.fromEntries(SECTIONS.map(s => [s.id, true])));
  const [expandedCheck,  setExpandedCheck]  = useState({});
  const [submitted,      setSubmitted]      = useState(false);
  const [submittedAt,    setSubmittedAt]    = useState(null);

  const set          = useCallback((id, v) => setVals(p  => ({ ...p, [id]: v })), []);
  const setNote      = useCallback((id, v) => setNotes(p => ({ ...p, [id]: v })), []);
  const toggleSection = useCallback(id => setExpanded(p      => ({ ...p, [id]: !p[id] })), []);
  const toggleCheck   = useCallback(id => setExpandedCheck(p => ({ ...p, [id]: !p[id] })), []);

  const stats = {
    total:   allIds.length,
    passed:  Object.values(vals).filter(v => v === "pass").length,
    failed:  Object.values(vals).filter(v => v === "fail").length,
    na:      Object.values(vals).filter(v => v === "na").length,
    pending: Object.values(vals).filter(v => v === null).length,
  };

  const criticalFails = SECTIONS.flatMap(s => s.checks.filter(c => vals[c.id] === "fail" && c.severity === "critical"));
  const majorFails    = SECTIONS.flatMap(s => s.checks.filter(c => vals[c.id] === "fail" && c.severity === "major"));
  const minorFails    = SECTIONS.flatMap(s => s.checks.filter(c => vals[c.id] === "fail" && c.severity === "minor"));
  const ready      = stats.pending === 0;
  const canSubmit  = ready && criticalFails.length === 0;

  return {
    vals, notes, taskId, queueName, batchId, auditor, annotatorName, annotationDate, auditDate,
    expanded, expandedCheck, set, setNote,
    setTaskId, setQueueName, setBatchId, setAuditor, setAnnotatorName, setAnnotationDate, setAuditDate,
    toggleSection, toggleCheck,
    stats, criticalFails, majorFails, minorFails, ready, canSubmit,
    submitted, submittedAt, setSubmitted, setSubmittedAt,
  };
}

// ── Shared atoms ──────────────────────────────────────────────────────────
function StatusBadge({ val }) {
  const map = {
    pass: { label:"Pass", color:C.green, bg:C.greenLo },
    fail: { label:"Fail", color:C.red,   bg:C.redLo   },
    na:   { label:"N/A",  color:C.muted, bg:C.badge    },
    null: { label:"—",    color:C.textDim, bg:"transparent" },
  };
  const m = map[val] ?? map[null];
  return (
    <span style={{ fontSize:11, fontWeight:700, color:m.color, background:m.bg,
      padding:"2px 8px", borderRadius:4, display:"inline-block", minWidth:36, textAlign:"center" }}>
      {m.label}
    </span>
  );
}

function SevChip({ sev }) {
  const m = SEV_META[sev];
  return (
    <span style={{ fontSize:10, fontWeight:700, letterSpacing:".06em",
      color:m.color, background:m.bg, padding:"2px 7px", borderRadius:3, display:"inline-block" }}>
      {m.label.toUpperCase()}
    </span>
  );
}

function RadioGroup({ id, val, onChange }) {
  const opts = [
    { v:"pass", label:"Pass", color:C.green, lo:C.greenLo },
    { v:"fail", label:"Fail", color:C.red,   lo:C.redLo   },
    { v:"na",   label:"N/A",  color:C.muted, lo:C.badge   },
  ];
  return (
    <div style={{ display:"flex", gap:6 }}>
      {opts.map(o => {
        const active = val === o.v;
        return (
          <button key={o.v} onClick={() => onChange(id, active ? null : o.v)} style={{
            padding:"4px 12px", borderRadius:5,
            border:`1.5px solid ${active ? o.color : C.border}`,
            background: active ? o.lo : "transparent",
            color: active ? o.color : C.textDim,
            fontWeight: active ? 700 : 400, fontSize:12, cursor:"pointer",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Checklist sub-components ──────────────────────────────────────────────
function CheckRow({ check, val, note, onSet, onNote, expanded, onToggle }) {
  return (
    <div style={{ borderBottom:`1px solid ${C.border}`, background: val==="fail" ? `${C.redLo}44` : "transparent" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"12px 16px", cursor:"pointer" }}
        onClick={() => onToggle(check.id)}>
        <span style={{ color:C.muted, fontSize:12, marginTop:3, minWidth:12 }}>{expanded ? "▾" : "▸"}</span>
        <div style={{ minWidth:60, paddingTop:1 }}><SevChip sev={check.severity} /></div>
        <div style={{ flex:1, fontSize:13, color:C.text, lineHeight:1.55 }}>{check.text}</div>
        <div style={{ minWidth:50, textAlign:"right" }}><StatusBadge val={val} /></div>
      </div>
      {expanded && (
        <div style={{ padding:"0 16px 14px 40px" }} onClick={e => e.stopPropagation()}>
          <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:6,
            padding:"8px 12px", marginBottom:10, fontSize:12, color:C.textDim, lineHeight:1.6 }}>
            <span style={{ color:C.accent, fontWeight:700, marginRight:6 }}>Guidance:</span>{check.guidance}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <RadioGroup id={check.id} val={val} onChange={onSet} />
            <input placeholder="QE note (optional)…" value={note}
              onChange={e => onNote(check.id, e.target.value)}
              style={{ flex:1, minWidth:180, background:C.surface, border:`1px solid ${C.border}`,
                borderRadius:5, color:C.text, fontSize:12, padding:"5px 10px", outline:"none" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({ section, vals, notes, expanded, expandedChecks, onToggle, onToggleCheck, onSet, onNote }) {
  const pass    = section.checks.filter(c => vals[c.id] === "pass").length;
  const fail    = section.checks.filter(c => vals[c.id] === "fail").length;
  const pending = section.checks.filter(c => vals[c.id] === null).length;
  const done    = section.checks.length - pending;
  const pct     = Math.round((done / section.checks.length) * 100);
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", cursor:"pointer",
        background: expanded ? C.panel : C.surface, borderBottom: expanded ? `1px solid ${C.border}` : "none" }}
        onClick={() => onToggle(section.id)}>
        <span style={{ fontSize:18, opacity:.85 }}>{section.icon}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{section.label}</div>
          <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{section.desc}</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {fail > 0    && <span style={{ fontSize:11, fontWeight:700, color:C.red,   background:C.redLo,   padding:"2px 7px", borderRadius:4 }}>{fail} fail</span>}
          {pending > 0 && <span style={{ fontSize:11, color:C.muted, background:C.badge, padding:"2px 7px", borderRadius:4 }}>{pending} left</span>}
          {pending === 0 && fail === 0 && <span style={{ fontSize:11, fontWeight:700, color:C.green, background:C.greenLo, padding:"2px 7px", borderRadius:4 }}>✓ Clear</span>}
          <div style={{ width:60, height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
            <div style={{ width:`${pct}%`, height:"100%", background: fail>0 ? C.amber : C.green }} />
          </div>
          <span style={{ color:C.muted, fontSize:13 }}>{expanded ? "▾" : "▸"}</span>
        </div>
      </div>
      {expanded && section.checks.map(check => (
        <CheckRow key={check.id} check={check} val={vals[check.id]} note={notes[check.id]}
          onSet={onSet} onNote={onNote} expanded={!!expandedChecks[check.id]} onToggle={onToggleCheck} />
      ))}
    </div>
  );
}

// ── Metadata panel (shared) ───────────────────────────────────────────────
function MetadataPanel({ state, showForView }) {
  const inputStyle = {
    width:"100%", background:C.panel, border:`1px solid ${C.border}`,
    borderRadius:5, color:C.text, fontSize:13, padding:"6px 10px", outline:"none", boxSizing:"border-box",
  };
  const labelStyle = { fontSize:11, color:C.textDim, display:"block", marginBottom:4 };

  if (showForView === "summary" || showForView === "dashboard") {
    // compact read-only strip
    const fields = [
      ["Task ID", state.taskId], ["Queue", state.queueName], ["Batch", state.batchId],
      ["QE", state.auditor], ["Annotator", state.annotatorName],
      ["Annotated", state.annotationDate], ["Audited", state.auditDate],
    ];
    return (
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10,
        padding:"12px 16px", marginBottom:16, display:"flex", flexWrap:"wrap", gap:"6px 20px", alignItems:"center" }}>
        {fields.map(([label, val]) => (
          <span key={label} style={{ fontSize:11 }}>
            <span style={{ color:C.muted }}>{label}:</span>{" "}
            <span style={{ color: val ? C.text : C.muted }}>{val || "—"}</span>
          </span>
        ))}
      </div>
    );
  }

  // full editable form for audit view
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:16, marginBottom:20 }}>
      {/* Row 1 */}
      <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginBottom:12 }}>
        <div style={{ flex:"1 1 140px" }}>
          <label style={labelStyle}>Task ID</label>
          <input value={state.taskId} onChange={e => state.setTaskId(e.target.value)} placeholder="e.g. PA-2026-0801" style={inputStyle} />
        </div>
        <div style={{ flex:"1 1 140px" }}>
          <label style={labelStyle}>Queue Name</label>
          <input value={state.queueName} onChange={e => state.setQueueName(e.target.value)} placeholder="e.g. GR16-PA-Pilot" style={inputStyle} />
        </div>
        <div style={{ flex:"2 1 220px" }}>
          <label style={labelStyle}>Batch ID / File Name</label>
          <input value={state.batchId} onChange={e => state.setBatchId(e.target.value)} placeholder="e.g. single_turn_batch01_20260801" style={inputStyle} />
        </div>
      </div>
      {/* Row 2 */}
      <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
        <div style={{ flex:"1 1 140px" }}>
          <label style={labelStyle}>Quality Executive Name</label>
          <input value={state.auditor} onChange={e => state.setAuditor(e.target.value)} placeholder="QE full name" style={inputStyle} />
        </div>
        <div style={{ flex:"1 1 140px" }}>
          <label style={labelStyle}>Annotator Name</label>
          <input value={state.annotatorName} onChange={e => state.setAnnotatorName(e.target.value)} placeholder="Annotator full name" style={inputStyle} />
        </div>
        <div style={{ flex:"1 1 130px" }}>
          <label style={labelStyle}>Annotation Date</label>
          <input type="date" value={state.annotationDate} onChange={e => state.setAnnotationDate(e.target.value)}
            style={{ ...inputStyle, colorScheme:"dark" }} />
        </div>
        <div style={{ flex:"1 1 130px" }}>
          <label style={labelStyle}>Audit Date</label>
          <input type="date" value={state.auditDate} onChange={e => state.setAuditDate(e.target.value)}
            style={{ ...inputStyle, colorScheme:"dark" }} />
        </div>
      </div>
    </div>
  );
}

// ── Summary helpers ───────────────────────────────────────────────────────
function ScoreGauge({ stats }) {
  const reviewed = stats.passed + stats.failed + stats.na;
  const pct = stats.total > 0 ? Math.round((reviewed / stats.total) * 100) : 0;
  const radius = 42, circ = 2 * Math.PI * radius;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:20 }}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={radius} fill="none" stroke={C.border} strokeWidth={7} />
        <circle cx={50} cy={50} r={radius} fill="none"
          stroke={stats.failed > 0 ? C.amber : C.green} strokeWidth={7}
          strokeDasharray={`${dash} ${circ-dash}`} strokeDashoffset={circ/4} strokeLinecap="round"
          style={{ transition:"stroke-dasharray .4s" }} />
        <text x={50} y={47} textAnchor="middle" fill={C.text} fontSize={20} fontWeight={700}>{pct}%</text>
        <text x={50} y={61} textAnchor="middle" fill={C.textDim} fontSize={9}>reviewed</text>
      </svg>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 16px" }}>
        {[["Passed",C.green,stats.passed],["Failed",C.red,stats.failed],["N/A",C.muted,stats.na],["Pending",C.textDim,stats.pending]].map(([l,col,v]) => (
          <div key={l} style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:col }} />
            <span style={{ fontSize:12, color:C.textDim }}>{l}</span>
            <span style={{ fontSize:13, fontWeight:700, color:col, marginLeft:2 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Verdict({ canSubmit, criticalFails, majorFails, ready }) {
  if (!ready) return (
    <div style={{ background:C.badge, borderRadius:8, padding:"12px 16px", fontSize:13, color:C.textDim }}>
      Complete all checkpoints to generate the audit verdict.
    </div>
  );
  if (criticalFails.length > 0) return (
    <div style={{ background:C.redLo, border:`1px solid ${C.red}`, borderRadius:8, padding:"12px 16px" }}>
      <div style={{ fontWeight:700, color:C.red, fontSize:14, marginBottom:4 }}>⛔ HOLD — Critical Failures</div>
      <div style={{ fontSize:12, color:C.text, lineHeight:1.6 }}>
        Batch cannot be submitted. {criticalFails.length} critical checkpoint{criticalFails.length>1?"s":""} failed: {criticalFails.map(c=>c.id.toUpperCase()).join(", ")}.
      </div>
    </div>
  );
  if (majorFails.length > 0) return (
    <div style={{ background:C.amberLo, border:`1px solid ${C.amber}`, borderRadius:8, padding:"12px 16px" }}>
      <div style={{ fontWeight:700, color:C.amber, fontSize:14, marginBottom:4 }}>⚠ CONDITIONAL PASS — Major Issues</div>
      <div style={{ fontSize:12, color:C.text, lineHeight:1.6 }}>
        {majorFails.length} major issue{majorFails.length>1?"s":""} noted. Batch may proceed with documented remediation plan: {majorFails.map(c=>c.id.toUpperCase()).join(", ")}.
      </div>
    </div>
  );
  return (
    <div style={{ background:C.greenLo, border:`1px solid ${C.green}`, borderRadius:8, padding:"12px 16px" }}>
      <div style={{ fontWeight:700, color:C.green, fontSize:14, marginBottom:4 }}>✓ CLEAR — Approved for Submission</div>
      <div style={{ fontSize:12, color:C.text }}>All critical and major checkpoints passed. Batch is approved for client delivery.</div>
    </div>
  );
}

// ── Dashboard view ────────────────────────────────────────────────────────
function Dashboard({ state }) {
  const { stats, criticalFails, majorFails, minorFails, vals } = state;
  const reviewed = stats.passed + stats.failed + stats.na;
  const passPct  = reviewed > 0 ? Math.round((stats.passed / reviewed) * 100) : 0;
  const failPct  = reviewed > 0 ? Math.round((stats.failed / reviewed) * 100) : 0;

  // Section stats
  const sectionStats = SECTIONS.map(s => {
    const total   = s.checks.length;
    const passed  = s.checks.filter(c => vals[c.id] === "pass").length;
    const failed  = s.checks.filter(c => vals[c.id] === "fail").length;
    const pending = s.checks.filter(c => vals[c.id] === null).length;
    const done    = total - pending;
    return { ...s, total, passed, failed, pending, done };
  });

  // Severity breakdown of fails
  const sevBreakdown = [
    { label:"Critical", count:criticalFails.length, color:C.red,   bg:C.redLo   },
    { label:"Major",    count:majorFails.length,    color:C.amber, bg:C.amberLo },
    { label:"Minor",    count:minorFails.length,    color:C.gold,  bg:C.goldLo  },
  ];

  // Verdict chip
  const verdictChip = !state.ready
    ? { label:"In Progress", color:C.accent, bg:C.accentLo }
    : criticalFails.length > 0
      ? { label:"HOLD", color:C.red,   bg:C.redLo   }
      : majorFails.length > 0
        ? { label:"Conditional", color:C.amber, bg:C.amberLo }
        : { label:"Approved",    color:C.green, bg:C.greenLo };

  const Card = ({ children, style = {} }) => (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden", ...style }}>
      {children}
    </div>
  );

  const CardHeader = ({ label }) => (
    <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}`,
      fontSize:11, fontWeight:700, letterSpacing:".06em", color:C.textDim }}>
      {label}
    </div>
  );

  // Stat tile
  const Stat = ({ label, value, sub, color = C.text, icon }) => (
    <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 16px",
      display:"flex", flexDirection:"column", gap:4 }}>
      <div style={{ fontSize:11, color:C.textDim, display:"flex", alignItems:"center", gap:6 }}>
        {icon && <span>{icon}</span>}{label}
      </div>
      <div style={{ fontSize:28, fontWeight:800, color, lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:C.textDim }}>{sub}</div>}
    </div>
  );

  // Mini donut for pass/fail
  const r = 28, circ = 2 * Math.PI * r;
  const passD = reviewed > 0 ? (stats.passed / stats.total) * circ : 0;
  const failD = reviewed > 0 ? (stats.failed / stats.total) * circ : 0;
  const naD   = reviewed > 0 ? (stats.na     / stats.total) * circ : 0;
  const passO = circ / 4;
  const failO = passO - passD;
  const naO   = failO - failD;

  return (
    <div>
      {/* KPI row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:12, marginBottom:16 }}>
        <Stat icon="📋" label="Total Checkpoints" value={stats.total} sub={`${reviewed} reviewed`} />
        <Stat icon="✓"  label="Passed"   value={stats.passed}  sub={`${passPct}% of reviewed`} color={C.green} />
        <Stat icon="✗"  label="Failed"   value={stats.failed}  sub={`${failPct}% of reviewed`} color={stats.failed>0 ? C.red : C.text} />
        <Stat icon="—"  label="N/A"      value={stats.na}      sub="not applicable" color={C.muted} />
        <Stat icon="⏳" label="Pending"  value={stats.pending} sub="need review" color={stats.pending>0 ? C.amber : C.text} />
        <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 16px",
          display:"flex", flexDirection:"column", gap:4, alignItems:"flex-start" }}>
          <div style={{ fontSize:11, color:C.textDim }}>🏁 Verdict</div>
          <span style={{ fontSize:15, fontWeight:800, color:verdictChip.color,
            background:verdictChip.bg, padding:"4px 10px", borderRadius:5, marginTop:4 }}>
            {verdictChip.label}
          </span>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        {/* Pass/fail donut */}
        <Card>
          <CardHeader label="CHECKPOINT BREAKDOWN" />
          <div style={{ padding:16, display:"flex", alignItems:"center", gap:20 }}>
            <svg width={80} height={80} viewBox="0 0 80 80">
              <circle cx={40} cy={40} r={r} fill="none" stroke={C.border} strokeWidth={6} />
              {/* pass arc */}
              <circle cx={40} cy={40} r={r} fill="none" stroke={C.green} strokeWidth={6}
                strokeDasharray={`${passD} ${circ-passD}`} strokeDashoffset={passO} strokeLinecap="butt" />
              {/* fail arc */}
              <circle cx={40} cy={40} r={r} fill="none" stroke={C.red} strokeWidth={6}
                strokeDasharray={`${failD} ${circ-failD}`} strokeDashoffset={failO} strokeLinecap="butt" />
              {/* na arc */}
              <circle cx={40} cy={40} r={r} fill="none" stroke={C.muted} strokeWidth={6}
                strokeDasharray={`${naD} ${circ-naD}`} strokeDashoffset={naO} strokeLinecap="butt" />
              <text x={40} y={44} textAnchor="middle" fill={C.text} fontSize={13} fontWeight={700}>
                {stats.total}
              </text>
            </svg>
            <div style={{ flex:1, display:"flex", flexDirection:"column", gap:8 }}>
              {[
                ["Passed",  stats.passed,  C.green,   C.greenLo],
                ["Failed",  stats.failed,  C.red,     C.redLo  ],
                ["N/A",     stats.na,      C.muted,   C.badge  ],
                ["Pending", stats.pending, C.textDim, C.panel  ],
              ].map(([label, count, color, bg]) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }} />
                  <span style={{ fontSize:12, color:C.textDim, flex:1 }}>{label}</span>
                  <span style={{ fontSize:13, fontWeight:700, color }}>{count}</span>
                  <div style={{ width:60, height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${stats.total > 0 ? (count/stats.total)*100 : 0}%`, height:"100%", background:color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Severity breakdown of failures */}
        <Card>
          <CardHeader label="FAILURES BY SEVERITY" />
          <div style={{ padding:16 }}>
            {sevBreakdown.map(({ label, count, color, bg }) => {
              const totalFails = criticalFails.length + majorFails.length + minorFails.length;
              const pct = totalFails > 0 ? Math.round((count / totalFails) * 100) : 0;
              return (
                <div key={label} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:12, color, fontWeight:700 }}>{label}</span>
                    <span style={{ fontSize:12, color }}>
                      {count} {count === 1 ? "fail" : "fails"}
                      {totalFails > 0 ? ` (${pct}%)` : ""}
                    </span>
                  </div>
                  <div style={{ height:6, background:C.border, borderRadius:3, overflow:"hidden" }}>
                    <div style={{ width:`${pct}%`, height:"100%", background:color, transition:"width .4s" }} />
                  </div>
                </div>
              );
            })}
            {criticalFails.length === 0 && majorFails.length === 0 && minorFails.length === 0 && (
              <div style={{ textAlign:"center", color:C.textDim, fontSize:13, paddingTop:8 }}>
                {stats.pending > 0 ? "Complete all checkpoints to see failures." : "✓ No failures recorded."}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Section progress */}
      <Card style={{ marginBottom:12 }}>
        <CardHeader label="SECTION PROGRESS" />
        <div style={{ padding:"4px 0" }}>
          {sectionStats.map(s => {
            const donePct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
            return (
              <div key={s.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 16px",
                borderBottom:`1px solid ${C.border}` }}>
                <span style={{ fontSize:16, minWidth:20 }}>{s.icon}</span>
                <div style={{ width:160, fontSize:12, color:C.text, fontWeight:500 }}>{s.label.split(". ")[1]}</div>
                <div style={{ flex:1 }}>
                  <div style={{ height:6, background:C.border, borderRadius:3, overflow:"hidden" }}>
                    <div style={{
                      width:`${donePct}%`, height:"100%", borderRadius:3,
                      background: s.failed > 0 ? C.amber : donePct === 100 ? C.green : C.accent,
                      transition:"width .4s",
                    }} />
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, minWidth:130, justifyContent:"flex-end" }}>
                  <span style={{ fontSize:11, color:C.textDim }}>{s.done}/{s.total}</span>
                  {s.failed > 0 && <span style={{ fontSize:11, fontWeight:700, color:C.red, background:C.redLo, padding:"1px 6px", borderRadius:3 }}>{s.failed} fail</span>}
                  {s.pending > 0 && <span style={{ fontSize:11, color:C.muted, background:C.badge, padding:"1px 6px", borderRadius:3 }}>{s.pending} left</span>}
                  {s.pending === 0 && s.failed === 0 && <span style={{ fontSize:11, fontWeight:700, color:C.green, background:C.greenLo, padding:"1px 6px", borderRadius:3 }}>✓</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Failed items */}
      {(criticalFails.length > 0 || majorFails.length > 0 || minorFails.length > 0) && (
        <Card>
          <CardHeader label="OPEN ISSUES" />
          <div>
            {[...criticalFails, ...majorFails, ...minorFails].map(c => (
              <div key={c.id} style={{ display:"flex", gap:10, alignItems:"flex-start",
                padding:"10px 16px", borderBottom:`1px solid ${C.border}` }}>
                <SevChip sev={c.severity} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:C.muted, fontWeight:700, marginBottom:2 }}>{c.id.toUpperCase()}</div>
                  <div style={{ fontSize:12, color:C.text, lineHeight:1.5 }}>{c.text}</div>
                  {state.notes[c.id] && (
                    <div style={{ fontSize:11, color:C.textDim, marginTop:4, fontStyle:"italic" }}>
                      Note: {state.notes[c.id]}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {state.ready && criticalFails.length === 0 && majorFails.length === 0 && minorFails.length === 0 && (
        <div style={{ background:C.greenLo, border:`1px solid ${C.green}`, borderRadius:10,
          padding:"16px 20px", textAlign:"center" }}>
          <div style={{ fontSize:22, marginBottom:6 }}>🎉</div>
          <div style={{ fontWeight:700, color:C.green, fontSize:14 }}>All checkpoints cleared — batch approved for delivery.</div>
        </div>
      )}
    </div>
  );
}

// ── Summary view ──────────────────────────────────────────────────────────
function SummaryView({ state }) {
  return (
    <div>
      {/* Submitted banner */}
      {state.submitted && (
        <div style={{
          background: C.greenLo, border: `1.5px solid ${C.green}`,
          borderRadius: 10, padding: "12px 18px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <div style={{ flex: 1, fontSize: 12, color: C.green, fontWeight: 700 }}>
            Audit submitted · {state.submittedAt}
          </div>
        </div>
      )}

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10,
        padding:20, marginBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{state.batchId || "—"}</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 16px" }}>
            {[["Task ID",state.taskId],["Queue",state.queueName],["QE",state.auditor],
              ["Annotator",state.annotatorName],["Annotated",state.annotationDate],["Audited",state.auditDate]
            ].map(([label,val]) => (
              <span key={label} style={{ fontSize:11, color:C.textDim }}>
                <span style={{ color:C.muted }}>{label}:</span>{" "}
                <span style={{ color: val ? C.text : C.muted }}>{val || "—"}</span>
              </span>
            ))}
          </div>
          <div style={{ fontSize:11, color:C.textDim }}>PA Data Collection Audit</div>
        </div>
        <ScoreGauge stats={state.stats} />
      </div>

      <div style={{ marginBottom:16 }}>
        <Verdict canSubmit={state.canSubmit} criticalFails={state.criticalFails} majorFails={state.majorFails} ready={state.ready} />
      </div>

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden", marginBottom:16 }}>
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`, fontSize:12, fontWeight:700, color:C.textDim }}>SECTION BREAKDOWN</div>
        {SECTIONS.map(s => {
          const fails   = s.checks.filter(c => state.vals[c.id] === "fail");
          const pending = s.checks.filter(c => state.vals[c.id] === null);
          return (
            <div key={s.id} style={{ display:"flex", alignItems:"center", gap:12,
              padding:"10px 16px", borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:16 }}>{s.icon}</span>
              <div style={{ flex:1, fontSize:13, color:C.text }}>{s.label}</div>
              <div style={{ display:"flex", gap:6 }}>
                {fails.length > 0   && <span style={{ fontSize:11, fontWeight:700, color:C.red,   background:C.redLo,   padding:"2px 7px", borderRadius:4 }}>{fails.length} fail</span>}
                {pending.length > 0 && <span style={{ fontSize:11, color:C.muted, background:C.badge, padding:"2px 7px", borderRadius:4 }}>{pending.length} left</span>}
                {pending.length === 0 && fails.length === 0 && <span style={{ fontSize:11, fontWeight:700, color:C.green, background:C.greenLo, padding:"2px 7px", borderRadius:4 }}>✓</span>}
              </div>
            </div>
          );
        })}
      </div>

      {(state.criticalFails.length > 0 || state.majorFails.length > 0) && (
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`, fontSize:12, fontWeight:700, color:C.textDim }}>FAILED ITEMS LOG</div>
          {[...state.criticalFails, ...state.majorFails].map(c => (
            <div key={c.id} style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", gap:10, alignItems:"flex-start" }}>
              <SevChip sev={c.severity} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, color:C.text, lineHeight:1.5 }}>{c.text}</div>
                {state.notes[c.id] && (
                  <div style={{ fontSize:11, color:C.textDim, marginTop:4, fontStyle:"italic" }}>Note: {state.notes[c.id]}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Submit bar ────────────────────────────────────────────────────────────
function SubmitBar({ state, onSubmit }) {
  const { stats, criticalFails, majorFails, ready, submitted, submittedAt } = state;
  const pending = stats.pending;
  const done    = stats.total - pending;

  // progress ring
  const r = 14, circ = 2 * Math.PI * r;
  const pct = stats.total > 0 ? done / stats.total : 0;
  const dash = pct * circ;

  // status label inside bar
  const statusText = submitted
    ? null
    : pending > 0
      ? `${pending} checkpoint${pending > 1 ? "s" : ""} remaining`
      : criticalFails.length > 0
        ? `${criticalFails.length} critical failure${criticalFails.length > 1 ? "s" : ""} — resolve before submitting`
        : majorFails.length > 0
          ? `${majorFails.length} major issue${majorFails.length > 1 ? "s" : ""} — submission allowed with remediation note`
          : "All checkpoints complete — ready to submit";

  const btnEnabled = ready && !submitted;
  const btnColor   = submitted ? C.green : ready ? C.accent : C.muted;
  const btnBg      = submitted ? C.greenLo : ready ? C.accentLo : C.panel;
  const btnBorder  = submitted ? C.green : ready ? C.accent : C.border;

  if (submitted) {
    return (
      <div style={{
        marginTop: 24,
        background: C.greenLo, border: `1.5px solid ${C.green}`,
        borderRadius: 12, padding: "20px 24px",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        {/* checkmark circle */}
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: C.green, display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, fontSize: 22,
        }}>✓</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.green, marginBottom: 4 }}>
            Audit Submitted Successfully
          </div>
          <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>
            <span style={{ color: C.textDim }}>Batch:</span> {state.batchId || "—"} &nbsp;·&nbsp;
            <span style={{ color: C.textDim }}>QE:</span> {state.auditor || "—"} &nbsp;·&nbsp;
            <span style={{ color: C.textDim }}>Submitted at:</span> {submittedAt}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
            {criticalFails.length === 0 && majorFails.length === 0
              ? "Verdict: Approved for delivery — no issues recorded."
              : majorFails.length > 0 && criticalFails.length === 0
                ? `Verdict: Conditional pass — ${majorFails.length} major issue(s) logged for remediation.`
                : `Verdict: Hold — ${criticalFails.length} critical failure(s) on record.`}
          </div>
        </div>
        <button
          onClick={() => { state.setSubmitted(false); state.setSubmittedAt(null); }}
          style={{
            padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: "transparent", border: `1px solid ${C.green}`, color: C.green,
          }}
        >Reset</button>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 24,
      background: C.surface, border: `1.5px solid ${ready ? C.accent : C.border}`,
      borderRadius: 12, padding: "16px 20px",
      display: "flex", alignItems: "center", gap: 16,
      transition: "border-color .3s",
    }}>
      {/* mini progress ring */}
      <svg width={36} height={36} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
        <circle cx={18} cy={18} r={r} fill="none" stroke={C.border} strokeWidth={4} />
        <circle cx={18} cy={18} r={r} fill="none"
          stroke={ready ? C.green : C.accent} strokeWidth={4}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray .4s" }} />
        <text x={18} y={22} textAnchor="middle" fill={C.textDim} fontSize={9} fontWeight={700}>
          {Math.round(pct * 100)}%
        </text>
      </svg>

      {/* counts */}
      <div style={{ display: "flex", gap: 16, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { label: "Done",    val: done,          color: C.green   },
            { label: "Pending", val: pending,        color: pending > 0 ? C.amber : C.textDim },
            { label: "Failed",  val: stats.failed,  color: stats.failed > 0 ? C.red : C.textDim },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: pending > 0 ? C.textDim : criticalFails.length > 0 ? C.red : majorFails.length > 0 ? C.amber : C.green }}>
          {statusText}
        </div>
      </div>

      {/* submit button */}
      <button
        disabled={!btnEnabled}
        onClick={onSubmit}
        style={{
          padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700,
          cursor: btnEnabled ? "pointer" : "not-allowed",
          background: btnBg, border: `1.5px solid ${btnBorder}`, color: btnColor,
          opacity: btnEnabled ? 1 : 0.45,
          transition: "all .25s",
          whiteSpace: "nowrap",
        }}
      >
        Submit Audit
      </button>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────
export default function PAQualityAudit() {
  const state = useBatchState();
  const [view, setView] = useState("audit");
  const totalChecks = SECTIONS.reduce((a, s) => a + s.checks.length, 0);

  function handleSubmit() {
    if (!state.ready) return;
    const now = new Date();
    const ts  = now.toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    state.setSubmittedAt(ts);
    state.setSubmitted(true);
    // auto-navigate to summary so QE sees the verdict immediately
    setView("summary");
  }

  const tabs = [
    { id:"audit",     label:"Checklist" },
    { id:"dashboard", label:"Dashboard" },
    { id:"summary",   label:"Summary"   },
  ];

  return (
    <div style={{ fontFamily:"'Inter', system-ui, -apple-system, sans-serif",
      background:C.bg, color:C.text, minHeight:"100vh", padding:"0 0 60px" }}>

      {/* Sticky header */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`,
        padding:"16px 24px", position:"sticky", top:0, zIndex:50,
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:C.text, letterSpacing:"-.01em" }}>
            PA Data Collection · Task Audit
          </div>
          <div style={{ fontSize:11, color:C.textDim, marginTop:1 }}>
            Quality Executive — GR16 · {totalChecks} checkpoints across 7 sections
          </div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              padding:"6px 14px", borderRadius:6,
              background: view===t.id ? C.accentLo : "transparent",
              border:`1px solid ${view===t.id ? C.accent : C.border}`,
              color: view===t.id ? C.accent : C.textDim,
              fontWeight: view===t.id ? 700 : 400, fontSize:12, cursor:"pointer",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"24px 20px" }}>

        {/* Metadata panel — editable on audit, compact strip on others */}
        {view === "audit" && <MetadataPanel state={state} showForView="audit" />}
        {(view === "dashboard" || view === "summary") && <MetadataPanel state={state} showForView={view} />}

        {/* Views */}
        {view === "audit" && (
          <>
            {SECTIONS.map(section => (
              <SectionCard key={section.id} section={section}
                vals={state.vals} notes={state.notes}
                expanded={state.expanded[section.id]} expandedChecks={state.expandedCheck}
                onToggle={state.toggleSection} onToggleCheck={state.toggleCheck}
                onSet={state.set} onNote={state.setNote} />
            ))}
            <SubmitBar state={state} onSubmit={handleSubmit} />
          </>
        )}

        {view === "dashboard" && <Dashboard state={state} />}
        {view === "summary"   && <SummaryView state={state} />}
      </div>
    </div>
  );
}
