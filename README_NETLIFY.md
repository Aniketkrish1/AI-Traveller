Deploying to Netlify (quick guide)

Summary
- The frontend static files live in `public/`.
- The backend `/generate` endpoint is packaged as a Netlify Function at `netlify/functions/generate.js`.
- You must set `GEMINI_API_KEY` in Netlify site environment variables before deploying.

Steps (Connect repo)
1. Commit and push this repo to GitHub (or another Git provider).
2. In Netlify, "New site from Git" → pick your repo → build settings.
   - Build command: (none required for purely static) leave blank or `npm run build` if you add a build step later.
   - Publish directory: `public`
   - Functions directory: `netlify/functions` (Netlify auto-detects from `netlify.toml`).
3. In Site settings → Environment → Add variable: `GEMINI_API_KEY` = your key.

Steps (Using Netlify CLI for quick test)
1. Install `netlify-cli` if you don't have it:
   ```powershell
   npm install -g netlify-cli
   ```
2. Run local dev (it will serve functions at `/.netlify/functions/*`):
   ```powershell
   netlify dev
   ```
3. The app will be available at the printed local URL. Use the planner as usual.

Notes
- Ensure `GEMINI_API_KEY` is set in Netlify environment variables for production; otherwise the function will return a 503 error.
- Large server-side dependencies will be installed by Netlify during deploy. If functions exceed size limits, consider moving AI calls to a dedicated backend (e.g., Render, Railway, or Vercel Serverless with larger limits).
