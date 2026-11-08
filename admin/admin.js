/* ============================================================
   DAF CGOC Think Tank — Admin dashboard
   The penpal dashboard (daf-cgoc-2025/penpal admin/) with review
   status in place of matching. Google sign-in + Firestore reads gated
   by the penpal repo's firestore.rules:
     super-admins (dashboardAdmins)  -> everything, can manage viewers
     thinktankViewers access=both/responses -> applications, reviews, activity
     thinktankViewers access=analytics      -> PII-free thinktankStats/summary

   Submissions stay immutable: a decision lives in thinktankReviews/{intakeId},
   and every change is written to the append-only thinktankAuditLog.
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore-lite.js";

const app = initializeApp({
  apiKey: "AIzaSyDmvHOK_DGdhnro9XiJd9hozB5VDGtAFso",
  authDomain: "dafcgoc.firebaseapp.com",
  projectId: "dafcgoc",
  storageBucket: "dafcgoc.firebasestorage.app",
  messagingSenderId: "744994373915",
  appId: "1:744994373915:web:9ae778d54b6073847013be"
});
const auth = getAuth(app);
const db = getFirestore(app);

const COLORS = { cohort: "#3E7BD6", self: "#B08A3E" };
const TRACK_LABEL = { cohort: "Cohort", self: "Self-study" };
const EXPERIENCE_LABEL = {
  none: "No experience", minimal: "Minimal", moderate: "Moderate", experienced: "Experienced"
};
const STATUS_LABEL = {
  new: "New", reviewing: "Reviewing", accepted: "Accepted",
  waitlisted: "Waitlisted", declined: "Declined"
};
const ACTION_LABEL = {
  review_status: "Status changed", review_update: "Review updated",
  review_clear: "Review cleared", viewer_add: "Viewer added", viewer_remove: "Viewer removed"
};
const $ = (id) => document.getElementById(id);

let me = null;        // { email, access: 'super'|'both'|'responses'|'analytics' }
let applications = [];
let reviews = {};     // intakeId -> review doc
let activity = [];
let stats = null;
let sortKey = "createdAt", sortDir = -1;
let lastTrigger = null;   // element that opened the dialog, for focus return

/* ---------------- auth ---------------- */
$("btn-signin").addEventListener("click", async () => {
  $("signin-error").hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    const el = $("signin-error");
    el.textContent = "Sign-in failed: " + (e.code || e.message);
    el.hidden = false;
  }
});
$("btn-signout").addEventListener("click", () => signOut(auth));
$("btn-signout-2").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  show("loading");
  if (!user) { me = null; return show("view-signedout"); }
  const email = (user.email || "").toLowerCase();
  $("user-email").textContent = email;
  $("user-area").hidden = false;

  // Privileges come from what the rules permit, not from any list in this
  // (public) code: only super-admins may LIST the viewer collection.
  let access = null;
  try { await getDocs(collection(db, "thinktankViewers")); access = "super"; }
  catch (e) { /* not a super-admin */ }
  if (!access) {
    try {
      const snap = await getDoc(doc(db, "thinktankViewers", email));
      if (snap.exists()) access = snap.data().access;
    } catch (e) { /* no access */ }
  }
  if (!access) {
    $("noaccess-email").textContent = email;
    return show("view-noaccess");
  }
  me = { email, access };
  await loadData();
  renderAll();
  show("view-dash");
});

function show(id) {
  ["view-signedout", "view-noaccess", "view-dash", "loading"].forEach((v) => {
    $(v).hidden = v !== id;
  });
  $("user-area").hidden = !auth.currentUser;
}

/* ---------------- data ---------------- */
const canSeeApplications = () =>
  me.access === "super" || me.access === "both" || me.access === "responses";

