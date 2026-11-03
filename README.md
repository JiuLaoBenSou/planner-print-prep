# Planner Print Prep

A free browser-based tool to resize your existing planner PDF, check duplex page order, prepare a test print, and export a print-ready PDF. PDF files stay in browser memory and are not uploaded.

**Website:** https://plannerprintprep.com/

One insert per output side on A4 or Letter. Includes A5, A6, Half Letter and custom trim sizes, proportional scaling, binding space, safety checks, manual front/back exports, and fixed back-side offset correction. Random feed errors and printer skew cannot be corrected with a fixed offset. Physical printing and iPad/Safari paths remain unverified.

The core is free with no account, watermark or export cooldown. Planner Print Prep Plus adds up to 10 PDFs per batch, up to 20 named print profiles and ZIP output for US$9 once, plus applicable taxes. No subscription. Request a full refund within 7 days of payment; non-excludable consumer rights remain. Check the website for checkout availability. No registration form, password or manual license entry is required; access is confirmed by the server and can be restored by a one-time email link. Run npm run dev:plus for an explicitly simulated local demo; it does not charge money.

## Run locally

Node.js 22.18+ and npm are required.

~~~sh
npm ci
npm run dev
~~~

Open http://127.0.0.1:4176/. To build and test:

~~~sh
npm run build
npm test
npm run test:browser
npm run build:pages
npm run test:pages
~~~

Browser checks use an installed Chrome browser. Python PDF checks additionally require the packages in requirements-dev.txt. The optional full local verification script writes its results under output/.

## GitHub Pages

The main branch holds public source. The gh-pages branch holds the reviewed static build. Build with npm run build:pages, then publish output/release/site to the gh-pages branch root. PPP_SITE_URL can override the default HTTPS address when building for a different deployment.

GitHub Pages hosts static assets only. Production access uses a separately deployed Cloudflare Worker with Durable Object SQLite, Creem checkout and Resend transactional recovery email. PDF content and file names are not sent to those services. Use npm run build:billing for the production frontend: it fixes the official site and API and rejects sandbox overrides. Production sales are controlled by the Worker configuration; building the frontend does not enable sales. Never publish .env files, credentials, database files or internal output evidence. The backend and runtime tests require the pinned dependencies from package-lock.json. The sandbox product configuration is non-secret and requires your own test credentials. GitHub and Cloudflare process request/security metadata; see the website Privacy policy for storage, provider policies and contact details.

## Contact and dependencies

Contact: fanghong1994@gmail.com. Please do not email private PDFs or purchased templates.

Third-party license texts are included under public/licenses and alongside PDF.js resources. PDF.js is Apache-2.0, pdf-lib is MIT, and bundled fonts are SIL OFL. These dependency licenses do not grant rights to third-party planner templates.
