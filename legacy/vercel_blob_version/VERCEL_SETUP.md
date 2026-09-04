# PA Task Audit on Vercel (shared database, no extra accounts)

Everything lives in one Vercel project: the site, a small server function, and a Blob store
that holds every audit. Every auditor's Records tab reads the same store.

## One-time setup (about 5 minutes)

1. **Sign in to Vercel** at https://vercel.com (a free Hobby account is enough).
2. **Deploy:** go to https://vercel.com/drop and drag `pa_task_audit_vercel.zip` onto the page.
   Give the project a name, for example `pa-task-audit`, and click Deploy. You get a live URL.
3. **Create the database:** open the project in Vercel, click the **Storage** tab, choose
   **Create Database → Blob**, keep it **Private**, and connect it to this project.
4. **Redeploy once** so the function can see the store: **Deployments** tab → the three-dot menu on the
   latest deployment → **Redeploy**.
5. Open the site, submit one audit, and check the Records tab. It should show "Shared ✓".

## Updating the site later

Vercel Drop always creates a new project (and a new URL). To update the same project and keep the URL,
use the Vercel CLI once from this folder:

```bash
npx vercel login
```

```bash
npx vercel --prod
```

Or connect the project to a GitHub repository in Vercel and push changes there.

## Where the data is

- Vercel dashboard → your project → **Storage** → the Blob store. Each audit is a file at
  `records/<record_id>.json`, and `index.json` is the combined list the Records tab reads.
- The Records tab's **Download Excel** exports everything in the store.

## Free-plan limits (Hobby)

- Blob storage included: 5 GB per month average. One audit is about 5 KB, so this is not a practical limit.
- Reads: 100,000 simple operations per month. Opening the Records tab is one read.
- Writes and lists: 10,000 advanced operations per month. One submission uses about 4.
- If a limit is hit, Blob access pauses for the rest of the 30-day window. The site keeps working and
  each browser keeps its local copy; nothing is lost.
