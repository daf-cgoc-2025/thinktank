# DAF CGOC Think Tank site

Landing page and cohort sign-up for the DAF CGOC Think Tank. Dev repo:
`daf-cgoc-2025/thinktank`, previewed at https://daf-cgoc-2025.github.io/thinktank/.
Intended production address: https://thinktank.dafcgoc.org (not set up yet).

Plain HTML, CSS, and JS on GitHub Pages. No build step. It follows the penpal
site (`daf-cgoc-2025/penpal`) and shares its Firebase project.

## How it works

```
visitor ──► index.html
              │  gtag.js: G-74QCBZFVWH (sitewide GA) + G-WT36BHRC7X (Firebase property)
              │
              └─ sign-up form ──► Firestore `thinktankIntake` (project "dafcgoc", create-only)
                                     ▼
                      Apps Script poller (runs as nationalcgoc@gmail.com, every 15 min)
                         ├─► Google Sheet tab "Sign-ups" (one row per sign-up)
                         └─► email notification → nationalcgoc@gmail.com
```

- The browser writes to Firestore with the Firebase JS SDK (`firestore-lite`,
  loaded from Google's CDN at the bottom of `index.html`). The committed
  Firebase config is public by design. Access control is the security rules.
- **The rules live in the penpal repo** (`firestore.rules`, block
  `thinktankIntake`). Project `dafcgoc` has one ruleset, so deploying a rules
  file from this repo would overwrite penpal's.
- One sign-up per email: the document id is a hash of the email and the rules
  deny updates. A second attempt gets the "already signed up" message. Any
  other rules rejection shows the same message, so after changing a form field
  test a fresh email before trusting it.
- If Firestore is unreachable the page opens a pre-filled email to
  `thinktank@dafcgoc.org`.
- Sign-ups are readable only by dashboard super-admins and by the poller. The
  committee works from the Sheet.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole page, with the Firebase init at the bottom |
| `css/thinktank.css` | All styling; design tokens at the top |
| `css/fonts.css`, `fonts/geist/` | Self-hosted Geist and Geist Mono (SIL OFL, license in the folder) |
| `js/thinktank.js` | Hero pointer effect, form validation, submission |
| `js/analytics.js` | Shared engagement tracking, identical to the copy in the penpal and main site repos |
| `apps-script/` | Poller that copies sign-ups to a Sheet and emails a notification |

## Changing the form

A field lives in three places that must agree: the input in `index.html`,
`buildPayload()` in `js/thinktank.js`, and the `thinktankIntake` block in the
penpal repo's `firestore.rules` (re-publish the rules after editing). Add the
column in `apps-script/poller.gs` if the committee needs it in the Sheet.

## One-time setup

All signed in as nationalcgoc@gmail.com.

1. Publish the rules from the penpal repo: Firebase console → Firestore →
   Rules, or `firebase deploy --only firestore:rules`.
2. Create a Google Sheet for the sign-ups. Extensions → Apps Script. In Project
   Settings, show `appsscript.json` and replace it with
   `apps-script/appsscript.json`. Replace `Code.gs` with
   `apps-script/poller.gs`.
3. Run `setup` once and accept the authorization prompts. It creates the
   15-minute trigger and runs the first sync.
4. Share the Sheet with the Think Tank committee.

## Going live

- Create the production Pages site with a `CNAME` file containing
  `thinktank.dafcgoc.org`, and add the DNS record. Only one Pages site can claim
  the domain, so the dev repo carries no `CNAME`.
- Remove `<meta name="robots" content="noindex, nofollow">` from `index.html`.
- On the main site, change the Thinktank card in `pages/opportunities.html`
  from "Coming Soon" to live and point its buttons here.
