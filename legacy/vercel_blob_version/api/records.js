// PA Task Audit — shared database on Vercel Blob.
//
//   GET  /api/records                      → { ok:true, records:[…] }
//   POST /api/records  {action:"add", record}     → { ok:true }
//   POST /api/records  {action:"delete", record_id} → { ok:true, removed }
//
// Every audit is one blob at records/<record_id>.json (the source of truth).
// index.json is a cached list of all records so the Records tab needs a single read.
// It is rebuilt from the record blobs after every add or delete.

import { put, get, del, list } from "@vercel/blob";

const RECORD_PREFIX = "records/";
const INDEX_PATH    = "index.json";
const ACCESS        = process.env.PA_BLOB_ACCESS === "public" ? "public" : "private";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function readJson(pathnameOrUrl) {
  const res = await get(pathnameOrUrl, { access: ACCESS, useCache: false });
  if (!res || !res.stream) return null;
  const text = await new Response(res.stream).text();
  try { return JSON.parse(text); } catch { return null; }
}

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function scanRecords() {
  const blobs = await listAll(RECORD_PREFIX);
  const records = [];
  for (let i = 0; i < blobs.length; i += 25) {
    const batch = await Promise.all(blobs.slice(i, i + 25).map(b => readJson(b.url).catch(() => null)));
    for (const r of batch) if (r && r.record_id) records.push(r);
  }
  records.sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));
  return records;
}

async function writeIndex(records) {
  await put(INDEX_PATH, JSON.stringify({ updated_at: new Date().toISOString(), records }), {
    access: ACCESS, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
  });
}

async function rebuildIndex() {
  const records = await scanRecords();
  await writeIndex(records);
  return records;
}

function cleanRecord(rec) {
  if (!rec || typeof rec !== "object") throw new Error("record missing");
  const id = String(rec.record_id || "").trim();
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error("record_id is not valid");
  const str = k => (rec[k] === null || rec[k] === undefined ? "" : String(rec[k])).slice(0, 2000);
  const num = k => Number(rec[k]) || 0;
  const checks = Array.isArray(rec.checks) ? rec.checks.slice(0, 200).map(c => ({
    check_id: String(c.check_id || "").slice(0, 20),
    section:  String(c.section  || "").slice(0, 120),
    severity: String(c.severity || "").slice(0, 20),
    result:   String(c.result   || "").slice(0, 20),
    note:     String(c.note     || "").slice(0, 4000),
  })) : [];
  return {
    record_id: id,
    submitted_at: str("submitted_at") || new Date().toISOString(),
    task_id: str("task_id"), queue_name: str("queue_name"), batch_id: str("batch_id"),
    auditor: str("auditor"), annotator: str("annotator"),
    annotation_date: str("annotation_date"), audit_date: str("audit_date"),
    verdict: str("verdict"),
    total_checks: num("total_checks"), passed: num("passed"), failed: num("failed"), na: num("na"),
    critical_fails: num("critical_fails"), major_fails: num("major_fails"), minor_fails: num("minor_fails"),
    failed_checks: str("failed_checks"),
    checks,
  };
}

export async function GET() {
  try {
    let index = await readJson(INDEX_PATH).catch(() => null);
    if (!index || !Array.isArray(index.records)) {
      const records = await rebuildIndex();
      return json({ ok: true, records, rebuilt: true });
    }
    return json({ ok: true, records: index.records, updated_at: index.updated_at });
  } catch (err) {
    return json({ ok: false, error: describe(err) }, 500);
  }
}

export async function POST(request) {
  let body;
  try { body = JSON.parse(await request.text()); }
  catch { return json({ ok: false, error: "Body must be JSON" }, 400); }

  try {
    if (body.action === "add") {
      const rec = cleanRecord(body.record);
      await put(RECORD_PREFIX + rec.record_id + ".json", JSON.stringify(rec), {
        access: ACCESS, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
      });
      await rebuildIndex();
      return json({ ok: true });
    }
    if (body.action === "delete") {
      const id = String(body.record_id || "").trim();
      if (!id) return json({ ok: false, error: "record_id missing" }, 400);
      const blobs = await listAll(RECORD_PREFIX + id + ".json");
      const exact = blobs.filter(b => b.pathname === RECORD_PREFIX + id + ".json");
      if (exact.length) await del(exact.map(b => b.url));
      await rebuildIndex();
      return json({ ok: true, removed: exact.length });
    }
    if (body.action === "rebuild") {
      const records = await rebuildIndex();
      return json({ ok: true, count: records.length });
    }
    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: describe(err) }, 500);
  }
}

function describe(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/token|BLOB_READ_WRITE_TOKEN|BLOB_STORE_ID|credentials/i.test(msg)) {
    return "Blob store is not connected to this project yet. In Vercel: Storage → Create → Blob → Connect to this project, then Deployments → Redeploy. (" + msg + ")";
  }
  return msg;
}
