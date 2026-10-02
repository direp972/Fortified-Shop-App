// Address autocomplete for the site's address fields, on Google Places API (New).
//
//   rcPlaces.attach(input, {kind, onPick})
//     kind    "address" — a street address or a business (Get Listed locations, the
//                         admin editor, the app's job site)
//             "region"  — a city, ZIP or state (the directory's "City or area" box,
//                         the City, State fields)
//     onPick  called with {formatted, name, street, city, state, zip, cityState, lat, lng}
//             after the input's value has been set, so the caller only stores the rest.
//
// The field stays an ordinary <input>: the person can still type anything and submit
// without picking, and every page keeps its old geocoder as the fallback. Suggestions
// come from AutocompleteSuggestion with a session token, so one lookup is billed per
// address picked, not per keystroke. The Maps script loads on the first focus, and
// only when site-config.js carries a key; without one attach() is a no-op.
//
// Google's terms ask for its logo under suggestions shown without a map, so the list
// carries a "powered by Google" footer.
(function () {
  const key = (window.RC_CONFIG && window.RC_CONFIG.googleMapsKey) || "";
  const api = { enabled: !!key, attach: () => false };
  window.rcPlaces = api;
  if (!key) return;

  let mapsReady = null;
  function loadMaps() {
    if (mapsReady) return mapsReady;
    mapsReady = new Promise((resolve, reject) => {
      window.__rcMapsReady = () => resolve();
      const s = document.createElement("script");
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&v=weekly&loading=async&callback=__rcMapsReady";
      s.async = true;
      s.onerror = () => reject(new Error("maps script failed"));
      document.head.appendChild(s);
    }).then(() => google.maps.importLibrary("places"));
    return mapsReady;
  }

  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const css = document.createElement("style");
    css.textContent = `
.rc-ac{position:fixed;z-index:2147483000;background:#fff;color:#0F3D5C;border:1px solid rgba(15,61,92,.18);border-radius:10px;box-shadow:0 2px 4px rgba(10,43,65,.08),0 14px 40px rgba(10,43,65,.16);font-family:Inter,system-ui,sans-serif;font-size:14px;max-height:320px;overflow-y:auto;text-align:left}
.rc-ac-item{padding:9px 12px;cursor:pointer;line-height:1.3}
.rc-ac-item.on{background:#F6F4EE}
.rc-ac-item small{display:block;color:#8A94A6;font-size:12px}
.rc-ac-foot{display:flex;justify-content:flex-end;align-items:center;gap:6px;padding:5px 10px;border-top:1px solid rgba(15,61,92,.1);font-size:10px;color:#8A94A6;letter-spacing:.04em}
.rc-ac-foot img{height:14px;display:block}`;
    document.head.appendChild(css);
  }

  const part = (comps, type, short) => {
    const c = (comps || []).find((x) => (x.types || []).includes(type));
    return c ? (short ? c.shortText : c.longText) || "" : "";
  };
  function describe(place) {
    const comps = place.addressComponents || [];
    const number = part(comps, "street_number"), route = part(comps, "route");
    const street = [number, route].filter(Boolean).join(" ");
    const city = part(comps, "locality") || part(comps, "sublocality_level_1") || part(comps, "postal_town") || part(comps, "administrative_area_level_3");
    const state = part(comps, "administrative_area_level_1", true);
    const zip = part(comps, "postal_code");
    const formatted = String(place.formattedAddress || "").replace(/,\s*(USA|United States)$/i, "");
    return {
      formatted, name: place.displayName || "", street, city, state, zip,
      cityState: [city, state].filter(Boolean).join(", "),
      lat: place.location ? +place.location.lat().toFixed(5) : null,
      lng: place.location ? +place.location.lng().toFixed(5) : null,
    };
  }

  api.attach = function (input, opts) {
    if (!input || input.dataset.rcPlaces) return false;
    input.dataset.rcPlaces = "1";
    opts = opts || {};
    const kind = opts.kind || "address";
    style();
    input.setAttribute("autocomplete", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");

    let box = null, items = [], active = -1, timer = null, token = null, seq = 0;
    const close = () => { if (box) { box.remove(); box = null; } items = []; active = -1; input.setAttribute("aria-expanded", "false"); };
    const place = () => {
      if (!box) return;
      const r = input.getBoundingClientRect();
      box.style.left = r.left + "px"; box.style.top = (r.bottom + 4) + "px"; box.style.width = Math.max(r.width, 260) + "px";
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);

    function render() {
      if (!items.length) { close(); return; }
      if (!box) { box = document.createElement("div"); box.className = "rc-ac"; box.setAttribute("role", "listbox"); document.body.appendChild(box); input.setAttribute("aria-expanded", "true"); }
      box.textContent = "";
      items.forEach((s, i) => {
        const p = s.placePrediction;
        const el = document.createElement("div"); el.className = "rc-ac-item" + (i === active ? " on" : ""); el.setAttribute("role", "option");
        const main = document.createElement("span"); main.textContent = (p.mainText && p.mainText.text) || p.text.text || "";
        el.appendChild(main);
        const sec = p.secondaryText && p.secondaryText.text;
        if (sec) { const sm = document.createElement("small"); sm.textContent = sec; el.appendChild(sm); }
        el.addEventListener("pointerdown", (e) => { e.preventDefault(); pick(i); });
        el.addEventListener("mousemove", () => { if (active !== i) { active = i; [...box.children].forEach((c, j) => c.classList.toggle("on", j === i)); } });
        box.appendChild(el);
      });
      const foot = document.createElement("div"); foot.className = "rc-ac-foot";
      foot.append("powered by ");
      const img = document.createElement("img"); img.alt = "Google"; img.src = "https://developers.google.com/static/maps/documentation/images/google_on_white.png";
      foot.appendChild(img); box.appendChild(foot);
      place();
    }

    async function suggest() {
      const q = input.value.trim();
      if (q.length < 3) { close(); return; }
      const my = ++seq;
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await loadMaps();
        if (my !== seq) return;
        token = token || new AutocompleteSessionToken();
        const req = { input: q, sessionToken: token, includedRegionCodes: ["us"], language: "en-US", region: "us" };
        if (kind === "region") req.includedPrimaryTypes = ["(regions)"];
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
        if (my !== seq || document.activeElement !== input) return;
        items = (suggestions || []).filter((s) => s.placePrediction).slice(0, 6);
        active = -1;
        render();
      } catch (e) { console.warn("places", e && e.message); close(); }
    }

    async function pick(i) {
      const s = items[i]; if (!s) return;
      close();
      try {
        const p = s.placePrediction.toPlace();
        await p.fetchFields({ fields: ["location", "formattedAddress", "addressComponents", "displayName"] });
        token = null; // the session ends with a pick
        const d = describe(p);
        input.value = kind === "region" ? (d.cityState && !d.zip ? d.cityState : d.formatted) : (d.street || d.formatted);
        if (opts.onPick) opts.onPick(d);
      } catch (e) { console.warn("places pick", e && e.message); }
    }

    input.addEventListener("focus", () => { loadMaps().catch(() => {}); });
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(suggest, 220); });
    input.addEventListener("keydown", (e) => {
      if (!box) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
      else if (e.key === "Enter") { if (active >= 0) { e.preventDefault(); pick(active); } }
      else if (e.key === "Escape") { close(); }
    });
    input.addEventListener("blur", () => { setTimeout(close, 150); });
    return true;
  };
})();
