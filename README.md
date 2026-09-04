# PA Task Audit — backend + frontend

Quality-executive checklist for PA data-collection batches. Every submitted audit is stored in
PostgreSQL, so the owner sees all submissions from every auditor in the **Records** tab, as
Excel/CSV downloads, or straight in the database.

```
pa_audit_tool/
├─ backend/                 Python + FastAPI + SQLAlchemy + PostgreSQL
│  ├─ app/
│  │  ├─ main.py            API routes, CSV exports, serves the frontend at /
│  │  ├─ database.py        engine / session (reads DATABASE_URL from .env or the host)
│  │  ├─ models.py          tables: audits, audit_checks
│  │  └─ schemas.py         request / response validation
│  ├─ .env                  DATABASE_URL for local PostgreSQL (password 1234, port 5433)
│  ├─ requirements.txt
│  └─ run.py                python run.py  → http://localhost:8000
├─ frontend/                plain HTML pages + shared CSS/JS (no build step)
│  ├─ index.html            Checklist — fill in, submit; resets itself after each submission
│  ├─ dashboard.html        Dashboard — live counts of every submitted audit + the audit in progress
│  ├─ summary.html          Summary — the audit just submitted (or the one in progress)
│  ├─ records.html          Records — every submission, filters, filtered Excel/CSV download
│  ├─ css/style.css         shared styles
│  └─ js/
│     ├─ config.js          backend URL (empty = same server)
│     ├─ checks.js          the 41 checkpoints in 6 sections (edit here to change the checklist)
│     ├─ common.js          storage, API calls, header, export helpers
│     └─ checklist.js, dashboard.js, summary.js, records.js   one script per page
├─ api/index.py             Vercel serverless entry point (imports backend/app)
├─ vercel.json              Vercel: serve frontend/ as static; FastAPI handles everything else
├─ .python-version          pins Python 3.12 (required by Vercel's Python runtime)
├─ requirements.txt         copy of backend/requirements.txt (Vercel reads it from the root)
├─ start_backend.bat        double-click to run everything locally on Windows
└─ legacy/                  the previous React / Google-Sheets / Vercel-Blob versions (unused)
```

## Run locally

Requirements: Python 3.11+, PostgreSQL running locally with user `postgres` / password `1234`.

1. Create the database once (already done on this machine):
   ```sql
   CREATE DATABASE pa_audit_tool;
   ```
   Tables are created automatically the first time the backend starts.
2. Start the backend (it also serves the frontend):
   ```bash
   start_backend.bat
   ```
   or manually:
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\pip install -r requirements.txt
   .venv\Scripts\python run.py
   ```
3. Open http://localhost:8000 — the header should say **Database connected**.

`backend/.env` holds the connection string. This machine runs PostgreSQL 18 on port **5433** and
PostgreSQL 15 on port **5434**; change the port there if you want the other server.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | database connectivity + record count |
| GET | `/api/records` | every audit with its failed / N/A checkpoints. Optional filters: `auditor`, `verdict`, `queue`, `date_from`, `date_to`, `q` |
| GET | `/api/records/{record_id}` | one audit |
| POST | `/api/records` | save a submitted audit (idempotent on `record_id`) |
| DELETE | `/api/records/{record_id}` | remove an audit |
| GET | `/api/stats` | verdict counts |
| GET | `/api/export/audits.csv` | audits as CSV (opens in Excel); same filters as `/api/records` |
| GET | `/api/export/issues.csv` | failed / N/A checkpoints with notes; same filters |
| GET | `/docs` | interactive Swagger UI |

## Where the data lives

- Table `audits`: one row per submission (task, queue, batch, QE, annotator, dates, verdict, counts).
- Table `audit_checks`: one row per checkpoint that was **not** a pass (fail or N/A) with the QE note.
- Passed checkpoints are implied by the counts, so nothing is lost and the tables stay small.

Query it directly:
```bash
psql -h localhost -p 5433 -U postgres -d pa_audit_tool -c "select record_id, auditor, verdict, submitted_at from audits order by submitted_at desc;"
```

## Host it for free

The frontend is plain HTML, so it runs anywhere. The backend needs Python and a PostgreSQL
database that is reachable from the internet. The cheapest working combination:

### Recommended: Vercel (frontend + backend) + Neon (free PostgreSQL)

Vercel detects the FastAPI app in `api/index.py`, runs it as a Python 3.12 serverless function,
and serves `frontend/` as static files. No rewrite rules are needed (Vercel now passes the
rewritten path to the app, so a rewrite would break the API routes). Neon gives a permanent free
PostgreSQL database (0.5 GB, plenty for hundreds of thousands of audits).

1. **Deploy from GitHub** — at https://vercel.com/new import the `Audit_pf` repository. Leave
   framework as "Other" and the root directory as is. Click Deploy. You get a URL such as
   `https://audit-pf.vercel.app`; the pages load, and the header says *Backend unreachable*
   until the database is attached.