async function loadData() {
  if (canSeeApplications()) {
    const snap = await getDocs(collection(db, "thinktankIntake"));
    applications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    reviews = Object.fromEntries((await safeList("thinktankReviews")).map((r) => [r.id, r]));
    activity = (await safeList("thinktankAuditLog"))
      .sort((a, b) => String(tsOf(b.at)).localeCompare(String(tsOf(a.at))));
    stats = computeStats(applications);
    if (me.access === "super") {
      setDoc(doc(db, "thinktankStats", "summary"), { ...stats, updatedAt: serverTimestamp() })
        .catch(() => {});
    }
  } else {
    const snap = await getDoc(doc(db, "thinktankStats", "summary"));
    stats = snap.exists() ? snap.data() : null;
    $("stats-note").textContent = stats
      ? "Aggregated view. Updated " + fmtDate(stats.updatedAt) + "."
      : "No aggregated stats have been published yet — ask an admin to open the dashboard once.";
    $("stats-note").hidden = false;
  }
}
async function safeList(name) {
  try {
    const s = await getDocs(collection(db, name));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { return []; }
}

const fullName = (d) => [d.name?.rank, d.name?.first, d.name?.last].filter(Boolean).join(" ");
const trackOf = (d) => (d.selfStudy ? "self" : "cohort");
const topicOf = (d) => d.topic || "No preference";
const statusOf = (id) => reviews[id]?.status || "new";
const cohortOf = (id) => reviews[id]?.cohort || "";

function computeStats(docs) {
  const s = {
    total: docs.length, cohort: 0, self: 0, thisMonth: 0,
    byMonth: {}, topics: {}, experience: {}, ranks: {}, statuses: {}, demand: {}
  };
  const nowMonth = new Date().toISOString().slice(0, 7);
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  docs.forEach((d) => {
    const track = trackOf(d);
    s[track]++;
    const month = tsOf(d.createdAt).slice(0, 7);
    if (month) {
      s.byMonth[month] = s.byMonth[month] || { cohort: 0, self: 0 };
      s.byMonth[month][track]++;
      if (month === nowMonth) s.thisMonth++;
    }
    const topic = topicOf(d);
    const st = statusOf(d.id);
    bump(s.topics, topic);
    bump(s.experience, EXPERIENCE_LABEL[d.experience] || d.experience);
    bump(s.ranks, d.name?.rank);
    bump(s.statuses, st);
    s.demand[topic] = s.demand[topic] || { applied: 0, cohort: 0, self: 0, accepted: 0, waitlisted: 0 };
    s.demand[topic].applied++;
    s.demand[topic][track]++;
    if (st === "accepted" || st === "waitlisted") s.demand[topic][st]++;
  });
  return s;
}

/* ---------------- audit log ---------------- */
async function logChange(action, targetId, summary, before, after) {
  const entry = {
    at: serverTimestamp(), actor: me.email, action,
    targetId: targetId || "", summary: String(summary).slice(0, 300)
  };
  if (before !== undefined) entry.before = String(before);
  if (after !== undefined) entry.after = String(after);
  try {
    const ref = await addDoc(collection(db, "thinktankAuditLog"), entry);
    activity.unshift({ id: ref.id, ...entry, at: new Date().toISOString() });
    renderActivity();
  } catch (e) { /* logging must never block the action */ }
}

/* ---------------- reviews ---------------- */
async function saveReview(d, status, cohort, notes) {
  const prev = reviews[d.id];
  const payload = {
    name: fullName(d), status, cohort: cohort.trim(), notes: notes.trim(),
    updatedBy: me.email, updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "thinktankReviews", d.id), payload);
  reviews[d.id] = { id: d.id, ...payload, updatedAt: new Date().toISOString() };
  const before = STATUS_LABEL[prev?.status || "new"];
  if (before !== STATUS_LABEL[status]) {
    logChange("review_status", d.id, fullName(d), before, STATUS_LABEL[status]);
  } else {
    logChange("review_update", d.id, `${fullName(d)}: cohort or notes`);
  }
  refresh(d);
}
async function clearReview(d) {
  const prev = reviews[d.id];
  await deleteDoc(doc(db, "thinktankReviews", d.id));
  delete reviews[d.id];
  logChange("review_clear", d.id, fullName(d), STATUS_LABEL[prev?.status || "new"], STATUS_LABEL.new);
  refresh(d);
}
function refresh(d) {
  stats = computeStats(applications);
  renderOverview($("tiles"), $("charts"), $("demand"), false);
  renderApplications();
  if ($("detail").open) renderReviewBox(d);
}

