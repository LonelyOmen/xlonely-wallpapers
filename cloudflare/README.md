# Cloudflare community uploads

This Worker adds moderated community wallpaper submissions to the xLonely gallery. The GitHub Pages site continues to hold the gallery and existing collection. New submissions are stored privately in R2, tracked in D1, and served only after a moderator approves them.

## Limits and moderation

- GitHub sign-in is required so daily limits apply per GitHub account.
- Each account can reserve up to five submissions per UTC day.
- Each original must be smaller than 99,000,000 bytes (99 MB). Supported formats are JPG, PNG, WebP, GIF, MP4, WebM, and MOV.
- A submission stays private until approved by the configured moderator.
- Rejecting a submission deletes its original and preview from R2.
- The Worker stops accepting uploads when its tracked storage reaches 8 GiB. Pending and approved files count toward that limit.
- A generated WebP preview is limited to 2 MB.

The R2 bucket must remain private. The Worker checks each upload, keeps moderation state in D1, and streams public files only for approved submissions.

## One-time Cloudflare setup

You need Node.js/npm, a Cloudflare account, and a GitHub OAuth App. The Worker uses Cloudflare Workers, D1, and R2 free-tier allowances; Cloudflare usage beyond included quotas can be billed. Keep the configured 8 GiB application cap in place unless you intentionally raise it.

1. From this directory, copy the example config and log in:

   ```sh
   cp wrangler.toml.example wrangler.toml
   npx wrangler login
   ```

2. Create the private R2 bucket and D1 database:

   ```sh
   npx wrangler r2 bucket create xlonely-wallpaper-community
   npx wrangler d1 create xlonely-wallpaper-community
   ```

   Put the D1 database ID returned by the second command into `wrangler.toml` at `database_id`. Do not enable public access on the R2 bucket.

3. Create a GitHub OAuth App in **GitHub → Settings → Developer settings → OAuth Apps**. Set its homepage to `https://lonelyomen.github.io/xlonely-wallpapers/`. The callback URL is the Worker URL followed by `/auth/callback`; you will get the Worker URL after the first deploy. Put the OAuth App's client ID in `GITHUB_CLIENT_ID` in `wrangler.toml`.

4. Apply the database schema and deploy once to obtain the Worker URL:

   ```sh
   npx wrangler d1 migrations apply xlonely-wallpaper-community --remote
   npx wrangler deploy
   ```

5. Set the OAuth callback URL to `https://<worker-name>.<your-workers-subdomain>.workers.dev/auth/callback`, then add the two secrets:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_SECRET
   openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
   ```

   `ADMIN_GITHUB_LOGIN` defaults to `LonelyOmen`. Change it in `wrangler.toml` if moderation should belong to another GitHub login. Keep the OAuth secret and session secret out of Git.

6. Deploy again and copy the Worker base URL into `submission-config.js`:

   ```sh
   npx wrangler deploy
   ```

   Set `window.WALLPAPER_API_BASE` to the deployed URL, for example `https://xlonely-wallpaper-community.<your-workers-subdomain>.workers.dev`. Commit and push `submission-config.js`, `index.html`, `app.js`, `admin.html`, `admin.js`, and the Pages workflow update. The gallery deploy remains small because wallpaper originals are not included in the Pages artifact.

## Review submissions

After deploying and setting the API URL, open the gallery, sign in with the moderator GitHub account, then visit:

`https://lonelyomen.github.io/xlonely-wallpapers/admin.html`

Approved wallpapers appear in the gallery feed within about a minute. Rejected uploads are deleted. Users can see how many daily submission slots remain in the upload dialog.
