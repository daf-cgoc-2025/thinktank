# DAF CGOC Think Tank site

Landing page and cohort sign-up for the DAF CGOC Think Tank. Dev repo:
`daf-cgoc-2025/thinktank`, previewed at https://daf-cgoc-2025.github.io/thinktank/.
Production repo: `dafcgoc-thinktank/thinktank`, served at
https://thinktank.dafcgoc.org (unlisted until launch).

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
                         └─► email notification → thinktank@dafcgoc.org + nationalcgoc@gmail.com
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
- Notifications go to thinktank@dafcgoc.org, the Squarespace email forward
  Hugh set up: add or remove readers there, not in the script.
- This page does not initialize App Check. Do not enforce App Check for
  Firestore (penpal SETUP §6) until it does, or every sign-up here is rejected.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole page, with the Firebase init at the bottom |
| `css/thinktank.css` | All styling; design tokens at the top |
| `css/fonts.css`, `fonts/geist/` | Self-hosted Geist and Geist Mono (SIL OFL, license in the folder) |
| `js/thinktank.js` | Scroll-linked motion, hero pointer effect, form validation, submission |
| `js/analytics.js` | Shared engagement tracking, identical to the copy in the penpal and main site repos |
| `apps-script/` | Poller that copies sign-ups to a Sheet and emails a notification |

## Topics section

The twelve topic areas were copied by hand from Air University's Research
Topics page on 13 October 2026. Air University's list changes; when it does,
edit the `<ol class="areas">` list and the `#topic` options in `index.html`.
The page links to Air University's list as the current source.

## Layout and motion

Each section is a different layout: the hero climb, a held mission screen, a
light index of topic areas, a held frame where the five steps travel sideways,
and the blue sign-up sheet. The held screens and sideways motion run only on
screens 900px and wider, with JavaScript, when the visitor has not asked for
reduced motion. Everywhere else the same content sits in normal flow and the
steps are a swipeable row.

## Changing the form

A field lives in three places that must agree: the input in `index.html`,
`buildPayload()` in `js/thinktank.js`, and the `thinktankIntake` block in the
penpal repo's `firestore.rules`. Add the column in `apps-script/poller.gs` if
the committee needs it in the Sheet.

When the payload's shape changes, bump `schemaVersion` and let the rules accept
the old version too until cached copies of the old page have aged out (Pages
caches for 10 minutes; open tabs keep the old script). Publish rules from the
penpal repo's `main`: Firebase console → Firestore → Rules, or the Rules REST
API (`firebase deploy` needs the Service Usage Consumer role).

## One-time setup

All signed in as nationalcgoc@gmail.com. The rules are already published.

1. Create a Google Sheet for the sign-ups. Extensions → Apps Script. In Project
   Settings, show `appsscript.json` and replace it with
   `apps-script/appsscript.json`. Replace `Code.gs` with
   `apps-script/poller.gs`.
2. Run `setup` once and accept the authorization prompts. It creates the
   15-minute trigger and runs the first sync.
3. Share the Sheet with the Think Tank committee.

## Production

`dafcgoc-thinktank/thinktank` (public, branch build from `main`, HTTPS
enforced) serves https://thinktank.dafcgoc.org. Its `main` is this repo's
`main` plus one commit that adds `CNAME`. Only one Pages site can claim the
domain, so this repo never carries a `CNAME`. Locally that history is the
`prod` branch, pushed to the `prod` remote
(`git@github.com:dafcgoc-thinktank/thinktank.git`). To deploy:

```
git fetch prod
git checkout prod && git merge main && git push prod prod:main
git checkout main
```

## Going live

- Remove `<meta name="robots" content="noindex, nofollow">` from `index.html`,
  then deploy.
- Drop the `schemaVersion == 1` branch from the `thinktankIntake` rules.
- On the main site, change the Thinktank card in `pages/opportunities.html`
  from "Coming Soon" to live and point its buttons here.