/* ---------------- render ---------------- */
function renderAll() {
  $("tab-viewers").hidden = me.access !== "super";
  $("tab-applications").hidden = !canSeeApplications();
  $("tab-activity").hidden = !canSeeApplications();
  $("btn-report").hidden = false;
  renderOverview($("tiles"), $("charts"), $("demand"), false);
  if (canSeeApplications()) {
    fillTopicFilter(); renderHead(); renderApplications(); renderActivity();
  }
  if (me.access === "super") renderViewers();
}

const top = (o, n) => Object.entries(o || {}).filter(([k]) => k && k !== "—")
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

function renderOverview(tilesEl, chartsEl, demandEl, print) {
  if (!stats) { tilesEl.innerHTML = ""; chartsEl.innerHTML = ""; demandEl.innerHTML = ""; return; }
  const st = stats.statuses || {};
  const tile = (v, l) => `<div class="${print ? "r-tile" : "tile"}"><b>${v}</b><span>${l}</span></div>`;
  tilesEl.innerHTML =
    tile(stats.total, "Applications") + tile(stats.cohort, "Cohort track") +
    tile(stats.self, "Self-study") + tile((st.new || 0) + (st.reviewing || 0), "Awaiting decision") +
    tile(st.accepted || 0, "Accepted");

  const t = print
    ? { grid: "#e3e6ec", cls: "r-chart" }
    : { grid: "rgba(180,200,255,.10)", cls: "chart" };

  chartsEl.innerHTML =
    monthChart(stats.byMonth, t) +
    hbar("Topic areas", top(stats.topics, 13), COLORS.cohort, t) +
    hbar("Research experience", top(stats.experience, 4), COLORS.cohort, t) +
    hbar("Rank", top(stats.ranks, 3), COLORS.cohort, t) +
    hbar("Review status", top(Object.fromEntries(Object.entries(st)
      .map(([k, v]) => [STATUS_LABEL[k] || k, v])), 5), COLORS.self, t);

  const rows = Object.entries(stats.demand || {})
    .sort((a, b) => b[1].applied - a[1].applied || a[0].localeCompare(b[0]));
  demandEl.innerHTML = rows.length ? `
    <h3>Topic demand</h3>
    <div class="tablewrap"><table class="rtable">
      <caption class="sr-only">Applications and decisions per topic area.</caption>
      <thead><tr><th scope="col">Topic area</th><th scope="col" class="num">Applied</th>
        <th scope="col" class="num">Cohort</th><th scope="col" class="num">Self-study</th>
        <th scope="col" class="num">Accepted</th><th scope="col" class="num">Waitlisted</th></tr></thead>
      <tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.applied}</td>
        <td class="num">${v.cohort}</td><td class="num">${v.self}</td>
        <td class="num">${v.accepted}</td><td class="num">${v.waitlisted}</td></tr>`).join("")}</tbody>
    </table></div>` : "";
  if (!print) { hookTooltips(chartsEl); scaleChartText(chartsEl); }
}

/* a rect with only its data end rounded, anchored square to the baseline */
function barPath(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, dir === "right" ? w : h));
  if (dir === "right") {
    return `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r}
            V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z`;
  }
  return `M${x},${y + h} V${y + r} A${r},${r} 0 0 1 ${x + r},${y}
          H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h} Z`;
}

/* Grouped monthly bars — capped at 8 groups so the pairs stay readable */
function monthChart(byMonth, t) {
  const months = Object.keys(byMonth || {}).sort().slice(-8);
  if (!months.length) return "";
  const W = 420, H = 200, padL = 30, padB = 28, padT = 8;
  const max = Math.max(2, ...months.map((m) => Math.max(byMonth[m].cohort, byMonth[m].self)));
  const slot = (W - padL - 8) / months.length;
  const bw = Math.min(18, (slot - 10) / 2);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  let bars = "", labels = "";
  months.forEach((m, i) => {
    const x0 = padL + i * slot + (slot - bw * 2 - 2) / 2;
    [["cohort", COLORS.cohort, x0], ["self", COLORS.self, x0 + bw + 2]].forEach(([k, c, x]) => {
      const v = byMonth[m][k];
      const h = v ? Math.max(3, H - padB - y(v)) : 0;
      if (h) bars += `<g class="bar-hit" data-tip="${monthName(m)} — ${v} ${TRACK_LABEL[k].toLowerCase()}">
        <rect x="${x - 3}" y="${padT}" width="${bw + 6}" height="${H - padT - padB}" fill="transparent"/>
        <path class="mark" d="${barPath(x, H - padB - h, bw, h, 4, "up")}" fill="${c}"/></g>`;
    });
    labels += `<text class="t-tick" x="${padL + i * slot + slot / 2}" y="${H - 10}"
      text-anchor="middle">${monthName(m)}</text>`;
  });
  const grid = [0, 0.5, 1].map((f) => {
    const v = Math.round(max * f);
    return `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="${t.grid}" stroke-width="1"/>
      <text class="t-tick" x="${padL - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }).join("");
  return `<div class="${t.cls}"><h3>Applications by month</h3>
    <div class="legend"><span><i style="background:${COLORS.cohort}"></i>Cohort</span>
    <span><i style="background:${COLORS.self}"></i>Self-study</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Applications by month, cohort and self-study">
      ${grid}${bars}${labels}</svg></div>`;
}