2. **Database** — in the Vercel project open **Storage → Create Database → Neon** (free plan).
   This creates the database and adds `DATABASE_URL` to the project automatically.
   *(Or create one at https://neon.tech yourself and add `DATABASE_URL` under Settings →
   Environment Variables.)*
3. **Redeploy** — Deployments → three-dot menu on the latest → Redeploy, so the function picks up
   the variable. The header now shows **Database connected**; tables are created on first request.
4. Share the URL. Every auditor writes to the same Neon database, and you see all of it on the
   Records page or via the CSV exports.

Every later `git push` to `main` redeploys automatically.

Deploying with the CLI instead (`npx vercel`) also works, but the CLI packages the Python function
locally and needs the `uv` tool on PATH plus a Python 3.12 it can find (`uv python install 3.12`).
Run it from a clean checkout so `backend/.env` is not present.

Free-tier notes: Vercel Hobby functions have a 10-second limit (each API call here takes well
under a second) and cold starts of about one second. Neon pauses idle databases and resumes them
automatically in under a second.

### Alternative: Render (backend) + Neon (database)

If you prefer a normal always-on server instead of serverless:

1. Render → New → Web Service → connect the repo.
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Environment variable: `DATABASE_URL` = Neon string.
2. The service URL serves both the API and the frontend.

Render's free web services sleep after 15 minutes idle, so the first request after a pause takes
about a minute. Render's own free PostgreSQL expires after 30 days, which is why Neon is used for
the database. Supabase's free PostgreSQL also works (use its *Session pooler* connection string).

### Hosting the frontend somewhere else

The whole `frontend/` folder can also be dropped on Netlify, GitHub Pages, or any static host. In that
case open `frontend/js/config.js` and set the backend address:

```js
window.PA_AUDIT_CONFIG = { apiUrl: "https://your-backend.vercel.app" };
```

CORS is open by default (`CORS_ORIGINS=*`); restrict it to your frontend origin in the backend
environment once you know it.

## Behaviour worth knowing

- **Draft autosave** — the in-progress checklist and metadata are kept in the browser, so a
  refresh or switching pages does not lose work. The Clear button wipes it.
- **After submit** — the audit is saved, the Summary page opens showing it, and the checklist is
  reset automatically so the next audit starts blank.
- **Dashboard** — the top half is the shared database (total submitted, Approved / Conditional /
  Hold, recent submissions, per-QE counts, most-failed checkpoints) and refreshes on every visit;
  the bottom half is the audit in progress on that browser.
- **Records filters** — search text (record, batch, task, QE, annotator, checkpoint, note), QE,
  verdict, queue, and a submitted-date range. Download Excel / CSV exports exactly the filtered rows.
- **Offline submission** — if the backend cannot be reached at submit time, the audit is kept on
  that browser and the Records tab offers **Send now**. Uploads are idempotent, so retries never
  create duplicates.
- **Delete** in the Records tab removes the audit from the database for everyone (with a confirm).
- **Download Excel** builds a workbook in the browser with two sheets, *Audits* and *Issues*.
