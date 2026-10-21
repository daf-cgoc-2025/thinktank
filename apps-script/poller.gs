/**
 * DAF CGOC Think Tank — Firestore sign-up poller
 * ------------------------------------------------------------------
 * Runs inside a Google Apps Script BOUND TO A GOOGLE SHEET owned by
 * nationalcgoc@gmail.com (the Firebase project owner). Every run it:
 *   1. Queries Firestore (project "dafcgoc", collection "thinktankIntake")
 *      for documents newer than the last-seen watermark.
 *   2. Appends one row per new sign-up to the "Sign-ups" sheet tab.
 *   3. Emails a formatted notification per sign-up to NOTIFY_EMAIL.
 *
 * Setup: see README.md. Trigger: time-driven, every 15 min, function
 * `syncSignups` (created by `setup`).
 */

/**
 * ONE-TIME SETUP — run this once from the editor (Run ▸ setup). It grants
 * the auth prompts and creates the 15-minute sync trigger.
 */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncSignups').timeBased().everyMinutes(15).create();
  syncSignups(); // first sync now — also surfaces any permission problem immediately
}

var PROJECT_ID = 'dafcgoc';
var COLLECTION = 'thinktankIntake';
// thinktank@ is a forward; who reads it is set there, not here. The script
// runs as nationalcgoc, and Gmail can drop a forwarded copy of mail the
// account itself sent, so nationalcgoc is also addressed directly.
var NOTIFY_EMAIL = 'thinktank@dafcgoc.org, nationalcgoc@gmail.com';

var EXPERIENCE_LABELS = {
  none: 'No experience', minimal: 'Minimal', moderate: 'Moderate', experienced: 'Experienced'
};
var SELF_STUDY_LABELS = { true: 'Yes', false: 'No' };

function syncSignups() {
  var props = PropertiesService.getScriptProperties();
  var watermark = props.getProperty('lastCreatedAt') || '1970-01-01T00:00:00Z';

  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
            '/databases/(default)/documents:runQuery';
  var query = {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'createdAt' },
          op: 'GREATER_THAN',
          value: { timestampValue: watermark }
        }
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
      limit: 200
    }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(query),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Firestore query failed (' + res.getResponseCode() + '): ' + res.getContentText());
  }

  var results = JSON.parse(res.getContentText()).filter(function (r) { return r.document; });
  if (!results.length) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Sign-ups') || ss.insertSheet('Sign-ups');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Submitted (UTC)', 'Rank', 'First name', 'Last name', 'Email',
      'Topic area', 'Self-study', 'Research experience', 'Why research', 'Doc ID'
    ]);
    sheet.setFrozenRows(1);
  }

  var mailError = null;
  results.forEach(function (r) {
    var docSnap = r.document;
    var data = unwrap({ mapValue: { fields: docSnap.fields } });
    var name = data.name || {};
    var createdAt = data.createdAt || '';
    var fullName = [name.rank, name.first, name.last].filter(Boolean).join(' ');

    // Sheets reads a cell starting with = + - @ as a formula; sign-ups are public input
    sheet.appendRow([
      createdAt, name.rank || '', name.first || '', name.last || '',
      data.email || '',
      data.topic || '',
      SELF_STUDY_LABELS[data.selfStudy] || '',
      EXPERIENCE_LABELS[data.experience] || data.experience || '',
      data.interest || '',
      docSnap.name.split('/').pop()
    ].map(function (v) { return /^[=+\-@]/.test(v) ? "'" + v : v; }));
    // saved per row (results are oldest first) so a run that dies partway,
    // at the 6-minute limit or on a Sheets error, never appends a row twice
    props.setProperty('lastCreatedAt', createdAt);

    try {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: '[Think Tank] New sign-up — ' + fullName,
        body: plainBody(data, name, ss),          // fallback for text-only clients
        htmlBody: htmlBody(data, name, ss)
      });
    } catch (e) {
      mailError = mailError || e; // keep syncing the Sheet; fail the run after
    }
  });

  if (mailError) throw mailError;
}

/* ---------- formatted notification email ---------- */

function signupRows(data, name) {
  return [
    ['Name', [name.rank, name.first, name.last].filter(Boolean).join(' ')],
    ['Email', data.email || ''],
    ['Topic area', data.topic || ''],
    ['Self-study', SELF_STUDY_LABELS[data.selfStudy] || ''],
    ['Research experience', EXPERIENCE_LABELS[data.experience] || data.experience || ''],
    ['Why research', data.interest || ''],
    ['Submitted', (data.createdAt || '').replace('T', ' ').replace(/\..*$/, ' UTC')]
  ].filter(function (r) { return r[1]; });
}

function htmlBody(data, name, ss) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var trs = signupRows(data, name).map(function (r) {
    return '<tr>' +
      '<td style="padding:7px 14px 7px 0;color:#8a93a5;font-size:13px;white-space:nowrap;vertical-align:top">' + esc(r[0]) + '</td>' +
      '<td style="padding:7px 0;color:#1a2233;font-size:14px">' + esc(r[1]) + '</td></tr>';
  }).join('');
  return '' +
  '<div style="background:#f2f4f8;padding:26px 12px;font-family:Helvetica,Arial,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e3e6ec">' +
      '<div style="background:#04060C;padding:18px 26px">' +
        '<div style="color:#7FAAFF;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">DAF CGOC &middot; Think Tank</div>' +
        '<div style="color:#ffffff;font-size:19px;font-weight:700;margin-top:4px">New cohort sign-up</div>' +
      '</div>' +
      '<div style="padding:14px 26px 22px">' +
        '<table style="border-collapse:collapse;width:100%">' + trs + '</table>' +
      '</div>' +
      '<div style="border-top:3px solid #00308F;background:#fbfbfd;padding:14px 26px">' +
        '<a href="' + ss.getUrl() + '" style="color:#00308F;font-size:13px;font-weight:700;text-decoration:none">Open the sign-up sheet &rarr;</a>' +
      '</div>' +
    '</div>' +
    '<div style="max-width:560px;margin:10px auto 0;color:#9aa3b5;font-size:11px;text-align:center">' +
      'Automated notification &middot; contains member PII, handle accordingly.</div>' +
  '</div>';
}

function plainBody(data, name, ss) {
  return 'New DAF CGOC Think Tank sign-up\n\n' +
    signupRows(data, name).map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
    '\n\nSheet: ' + ss.getUrl();
}

/** Convert a Firestore REST typed value into a plain JS value. */
function unwrap(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrap);
  if ('mapValue' in v) {
    var out = {}, fields = v.mapValue.fields || {};
    Object.keys(fields).forEach(function (k) { out[k] = unwrap(fields[k]); });
    return out;
  }
  return null;
}
