# Cloudflare community uploads

This Worker adds moderated community wallpaper submissions to the xLonely gallery. The GitHub Pages site continues to hold the gallery and existing collection. New submissions are stored as assets on private draft GitHub Releases, tracked in D1, and published only after a moderator approves them. This keeps wallpaper binaries out of Git history and does not require Cloudflare R2.

## Limits and moderation

- GitHub sign-in is required so daily limits apply per GitHub account.
- Each account can reserve up to five submissions per UTC day.
- Each original must be smaller than 99,000,000 bytes (99 MB). Supported formats are JPG, PNG, WebP, GIF, MP4, WebM, and MOV.
- A submission stays private until approved by the configured moderator.
- Rejecting a submission deletes its draft release and assets.
- The Worker stops accepting uploads when tracked storage reaches the configured 8 GiB application cap.
- A generated WebP preview is limited to 2 MB.

Each pending wallpaper gets a draft release, visible only to repository collaborators. Approval publishes that release; rejection deletes it. [GitHub documents](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas) a 2 GiB per-asset limit and no total release storage or bandwidth limit. This app keeps each upload below 99 MB and applies its own 8 GiB cap.

## One-time Cloudflare setup

You need Node.js/npm, a Cloudflare account with Workers/D1, a GitHub OAuth App, and a fine-grained GitHub token scoped to this repository. No R2 bucket or R2 subscription is needed. Keep the configured 8 GiB application cap in place unless you intentionally raise it.

1. From this directory, copy the example config and log in:

   ```sh
   cp wrangler.toml.example wrangler.toml
   npx wrangler login
   ```

2. Create the D1 database (skip this if you already created it):

   ```sh
   npx wrangler d1 create xlonely-wallpaper-community
   ```

   Put the database ID into `wrangler.toml` at `database_id`. If you created the database from the previous guide, its ID is already in your local config.

3. Create a fine-grained personal access token in **GitHub → Settings → Developer settings → Personal access tokens**. Select only `LonelyOmen/xlonely-wallpapers` and grant **Contents: read and write**. Keep the token ready for the first Worker deploy; do not put it in the website or commit it. Set a reminder to rotate it before its expiration.

4. Create a GitHub OAuth App in **GitHub → Settings → Developer settings → OAuth Apps**. Set its homepage to `https://lonelyomen.github.io/xlonely-wallpapers/`. The callback URL is the Worker URL followed by `/auth/callback`; you will get the Worker URL after the first deploy. Put the OAuth App's client ID in `GITHUB_CLIENT_ID` in `wrangler.toml`.

5. Apply the database schema and deploy once to obtain the Worker URL:

   ```sh
   npx wrangler d1 migrations apply xlonely-wallpaper-community --remote
   npx wrangler deploy
   ```

6. Set the OAuth callback URL to `https://<worker-name>.<your-workers-subdomain>.workers.dev/auth/callback`, then add the GitHub storage, OAuth, and session secrets:

   ```sh
   npx wrangler secret put GITHUB_STORAGE_TOKEN
   npx wrangler secret put GITHUB_CLIENT_SECRET
   openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
   ```

   The GitHub token is used only by the Worker to create draft releases, attach submitted assets, publish approved releases, and delete rejected releases.

   `ADMIN_GITHUB_LOGIN` defaults to `LonelyOmen`. Change it in `wrangler.toml` if moderation should belong to another GitHub login. Keep all secrets out of Git.

7. Deploy again and copy the Worker base URL into `submission-config.js`:

   ```sh
   npx wrangler deploy
   ```

   Set `window.WALLPAPER_API_BASE` to the deployed URL, for example `https://xlonely-wallpaper-community.<your-workers-subdomain>.workers.dev`. Commit and push `submission-config.js`, `index.html`, `app.js`, `admin.html`, `admin.js`, and the Pages workflow update. The gallery deploy remains small because wallpaper originals are not included in the Pages artifact.

## Review submissions

After deploying and setting the API URL, open the gallery, sign in with the moderator GitHub account, then visit:

`https://lonelyomen.github.io/xlonely-wallpapers/admin.html`

Approved wallpapers appear in the gallery feed within about a minute. Rejected uploads are deleted. Users can see how many daily submission slots remain in the upload dialog.
