/* RoofCoil global sign-in.
   One Supabase session shared by every site page AND the Panel & Trim app served at
   /app — the session is stored under supabase-js's own localStorage key, so the app
   picks it up natively and vice versa. Include with <script src="/auth.js" defer>. */
(function () {
  const SUPA = "https://znueitseoqijhkkvdomc.supabase.co";
  const KEY = "sb_publishable_R7JBgFijjjXcYJaggpx-og_Qn4iGdAB";
  const STORE = "sb-znueitseoqijhkkvdomc-auth-token"; // supabase-js v2 default key for this project

  /* ---------- session plumbing ---------- */
  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; }
  }
  function writeSession(s) {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  }
  function sessionFromTokenResponse(j) {
    return {
      access_token: j.access_token,
      token_type: j.token_type || "bearer",
      expires_in: j.expires_in,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      refresh_token: j.refresh_token,
      user: j.user,
    };
  }
  async function refreshIfNeeded() {
    const s = readSession();
    if (!s) return null;
    const now = Math.floor(Date.now() / 1000);
    if (s.expires_at && s.expires_at - now > 60) return s;
    if (!s.refresh_token) { writeSession(null); return null; }
    try {
      const r = await fetch(SUPA + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: KEY },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!r.ok) { writeSession(null); return null; }
      const j = await r.json();
      const ns = sessionFromTokenResponse(j);
      writeSession(ns);
      return ns;
    } catch (e) { return s; } // offline: keep whatever we had
  }

  async function signIn(email, password) {
    const r = await fetch(SUPA + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: KEY },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (!r.ok) return { error: j.error_description || j.msg || "Sign in failed — check your email and password." };
    writeSession(sessionFromTokenResponse(j));
    return { session: readSession() };
  }

  async function signUp(name, company, phone, email, password) {
    const r = await fetch(SUPA + "/auth/v1/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: KEY },
      body: JSON.stringify({ email, password, data: { name, company, phone } }),
    });
    const j = await r.json();
    if (!r.ok) return { error: j.error_description || j.msg || "Sign up failed — try a different email." };
    // Keep the shop's lead list flowing (fire-and-forget).
    try {
      fetch(SUPA + "/rest/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: KEY, Prefer: "return=minimal" },
        body: JSON.stringify({ name, company, phone, email, source: "signup" }),
      }).catch(function () {});
    } catch (e) {}
    if (j.access_token) { writeSession(sessionFromTokenResponse(j)); return { session: readSession() }; }
    return { confirm: true }; // email confirmation required before first sign-in
  }

  async function signOut() {
    const s = readSession();
    writeSession(null);
    if (s) {
      try {
        await fetch(SUPA + "/auth/v1/logout", {
          method: "POST",
          headers: { apikey: KEY, Authorization: "Bearer " + s.access_token },
        });
      } catch (e) {}
    }
    location.reload();
  }

  /* ---------- per-account memory ---------- */
  const rcState = {
    cache: null,
    async load() {
      const s = await refreshIfNeeded();
      if (!s) return {};
      try {
        const r = await fetch(SUPA + "/rest/v1/member_state?select=state&user_id=eq." + s.user.id, {
          headers: { apikey: KEY, Authorization: "Bearer " + s.access_token },
        });
        const rows = await r.json();
        this.cache = (rows && rows[0] && rows[0].state) || {};
      } catch (e) { this.cache = {}; }
      return this.cache;
    },
    async merge(patch) {
      const s = await refreshIfNeeded();
      if (!s) return;
      this.cache = Object.assign({}, this.cache || {}, patch, { lastPage: location.pathname, lastSeen: new Date().toISOString() });
      try {
        await fetch(SUPA + "/rest/v1/member_state", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", apikey: KEY,
            Authorization: "Bearer " + s.access_token,
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify({ user_id: s.user.id, state: this.cache, updated_at: new Date().toISOString() }),
        });
      } catch (e) {}
    },
  };

  /* ---------- UI: header chip + modal ---------- */
  const css = document.createElement("style");
  css.textContent = `
  .rc-chip{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono,monospace);font-size:10.5px;letter-spacing:.06em;color:#EAF1F6;background:rgba(212,175,55,.14);border:1px solid rgba(212,175,55,.5);border-radius:999px;padding:7px 8px 7px 13px;max-width:230px}
  .rc-chip .rc-who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:none}
  .rc-chip button{font-family:inherit;font-size:9px;letter-spacing:.1em;text-transform:uppercase;border:none;border-radius:999px;background:rgba(255,255,255,.14);color:#EAF1F6;padding:4px 9px;cursor:pointer}
  .rc-chip button:hover{background:rgba(255,255,255,.25)}
  .rc-chip a.rc-admin{font-family:inherit;font-size:9px;letter-spacing:.1em;text-transform:uppercase;border-radius:999px;background:#D4AF37;color:#0B1E2C;padding:4px 9px;text-decoration:none;font-weight:700}
  .rc-chip a.rc-admin:hover{background:#EFC94C}
  #rc-auth{position:fixed;inset:0;z-index:300;background:linear-gradient(180deg,rgba(11,30,44,.92),rgba(15,61,92,.92));display:none;align-items:center;justify-content:center;padding:20px}
  #rc-auth.on{display:flex}
  #rc-auth .card{background:#fff;border-radius:16px;max-width:430px;width:100%;padding:30px 28px;box-shadow:0 30px 80px rgba(0,0,0,.5);color:#0A2B41;font-family:var(--body,'Inter',sans-serif)}
  #rc-auth h2{font-family:var(--disp,'Oswald',sans-serif);font-size:24px;margin:0 0 6px;font-weight:700;text-transform:uppercase}
  #rc-auth .sub{font-size:13.5px;color:#4E6273;margin:0 0 18px;line-height:1.55}
  #rc-auth label{display:block;font-family:var(--mono,monospace);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:#8A94A6;margin:0 0 4px}
  #rc-auth input{width:100%;box-sizing:border-box;font-size:14px;padding:11px 13px;border:1px solid rgba(15,61,92,.16);border-radius:10px;background:#F6F4EE;color:#0A2B41;margin-bottom:12px;font-family:inherit}
  #rc-auth input:focus{border-color:#D4AF37;box-shadow:0 0 0 3px rgba(212,175,55,.18);outline:none}
  #rc-auth .err{color:#B3261E;background:#FDECEA;border-radius:8px;padding:9px 13px;font-size:12.5px;display:none;margin-bottom:12px}
  #rc-auth .swap{text-align:center;margin-top:14px;font-size:12.5px;color:#4E6273}
  #rc-auth .swap button{border:none;background:none;color:#A0602E;font-weight:700;cursor:pointer;font-size:12.5px;padding:0}
  #rc-auth .rc-close{position:absolute;top:14px;right:16px;border:none;background:none;color:#8A94A6;font-size:20px;cursor:pointer;display:none}
  #rc-auth .card{position:relative}
  #rc-auth.dismissable .rc-close{display:block}
  #rc-auth .rc-g{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit;font-size:14px;font-weight:600;color:#3c4043;background:#fff;border:1px solid #dadce0;border-radius:10px;padding:11px 13px;cursor:pointer;margin-bottom:14px}
  #rc-auth .rc-g:hover{background:#F6F4EE}
  #rc-auth .rc-g svg{flex:none}
  #rc-auth .rc-or{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-family:var(--mono,monospace);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:#8A94A6}
  #rc-auth .rc-or span{flex:1;height:1px;background:#E7E2D6}
  #rc-auth .rc-skip{width:100%;margin-top:8px;border:none;background:none;color:#8A94A6;font-size:12.5px;cursor:pointer;font-family:inherit}`;
  document.head.appendChild(css);

  const modal = document.createElement("div");
  modal.id = "rc-auth";
  modal.innerHTML = `
  <div class="card">
    <button class="rc-close" aria-label="Close">✕</button>
    <p style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8A94A6;margin:0 0 10px">RoofCoil · One account, every tool</p>
    <h2 id="rc-title">Sign in</h2>
    <p class="sub" id="rc-sub">One sign-in for the whole site — colors, the finder, the Panel &amp; Trim apps, and your order history.</p>
    <div id="rc-social">
      <button type="button" class="rc-g" id="rc-google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Continue with Google</button>
      <div class="rc-or"><span></span>or use email<span></span></div>
    </div>
    <div id="rc-name-co" style="display:none">
      <label>Name</label><input id="rc-name" autocomplete="name" placeholder="Your name">
      <label>Company</label><input id="rc-co" autocomplete="organization" placeholder="Company">
      <label>Phone</label><input id="rc-ph" type="tel" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555">
    </div>
    <label>Email</label><input id="rc-em" type="email" autocomplete="email" placeholder="you@company.com">
    <label>Password</label><input id="rc-pw" type="password" autocomplete="current-password" placeholder="••••••••">
    <div class="err" id="rc-err"></div>
    <button class="btn" style="width:100%" id="rc-go">Sign in</button>
    <div class="swap" id="rc-swap">New here? <button type="button" data-mode="up">Create a free account</button></div>
  </div>`;

  let mode = "in";
  function setMode(m) {
    mode = m;
    modal.querySelector("#rc-title").textContent = m === "in" ? "Sign in" : "Create your free account";
    modal.querySelector("#rc-name-co").style.display = m === "in" ? "none" : "block";
    modal.querySelector("#rc-go").textContent = m === "in" ? "Sign in" : "Create account";
    modal.querySelector("#rc-swap").innerHTML = m === "in"
      ? 'New here? <button type="button" data-mode="up">Create a free account</button>'
      : 'Already have an account? <button type="button" data-mode="in">Sign in</button>';
    modal.querySelector("#rc-pw").autocomplete = m === "in" ? "current-password" : "new-password";
    hideErr();
  }
  function showErr(m) { const e = modal.querySelector("#rc-err"); e.textContent = m; e.style.display = "block"; }
  function hideErr() { modal.querySelector("#rc-err").style.display = "none"; }

  function openModal(opts) {
    opts = opts || {};
    modal.classList.add("on");
    modal.classList.toggle("dismissable", !opts.blocking);
    setMode(opts.mode || "in");
    // Old preview-build members get their details carried over.
    try {
      const old = JSON.parse(localStorage.getItem("rc-member") || "null");
      if (old) {
        modal.querySelector("#rc-name").value = old.name || "";
        modal.querySelector("#rc-co").value = old.co || "";
        modal.querySelector("#rc-em").value = modal.querySelector("#rc-em").value || old.email || "";
      }
    } catch (e) {}
  }
  function closeModal() { modal.classList.remove("on"); }

  modal.addEventListener("click", function (e) {
    const swap = e.target.closest("[data-mode]");
    if (swap) { setMode(swap.dataset.mode); return; }
    if (e.target.classList.contains("rc-close")) closeModal();
  });
  modal.querySelector("#rc-go").onclick = async function () {
    hideErr();
    const em = modal.querySelector("#rc-em").value.trim();
    const pw = modal.querySelector("#rc-pw").value;
    if (!/.+@.+\..+/.test(em)) { showErr("Enter a valid email."); return; }
    if (pw.length < 6) { showErr("Password needs at least 6 characters."); return; }
    const btn = this; btn.disabled = true; btn.textContent = "One moment…";
    let res;
    if (mode === "in") res = await signIn(em, pw);
    else {
      const name = modal.querySelector("#rc-name").value.trim();
      const ph = modal.querySelector("#rc-ph").value.trim();
      if (!name) { btn.disabled = false; setMode("up"); showErr("Name is required."); return; }
      if (ph.replace(/\D/g, "").length < 10) { btn.disabled = false; setMode("up"); showErr("A phone number is required so the shop can reach you about orders."); return; }
      res = await signUp(name, modal.querySelector("#rc-co").value.trim(), ph, em, pw);
    }
    btn.disabled = false; setMode(mode);
    if (res.error) { showErr(res.error); return; }
    if (res.confirm) {
      modal.querySelector("#rc-title").textContent = "Check your email";
      modal.querySelector("#rc-sub").textContent = "We sent a confirmation link to " + em + ". Click it, then come back and sign in.";
      setModeAfterConfirm();
      return;
    }
    localStorage.removeItem("rc-member");
    location.reload();
  };
  function setModeAfterConfirm() {
    modal.querySelector("#rc-name-co").style.display = "none";
    modal.querySelector("#rc-go").textContent = "Sign in";
    mode = "in";
  }

  /* ---------- Google sign-in ---------- */
  // Supabase runs the OAuth dance and sends the browser back to this exact page with
  // the session in the URL hash; consumeHashSession() below turns that into the same
  // stored session the email flow writes, so every page and the /app pick it up.
  modal.querySelector("#rc-google").onclick = function () {
    hideErr();
    const back = location.origin + location.pathname + location.search;
    location.href = SUPA + "/auth/v1/authorize?provider=google&redirect_to=" + encodeURIComponent(back) + "&prompt=select_account";
  };

  function cleanHash() {
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  // Handles the return leg of Google sign-in AND the landing from a confirmation /
  // magic-link email (both arrive as #access_token=…). Returns null when there is
  // nothing in the hash for us.
  async function consumeHashSession() {
    const h = location.hash || "";
    if (h.indexOf("access_token=") === -1 && h.indexOf("error=") === -1) return null;
    const p = new URLSearchParams(h.replace(/^#/, ""));
    if (p.get("error")) { cleanHash(); return { error: p.get("error_description") || p.get("error") }; }
    const at = p.get("access_token");
    if (!at) return null;
    try {
      const r = await fetch(SUPA + "/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + at } });
      if (!r.ok) { cleanHash(); return null; }
      const user = await r.json();
      const ttl = parseInt(p.get("expires_in"), 10) || 3600;
      const s = {
        access_token: at,
        token_type: p.get("token_type") || "bearer",
        expires_in: ttl,
        expires_at: parseInt(p.get("expires_at"), 10) || Math.floor(Date.now() / 1000) + ttl,
        refresh_token: p.get("refresh_token"),
        user: user,
      };
      writeSession(s);
      localStorage.removeItem("rc-member");
      cleanHash();
      // A brand-new Google account should reach the shop's lead list just like an
      // email signup does (fire-and-forget).
      const brandNew = user.created_at && (Date.now() - new Date(user.created_at).getTime()) < 10 * 60 * 1000;
      const viaGoogle = !!(user.app_metadata && user.app_metadata.provider === "google");
      if (brandNew && viaGoogle) {
        const m = user.user_metadata || {};
        try {
          fetch(SUPA + "/rest/v1/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: KEY, Prefer: "return=minimal" },
            body: JSON.stringify({ name: m.full_name || m.name || "", company: "", phone: "", email: user.email, source: "google" }),
          }).catch(function () {});
        } catch (e) {}
      }
      return { session: s, fresh: true };
    } catch (e) { cleanHash(); return null; }
  }

  // Google doesn't give us a phone number, and the shop needs one to reach people
  // about orders — ask once after the first Google sign-in (skippable).
  function askForPhone(session) {
    const card = modal.querySelector(".card");
    modal.classList.add("on");
    modal.classList.remove("dismissable");
    card.innerHTML =
      '<p style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8A94A6;margin:0 0 10px">RoofCoil · One last thing</p>' +
      '<h2>Welcome' + (session.user.user_metadata && session.user.user_metadata.name ? ", " + session.user.user_metadata.name.split(" ")[0] : "") + '</h2>' +
      '<p class="sub">Add a phone number so the shop can reach you about orders.</p>' +
      '<label>Phone</label><input id="rc-ph2" type="tel" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555">' +
      '<div class="err" id="rc-err2"></div>' +
      '<button class="btn" style="width:100%" id="rc-ph-save">Save</button>' +
      '<button type="button" class="rc-skip" id="rc-ph-skip">Skip for now</button>';
    card.querySelector("#rc-ph-skip").onclick = function () { location.reload(); };
    card.querySelector("#rc-ph-save").onclick = async function () {
      const ph = card.querySelector("#rc-ph2").value.trim();
      const err = card.querySelector("#rc-err2");
      if (ph.replace(/\D/g, "").length < 10) { err.textContent = "Enter a 10-digit phone number."; err.style.display = "block"; return; }
      this.disabled = true; this.textContent = "Saving…";
      try {
        const r = await fetch(SUPA + "/auth/v1/user", {
          method: "PUT",
          headers: { "Content-Type": "application/json", apikey: KEY, Authorization: "Bearer " + session.access_token },
          body: JSON.stringify({ data: { phone: ph } }),
        });
        if (r.ok) { const u = await r.json(); session.user = u; writeSession(session); }
      } catch (e) {}
      location.reload();
    };
  }

  /* ---------- wire the page ---------- */
  async function boot() {
    document.body.appendChild(modal);
    const fromHash = await consumeHashSession();
    const session = await refreshIfNeeded();
    const slot = document.querySelector("[data-auth-slot]");
    if (fromHash && fromHash.fresh && session && !(session.user.user_metadata && session.user.user_metadata.phone)) {
      askForPhone(session);
    }
    if (session) {
      const who = (session.user.user_metadata && session.user.user_metadata.name) || session.user.email;
      if (slot) {
        slot.innerHTML = '<span class="rc-chip" title="' + session.user.email + '"><span class="rc-who">👤 ' + who + '</span><a class="rc-admin" id="rc-admin" href="/directory-admin.html" style="display:none">Admin</a><button id="rc-out">Sign out</button></span>';
        slot.querySelector("#rc-out").onclick = signOut;
        // Staff-only shortcut to the directory admin. RLS on the staff table means
        // non-staff accounts get an empty result, so the link never renders for them.
        fetch(SUPA + "/rest/v1/staff?select=id&id=eq." + session.user.id, {
          headers: { apikey: KEY, Authorization: "Bearer " + session.access_token },
        }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
          if (rows && rows.length) { var a = slot.querySelector("#rc-admin"); if (a) a.style.display = ""; }
        }).catch(function () {});
      }
      document.querySelectorAll("[data-auth-open]").forEach(function (el) { el.style.display = "none"; });
      document.documentElement.setAttribute("data-signed-in", "1");
      rcState.load().then(function (st) {
        document.dispatchEvent(new CustomEvent("rc:state", { detail: st }));
      });
    } else {
      if (slot) {
        slot.innerHTML = '<a class="btn" style="cursor:pointer" id="rc-in-btn">Sign in / Sign up</a>';
        slot.querySelector("#rc-in-btn").onclick = function () { openModal({}); };
      }
      document.querySelectorAll("[data-auth-open]").forEach(function (el) {
        el.addEventListener("click", function (e) { e.preventDefault(); openModal({ mode: el.dataset.authOpen || "up" }); });
      });
      if (document.body.hasAttribute("data-auth-required")) openModal({ blocking: true });
      if (fromHash && fromHash.error) { openModal({}); showErr(fromHash.error); }
    }
    document.dispatchEvent(new CustomEvent("rc:auth", { detail: { session: session } }));
  }
  window.rcAuth = { openModal: openModal, signOut: signOut, getSession: refreshIfNeeded };
  window.rcState = rcState;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
