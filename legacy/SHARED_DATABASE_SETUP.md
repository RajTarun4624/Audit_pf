# Shared database setup (one time, about 5 minutes)

The Records tab reads and writes a Google Sheet in your own Google account.
Every auditor's submission lands in that sheet, and every auditor's Records tab shows the same list.

## 1. Create the sheet

1. Go to https://sheets.new and create a blank spreadsheet.
2. Name it something like **PA Audit Records**.

## 2. Add the script

1. In the sheet, open **Extensions → Apps Script**.
2. Delete whatever is in the editor and paste the full contents of `google_apps_script.gs`.
3. Click the save icon.

## 3. Deploy it as a web app

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
4. Click **Deploy**, approve the permissions when Google asks, and copy the **Web app URL**.
   It looks like `https://script.google.com/macros/s/AKfy.../exec`.

## 4. Connect the site

Either of these works:

- **Quick test:** open your site, go to the Records tab, paste the URL into the "Connect the shared database" box, and click Connect. This connects that one browser only.
- **For everyone:** open `index.html`, find the line near the top

  ```
  window.PA_AUDIT_CONFIG = { sheetUrl: "" };
  ```

  put the URL between the quotes, save, and drag `index.html` onto your Netlify Deploys page again.
  Or send the URL to Claude and it will rebuild and hand you the file.

## Notes

- The sheet gets two tabs: **Audits** (one row per submission) and **Issues** (one row per failed or N/A checkpoint, with notes).
- If you edit the script later, use **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same.
- Delete in the Records tab removes the row from the sheet for everyone. Deleting a row directly in the sheet works too.
- The Netlify Forms inbox keeps receiving a copy of every submission as a backup.