/* Horizontal bars — no axis, value labelled directly at the bar end */
function hbar(title, entries, color, t) {
  if (!entries.length) return "";
  const W = 420, rowH = 30, padT = 4;
  const H = padT + entries.length * rowH + 4;
  const max = Math.max(...entries.map((e) => e[1]));
  const labelW = 178, valW = 34;
  let rows = "";
  entries.forEach(([k, v], i) => {
    const yy = padT + i * rowH;
    const bw = Math.max(4, (W - labelW - valW - 10) * (v / max));
    const name = k.length > 24 ? k.slice(0, 23) + "…" : k;
    rows += `<g class="bar-hit" data-tip="${esc(k)} — ${v}">
      <rect x="0" y="${yy}" width="${W}" height="${rowH - 2}" fill="transparent"/>
      <text class="t-cat" x="${labelW - 10}" y="${yy + rowH / 2 + 4}" text-anchor="end">${esc(name)}</text>
      <path class="mark" d="${barPath(labelW, yy + (rowH - 16) / 2, bw, 16, 4, "right")}" fill="${color}"/>
      <text class="t-val" x="${labelW + bw + 8}" y="${yy + rowH / 2 + 4}">${v}</text></g>`;
  });
  return `<div class="${t.cls}"><h3>${esc(title)}</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${rows}</svg></div>`;
}

/* keep SVG label sizes honest regardless of container width */
function scaleChartText(root) {
  const set = () => root.querySelectorAll(".chart").forEach((c) => {
    const svg = c.querySelector("svg");
    if (!svg) return;
    const vb = svg.viewBox.baseVal.width || 420;
    const w = svg.clientWidth || vb;
    c.style.setProperty("--cs", (vb / w).toFixed(3));
  });
  set();
  if (window.ResizeObserver && !scaleChartText._ro) {
    scaleChartText._ro = new ResizeObserver(set);
    scaleChartText._ro.observe(root);
  }
}

function hookTooltips(root) {
  const tip = $("tooltip");
  root.querySelectorAll(".bar-hit").forEach((g) => {
    g.addEventListener("mousemove", (e) => {
      tip.textContent = g.dataset.tip;
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = (e.clientY - 36) + "px";
    });
    g.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}

/* ---------------- applications table ---------------- */
const COLUMNS = [
  { key: "createdAt", label: "Submitted", get: (d) => tsOf(d.createdAt) },
  { key: "name", label: "Name", get: (d) => fullName(d) },
  { key: "topic", label: "Topic", get: (d) => topicOf(d) },
  { key: "track", label: "Track", get: (d) => TRACK_LABEL[trackOf(d)] },
  { key: "experience", label: "Experience", get: (d) => EXPERIENCE_LABEL[d.experience] || "" },
  { key: "status", label: "Status", get: (d) => STATUS_LABEL[statusOf(d.id)] },
  { key: "cohort", label: "Cohort", get: (d) => cohortOf(d.id) }
];

function fillTopicFilter() {
  const sel = $("f-topic");
  const topics = [...new Set(applications.map(topicOf))].sort();
  sel.innerHTML = `<option value="">All topics</option>` +
    topics.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
}

function renderHead() {
  $("rtable-head").innerHTML = COLUMNS.map((c) => {
    const active = sortKey === c.key;
    const caret = active ? (sortDir === 1 ? "▲" : "▼") : "▾";
    return `<th scope="col"${active ? ` aria-sort="${sortDir === 1 ? "ascending" : "descending"}"` : ""}>
      <button class="th-sort" type="button" data-sort="${c.key}">${esc(c.label)}
        <span class="caret" aria-hidden="true">${caret}</span></button></th>`;
  }).join("");
  $("rtable-head").querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.sort;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      renderHead(); renderApplications();
    }));
}

