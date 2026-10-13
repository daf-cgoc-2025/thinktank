/* ============================================================
   DAF CGOC Think Tank
   Standalone page interactivity. Vanilla, no dependencies.
   ============================================================ */
(function () {
  "use strict";

  var docEl = document.documentElement;
  docEl.classList.add("js");

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Analytics helper (no PII in any event) ---------- */
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  /* Section views, dwell time, scroll depth, and every button/link click are
     handled by the shared js/analytics.js. This file only sends events that
     are specific to the sign-up flow. */

  /* ---------- Config ----------
     Sign-ups write to Firestore (collection "thinktankIntake", Firebase
     project "dafcgoc") via window.thinktankFirebase, initialized in
     index.html. If Firestore is unreachable, the submit handler opens a
     pre-filled email to CONTACT_EMAIL as a fallback. */
  var CONFIG = {
    CONTACT_EMAIL: "thinktank@dafcgoc.org"
  };

  /* ---------- Scroll-linked: statement words and process steps ---------- */
  (function scrollLinked() {
    var words = document.querySelectorAll(".say span");
    var list = document.querySelector(".steps");
    var steps = list ? list.querySelectorAll(".step") : [];
    if (reduce) {
      words.forEach(function (w) { w.classList.add("is-on"); });
      return;
    }
    if (list) list.classList.add("is-live");
    var say = document.querySelector(".say");
    var queued = false;
    function paint() {
      queued = false;
      var vh = window.innerHeight;
      if (say) {
        var r = say.getBoundingClientRect();
        var p = (vh * 0.9 - r.top) / (r.height + vh * 0.3);
        var on = Math.round(Math.max(0, Math.min(1, p)) * words.length);
        words.forEach(function (w, i) { w.classList.toggle("is-on", i < on); });
      }
      if (list) {
        var line = vh * 0.62;
        var lr = list.getBoundingClientRect();
        list.style.setProperty("--p", Math.max(0, Math.min(1, (line - lr.top - 22) / (lr.height - 44))).toFixed(3));
        steps.forEach(function (s) {
          s.classList.toggle("is-active", s.getBoundingClientRect().top + 22 < line);
        });
      }
    }
    window.addEventListener("scroll", function () {
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    }, { passive: true });
    window.addEventListener("resize", paint);
    paint();
  })();

  /* ---------- Hero: grid lit by the pointer ---------- */
  (function heroLight() {
    var hero = document.querySelector(".hero");
    if (!hero || reduce || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var lit = hero.querySelector(".hero__lit");
    var stops = hero.querySelectorAll(".climb__stop");
    var x = 0, y = 0, queued = false;
    function paint() {
      queued = false;
      var r = hero.getBoundingClientRect();
      lit.style.setProperty("--mx", (x - r.left) + "px");
      lit.style.setProperty("--my", (y - r.top) + "px");
      var near = null, best = 140;
      stops.forEach(function (s) {
        var c = s.querySelector("circle").getBoundingClientRect();
        var d = Math.hypot(c.left + c.width / 2 - x, c.top + c.height / 2 - y);
        if (d < best) { best = d; near = s; }
      });
      stops.forEach(function (s) { s.classList.toggle("is-near", s === near); });
    }
    hero.addEventListener("pointermove", function (e) {
      x = e.clientX; y = e.clientY;
      hero.classList.add("is-lit");
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    });
    hero.addEventListener("pointerleave", function () {
      hero.classList.remove("is-lit");
      stops.forEach(function (s) { s.classList.remove("is-near"); });
    });
  })();

  /* ============================================================
     Sign-up form
     ============================================================ */
  var form = document.getElementById("intake-form");
  if (!form) return;

  var successPanel = document.getElementById("intake-success");
  var statusEl = document.getElementById("form-status");
  var summaryEl = document.getElementById("error-summary");
  var submitBtn = form.querySelector(".btn-submit");

  form.querySelectorAll('input[name="experience"]').forEach(function (r) {
    r.addEventListener("change", function () { clearGroupError("experience"); });
  });
  var commitEl = document.getElementById("commit");
  commitEl.addEventListener("change", function () {
    if (commitEl.checked) clearGroupError("commit");
  });

  /* ----- Validation helpers ----- */
  function labelFor(el) {
    var lab = el.id && form.querySelector('label[for="' + el.id + '"]');
    if (lab) return lab.textContent.replace(/\*/g, "").trim();
    var wrapLegend = el.closest("fieldset") && el.closest("fieldset").querySelector("legend");
    return wrapLegend ? wrapLegend.textContent.replace(/\*/g, "").trim() : el.name;
  }
  function friendly(el) {
    if (el.validity.valueMissing) return el.id === "rank" ? "Select your rank." : "This field is required.";
    if (el.validity.typeMismatch && el.type === "email") {
      return "Enter a valid email, e.g. name@us.af.mil";
    }
    return el.validationMessage || "Please check this field.";
  }
  function errorElFor(el) {
    var wrap = el.closest(".field");
    if (!wrap) return null;
    var e = wrap.querySelector(".field-error");
    if (!e) {
      e = document.createElement("p");
      e.className = "field-error";
      e.id = el.id + "-error";
      e.setAttribute("aria-live", "polite");
      wrap.appendChild(e);
    }
    return e;
  }
  function setFieldError(el, msg) {
    var e = errorElFor(el);
    if (!e) return;
    if (msg) {
      el.setAttribute("aria-invalid", "true");
      var d = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (d.indexOf(e.id) === -1) { d.push(e.id); el.setAttribute("aria-describedby", d.join(" ")); }
      e.textContent = msg;
    } else {
      el.removeAttribute("aria-invalid");
      e.textContent = "";
    }
  }
  function setGroupError(name, msg) {
    var e = document.getElementById(name + "-error");
    e.textContent = msg || "";
    var inputName = name === "commit" ? "commitment" : name;
    form.querySelectorAll('input[name="' + inputName + '"]').forEach(function (inp) {
      if (msg) {
        inp.setAttribute("aria-invalid", "true");
        var d = (inp.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
        if (d.indexOf(e.id) === -1) { d.push(e.id); inp.setAttribute("aria-describedby", d.join(" ")); }
      } else {
        inp.removeAttribute("aria-invalid");
      }
    });
  }
  function clearGroupError(name) { setGroupError(name, ""); }

  function validateField(el) {
    if (el.type === "radio" || el.type === "checkbox" || el.name === "botcheck") return true;
    var ok = el.checkValidity();
    setFieldError(el, ok ? "" : friendly(el));
    return ok;
  }

  /* ----- On-blur validation for text fields ----- */
  form.addEventListener("blur", function (e) {
    var t = e.target;
    if (t.matches && t.matches("input, textarea, select")) validateField(t);
  }, true);
  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches && t.matches("select")) validateField(t);
  });
  form.addEventListener("input", function (e) {
    var t = e.target;
    if (t.matches && t.matches('[aria-invalid="true"]')) validateField(t);
  });

  /* ----- Error summary ----- */
  function showSummary(errors) {
    summaryEl.textContent = "";
    var h = document.createElement("h3");
    h.textContent = "There is a problem";
    summaryEl.appendChild(h);
    var ul = document.createElement("ul");
    errors.forEach(function (x) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + x.focusId;
      a.textContent = x.label + ": " + x.msg;
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var target = document.getElementById(x.focusId);
        if (target) { target.focus(); target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); }
      });
      li.appendChild(a);
      ul.appendChild(li);
    });
    summaryEl.appendChild(ul);
    summaryEl.hidden = false;
    if (!/^Error: /.test(document.title)) document.title = "Error: " + document.title;
    summaryEl.focus();
  }
  function hideSummary() {
    summaryEl.hidden = true;
    summaryEl.textContent = "";
    document.title = document.title.replace(/^Error: /, "");
  }

  /* ----- Collect all errors ----- */
  function collectErrors() {
    var errors = [];
    function push(focusId, label, msg) { errors.push({ focusId: focusId, label: label, msg: msg }); }

    form.querySelectorAll("input, textarea, select").forEach(function (el) {
      if (el.type === "radio" || el.type === "checkbox" || el.name === "botcheck") return;
      if (!validateField(el)) push(el.id, labelFor(el), friendly(el));
    });

    if (!form.querySelector('input[name="experience"]:checked')) {
      setGroupError("experience", "Please choose your research experience.");
      push("exp-none", "Research experience", "Please choose one.");
    } else {
      clearGroupError("experience");
    }

    if (!commitEl.checked) {
      setGroupError("commit", "You must agree to the cohort commitment.");
      push("commit", "Commitment", "Please agree to continue.");
    } else {
      clearGroupError("commit");
    }

    return errors;
  }

  /* ----- Payload + submit seam ----- */
  function buildPayload() {
    var fd = new FormData(form);
    return {
      schemaVersion: 1,
      program: "DAF CGOC Think Tank",
      name: { rank: fd.get("rank"), first: fd.get("firstName").trim(), last: fd.get("lastName").trim() },
      email: fd.get("email").trim(),
      experience: fd.get("experience"),
      interest: fd.get("interest").trim(),
      commitment: fd.get("commitment") === "on"
    };
  }

  async function submitIntake(payload) {
    if (!window.thinktankFirebase) throw new Error("firebase unavailable");
    return Promise.race([
      window.thinktankFirebase.submit(payload),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("timeout")); }, 15000);
      })
    ]);
  }

  // Windows mail handlers drop mailto: URLs past roughly 2000 characters, so
  // the body is a short list and a long answer is cut.
  function mailtoHref(p) {
    var interest = p.interest.length > 600 ? p.interest.slice(0, 600) + " [cut, please finish in your own words]" : p.interest;
    var subject = "Think Tank sign-up: " + p.name.rank + " " + p.name.first + " " + p.name.last;
    var body = [
      "Rank: " + p.name.rank,
      "Name: " + p.name.first + " " + p.name.last,
      "Email: " + p.email,
      "Research experience: " + p.experience,
      "Why research: " + interest,
      "Commitment: agreed"
    ].join("\n");
    return "mailto:" + CONFIG.CONTACT_EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  /* ----- Submit handler ----- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();

    // honeypot: silently accept bots without recording
    var hp = form.querySelector('input[name="botcheck"]');
    if (hp && hp.value) { showSuccess(); return; }

    var errors = collectErrors();
    if (errors.length) { showSummary(errors); return; }
    hideSummary();

    var payload = buildPayload();
    submitBtn.disabled = true;
    submitBtn.classList.add("is-loading");
    statusEl.textContent = "Sending your sign-up…";

    submitIntake(payload).then(function () {
      track("sign_up", { method: "thinktank" });
      showSuccess();
    }).catch(function (err) {
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-loading");
      // The client validates everything before sending, so a rules rejection
      // here almost always means this email already signed up (duplicate doc
      // id). The rules cannot tell the client which, so the message hedges.
      if (err && err.code === "permission-denied") {
        track("intake_duplicate", { method: "thinktank" });
        statusEl.textContent = "This email looks like it is already signed up. If you don't hear from the committee, write to " +
          CONFIG.CONTACT_EMAIL + ".";
        return;
      }
      track("intake_fallback", { method: "thinktank" });
      var href = mailtoHref(payload);
      statusEl.textContent = "We couldn't reach the server, so your sign-up was not saved. ";
      var a = document.createElement("a");
      a.href = href;
      a.textContent = "Email it to " + CONFIG.CONTACT_EMAIL;
      statusEl.appendChild(a);
      statusEl.appendChild(document.createTextNode(" instead."));
      window.location.href = href;
    });
  });

  /* ----- Success / reset ----- */
  function showSuccess() {
    form.hidden = true;
    successPanel.hidden = false;
    var heading = successPanel.querySelector("h3");
    if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus(); }
    var check = successPanel.querySelector(".success-check");
    if (check) { check.classList.remove("play"); void check.offsetWidth; check.classList.add("play"); }
    successPanel.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }

  document.getElementById("intake-again").addEventListener("click", function () {
    form.reset();
    hideSummary();
    form.querySelectorAll('[aria-invalid="true"]').forEach(function (el) { el.removeAttribute("aria-invalid"); });
    form.querySelectorAll(".field-error").forEach(function (el) { el.textContent = ""; });
    statusEl.textContent = "";
    submitBtn.disabled = false;
    submitBtn.classList.remove("is-loading");
    successPanel.hidden = true;
    form.hidden = false;
    document.getElementById("rank").focus();
  });
})();