function filteredApplications() {
  const track = $("f-track").value;
  const st = $("f-status").value;
  const topic = $("f-topic").value;
  const q = $("f-search").value.trim().toLowerCase();
  const col = COLUMNS.find((c) => c.key === sortKey) || COLUMNS[0];
  return applications.filter((d) => {
    if (track && trackOf(d) !== track) return false;
    if (st && statusOf(d.id) !== st) return false;
    if (topic && topicOf(d) !== topic) return false;
    if (!q) return true;
    return [fullName(d), d.email, cohortOf(d.id)].join(" ").toLowerCase().includes(q);
  }).sort((a, b) => String(col.get(a)).localeCompare(String(col.get(b)), undefined,
    { numeric: true }) * sortDir);
}

function renderApplications() {
  const rows = filteredApplications();
  $("f-count").textContent = `Showing ${rows.length} of ${applications.length}`;

  const tb = $("rtable").querySelector("tbody");
  tb.innerHTML = rows.map((d) => {
    const st = statusOf(d.id);
    const track = trackOf(d);
    return `<tr>
      <td>${fmtDate(d.createdAt)}</td>
      <td><button class="rowlink" type="button" data-id="${esc(d.id)}">${esc(fullName(d))}</button></td>
      <td>${esc(topicOf(d))}</td>
      <td><span class="pill pill--${track}">${esc(TRACK_LABEL[track])}</span></td>
      <td>${esc(EXPERIENCE_LABEL[d.experience] || "")}</td>
      <td><span class="pill pill--${esc(st)}">${esc(STATUS_LABEL[st])}</span></td>
      <td>${esc(cohortOf(d.id))}</td></tr>`;
  }).join("");

  tb.querySelectorAll(".rowlink").forEach((b) =>
    b.addEventListener("click", () =>
      openDetail(applications.find((r) => r.id === b.dataset.id), b)));
  tb.querySelectorAll("tr").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;      // the button handles itself
      tr.querySelector(".rowlink")?.click();
    }));

  const empty = $("applications-empty");
  $("rtable-wrap").hidden = rows.length === 0;
  empty.hidden = rows.length !== 0;
  if (!rows.length) {
    empty.innerHTML = applications.length === 0
      ? `<h3>No applications yet</h3><p>Sign-ups from
         <a href="https://thinktank.dafcgoc.org" target="_blank" rel="noopener">thinktank.dafcgoc.org</a>
         appear here within seconds of someone completing the form.</p>`
      : `<h3>No one matches these filters</h3>
         <p>Filters active: ${esc(activeFilterText())}.</p>
         <button class="btn btn--ghost btn--sm" id="clear-filters" type="button">Clear all filters</button>`;
    const c = $("clear-filters");
    if (c) c.addEventListener("click", () => {
      ["f-track", "f-status", "f-topic", "f-search"].forEach((id) => { $(id).value = ""; });
      renderApplications(); $("f-search").focus();
    });
  }
}
function activeFilterText() {
  const bits = [];
  if ($("f-track").value) bits.push(TRACK_LABEL[$("f-track").value]);
  if ($("f-status").value) bits.push(STATUS_LABEL[$("f-status").value]);
  if ($("f-topic").value) bits.push($("f-topic").value);
  if ($("f-search").value.trim()) bits.push(`search “${$("f-search").value.trim()}”`);
  return bits.join(", ") || "none";
}
["f-track", "f-status", "f-topic"].forEach((id) => $(id).addEventListener("change", renderApplications));
let searchTimer;
$("f-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderApplications, 350);   // debounce so the count announces once
});

/* ---------------- activity tab ---------------- */
function renderActivity() {
  const tb = $("atable").querySelector("tbody");
  $("activity-empty").hidden = activity.length !== 0;
  tb.innerHTML = activity.map((a) => {
    const change = a.before || a.after
      ? `${a.before || "—"} → ${a.after || "—"}` : "";
    return `<tr>
      <td>${fmtDateTime(a.at)}</td>
      <td>${esc(a.actor || "")}</td>
      <td>${esc(ACTION_LABEL[a.action] || a.action || "")}</td>
      <td>${esc(a.summary || "")}${change ? ` <span class="note">(${esc(change)})</span>` : ""}</td>
    </tr>`;
  }).join("");
}

/* ---------------- detail dialog ---------------- */
const detail = $("detail");
function openDetail(d, trigger) {
  if (!d) return;
  lastTrigger = trigger || document.activeElement;
  $("detail-title").textContent = fullName(d);
  renderReviewBox(d);
  const rows = [
    ["Submitted", fmtDate(d.createdAt)],
    ["Email", `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`, true],
    ["Topic area", topicOf(d)],
    ["Track", d.selfStudy ? "Self-study (needs approval)" : "Cohort"],
    ["Research experience", EXPERIENCE_LABEL[d.experience] || d.experience],
    ["Why they're interested", d.interest]
  ];
  $("detail-body").innerHTML = rows.map(([k, v, html]) =>
    `<dt>${esc(k)}</dt><dd>${html ? v : esc(String(v ?? "—"))}</dd>`).join("");
  if (!detail.open) detail.showModal();
  $("detail-title").focus();     // land on context, not the first control
}
function closeDetail() {
  if (detail.open) detail.close();
}
detail.addEventListener("close", () => {
  if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  lastTrigger = null;
});
$("detail-close").addEventListener("click", closeDetail);
detail.addEventListener("click", (e) => {          // click on the backdrop area
  if (e.target === detail) closeDetail();
});

function renderReviewBox(d) {
  const box = $("detail-review");
  const r = reviews[d.id];
  const st = statusOf(d.id);
  const cohorts = [...new Set(Object.values(reviews).map((x) => x.cohort).filter(Boolean))].sort();
  box.innerHTML = `
    <div class="reviewbox__head">
      <span class="reviewbox__title">Review</span>
      <span class="pill pill--${esc(st)}">${esc(STATUS_LABEL[st])}</span>
    </div>
    ${r ? `<p class="reviewbox__meta">Last updated ${esc(fmtDateTime(r.updatedAt))} by ${esc(r.updatedBy || "")}</p>` : ""}
    <div class="reviewbox__grid" role="group" aria-label="Review decision">
      <div><label class="reviewbox__meta" for="rb-status">Status</label>
        <select id="rb-status">
          ${["reviewing", "accepted", "waitlisted", "declined"].map((s) =>
            `<option value="${s}"${s === (r?.status || "reviewing") ? " selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
        </select></div>
      <div><label class="reviewbox__meta" for="rb-cohort">Cohort</label>
        <input id="rb-cohort" list="rb-cohorts" maxlength="60" value="${esc(r?.cohort || "")}"
          placeholder="${d.selfStudy ? "Self-study" : "e.g. Cohort 1"}">
        <datalist id="rb-cohorts">${cohorts.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
    </div>
    <div class="reviewbox__row">
      <label class="sr-only" for="rb-notes">Notes</label>
      <textarea id="rb-notes" maxlength="1000" placeholder="Notes (optional)">${esc(r?.notes || "")}</textarea>
    </div>
    <div class="reviewbox__row">
      <button class="btn btn--gold btn--sm" id="rb-save" type="button">Save review</button>
      ${r ? `<button class="btn btn--danger btn--sm" id="rb-clear" type="button">Clear review</button>` : ""}
      <span class="hint">${d.selfStudy
        ? "Applied for self-study. Accepting approves the self-study track."
        : "Applied for a cohort."}</span>
    </div>`;
  $("rb-save").addEventListener("click", (e) => {
    e.target.disabled = true;
    saveReview(d, $("rb-status").value, $("rb-cohort").value, $("rb-notes").value)
      .catch(() => { e.target.disabled = false; });
  });
  const clear = $("rb-clear");
  if (clear) clear.addEventListener("click", () => { clear.disabled = true; clearReview(d); });
}

/* ---------------- viewers ---------------- */
async function renderViewers() {
  const snap = await getDocs(collection(db, "thinktankViewers"));
  const tb = $("vtable").querySelector("tbody");
  tb.innerHTML = snap.docs.map((d) => {
    const v = d.data();
    return `<tr><td>${esc(d.id)}</td><td>${esc(v.access)}</td>
      <td>${fmtDate(v.addedAt)}</td>
      <td><button class="btn btn--danger btn--sm" data-del="${esc(d.id)}">Remove</button></td></tr>`;
  }).join("") || `<tr><td colspan="4" style="color:var(--text-muted)">No extra viewers yet.</td></tr>`;
  tb.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await deleteDoc(doc(db, "thinktankViewers", b.dataset.del));
      logChange("viewer_remove", b.dataset.del, b.dataset.del);
      renderViewers();
    }));
}
$("add-viewer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("v-email").value.trim().toLowerCase();
  if (!email) return;
  const access = $("v-access").value;
  await setDoc(doc(db, "thinktankViewers", email),
    { access, addedBy: me.email, addedAt: serverTimestamp() });
  logChange("viewer_add", email, `${email} (${access})`);
  $("v-email").value = "";
  renderViewers();
});

/* ---------------- tabs ---------------- */
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => {
      x.classList.toggle("is-active", x === t);
      x.setAttribute("aria-selected", x === t);
    });
    ["overview", "applications", "activity", "viewers"].forEach((p) =>
      $("panel-" + p).hidden = p !== t.dataset.tab);
  }));

/* ---------------- PDF report ---------------- */
$("btn-report").addEventListener("click", () => {
  const r = $("report");
  const now = new Date();
  const tiles = document.createElement("div");
  const charts = document.createElement("div");
  const demand = document.createElement("div");
  renderOverview(tiles, charts, demand, true);

  let tableHtml = "";
  if (canSeeApplications() && applications.length) {
    tableHtml += `<h2>Applications (${applications.length})</h2>
      <table><thead><tr><th>Submitted</th><th>Name</th><th>Email</th><th>Topic</th>
      <th>Track</th><th>Experience</th><th>Status</th><th>Cohort</th><th>Notes</th></tr></thead><tbody>` +
      applications.slice().sort((a, b) => tsOf(b.createdAt).localeCompare(tsOf(a.createdAt)))
        .map((d) => `<tr><td>${fmtDate(d.createdAt)}</td><td>${esc(fullName(d))}</td>
          <td>${esc(d.email || "")}</td><td>${esc(topicOf(d))}</td>
          <td>${esc(TRACK_LABEL[trackOf(d)])}</td><td>${esc(EXPERIENCE_LABEL[d.experience] || "")}</td>
          <td>${esc(STATUS_LABEL[statusOf(d.id)])}</td><td>${esc(cohortOf(d.id))}</td>
          <td>${esc(reviews[d.id]?.notes || "")}</td></tr>`).join("") +
      "</tbody></table>";
  }

  r.hidden = false;
  r.innerHTML = `
    <div class="r-head">
      <div><div class="r-eyebrow">DAF CGOC · Think Tank</div><h1>Program Report</h1></div>
      <div class="r-sub">Generated ${now.toLocaleDateString("en-US",
        { day: "numeric", month: "long", year: "numeric" })} · ${esc(me.email)}</div>
    </div>
    <div class="r-tiles">${tiles.innerHTML}</div>
    <h2>Program analytics</h2>
    <div class="r-charts">${charts.innerHTML}</div>
    ${demand.innerHTML}
    ${tableHtml}
    <div class="r-foot">Department of the Air Force Company Grade Officers' Council ·
      Think Tank dashboard · For official council use — contains member PII,
      handle accordingly.</div>`;
  window.print();
});

/* ---------------- utils ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function tsOf(ts) {
  if (!ts) return "";
  if (typeof ts === "string") return ts;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts.seconds) return new Date(ts.seconds * 1000).toISOString();
  return "";
}
function fmtDate(ts) {
  const iso = tsOf(ts);
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString("en-US",
    { day: "numeric", month: "short", year: "numeric" }) : "—";
}
function fmtDateTime(ts) {
  const iso = tsOf(ts);
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleString("en-US",
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
}
function monthName(m) {
  return new Date(m + "-15").toLocaleDateString("en-US", { month: "short" });
}
