import React, { useState, useEffect } from "react";
import { useAuth, AUTH_ERROR_PARAMS } from "./lib/AuthProvider";

const INK = "#1C1C1E";
const SAFETY = "#D4AF37";
// Served on fortifiedmetals.com via that site's /app proxy — brand accordingly.
const ON_FORTIFIED = typeof window !== "undefined" && window.location.hostname.includes("fortifiedmetals");

// Google's "G" mark, per their sign-in branding guidelines (white button, dark text).
const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

// Facebook's "f" mark, white on Facebook blue per their login button guidelines.
const FacebookF = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#fff" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
  </svg>
);

const PROVIDER_NAME = { google: "Google", facebook: "Facebook" };

// A failed sign-in comes back with error, error_code and error_description; this says it in
// words. `provider` is set when it was a Google or Facebook attempt started from this tab.
function returnErrorMessage(provider, err, code, desc) {
  const who = PROVIDER_NAME[provider];
  if (/user email from external provider/i.test(desc)) return `${who || "That account"} didn't share an email address, and an account needs one. Try again and allow access to your email, or use your email below.`;
  if (/multiple accounts/i.test(desc)) return "More than one account uses that email address. Call 972-944-7963 and we'll sort it out.";
  if (code === "bad_oauth_state" || /oauth state/i.test(desc)) return "That sign-in took too long or was finished in another tab. Please try again.";
  if (who && err === "access_denied") return `Sign-in with ${who} was cancelled, so nothing changed. Try again, or use your email below.`;
  return desc || err || "Sign-in didn't go through — please try again.";
}

export default function AuthGate({ children }) {
  const { user, customer, loading, signUp, signIn, signInWithProvider, getSocialProviders, takeSocialPending, saveContactDetails, resendConfirmation, requestPasswordReset } = useAuth();
  // Signed out, the tools still open — in demo mode, with pricing and ordering
  // locked (see isDemo in App.jsx). This card comes up over the top when a demo
  // visitor asks for something that needs an account, so whatever they have drawn
  // stays mounted underneath and is still there if they dismiss it.
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "reset"
  const [doneKind, setDoneKind] = useState("signup"); // which email the "check your email" screen is about
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState("");
  // A sign-in that hit "not confirmed": the exact email and password it used, so the
  // "Send a new link" button asks for that account even if the fields change afterwards.
  const [pending, setPending] = useState(null);
  const needsResend = !!pending;
  const setNeedsResend = (on) => setPending(on ? { email, password } : null);
  const [submitting, setSubmitting] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [providers, setProviders] = useState(null); // { google, facebook }: which buttons to show
  const [details, setDetails] = useState(null); // provider name while the "one last thing" card is up

  useEffect(() => {
    if (authOpen && !providers) getSocialProviders().then(setProviders);
  }, [authOpen, providers, getSocialProviders]);

  useEffect(() => {
    const open = (e) => { setMode(e?.detail === "signup" ? "signup" : "signin"); setAuthOpen(true); };
    window.addEventListener("rc:open-auth", open);
    return () => window.removeEventListener("rc:open-auth", open);
  }, []);

  // A finished sign-in closes the card and drops the visitor back where they were.
  useEffect(() => { if (user) setAuthOpen(false); }, [user]);

  // A link that ends in #signup or #signin (a shop's invite email, confirm.html's "Go to
  // sign in") opens the card on that side once the session is known, then clears the hash
  // so a reload does not reopen it. Already signed in, the hash is only cleared.
  useEffect(() => {
    if (loading) return;
    const h = (window.location.hash || "").toLowerCase();
    if (h !== "#signup" && h !== "#signin") return;
    try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* ignore */ }
    if (user) return;
    setMode(h === "#signup" ? "signup" : "signin");
    setAuthOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // A sign-in that failed on the way back: from Google or Facebook, Supabase puts the error in
  // the query string (?error=…&error_code=…&error_description=…); from an expired email link,
  // in the hash. Say it once, in words, and clean the address bar, keeping the rest of the
  // query (a shop's ?shop= link). Facebook can also leave a bare "#_=_" behind.
  useEffect(() => {
    const url = new URL(window.location.href);
    const h = new URLSearchParams((url.hash || "").replace(/^#/, ""));
    const get = (k) => url.searchParams.get(k) || h.get(k) || "";
    const err = get("error"), code = get("error_code"), desc = get("error_description");
    if (!err && !code && !desc) {
      if (url.hash === "#_=_") {
        try { window.history.replaceState(null, "", url.pathname + url.search); } catch (e) { /* ignore */ }
      }
      return;
    }
    setError(returnErrorMessage(takeSocialPending(), err, code, desc));
    setMode("signin");
    setAuthOpen(true);
    AUTH_ERROR_PARAMS.forEach((k) => url.searchParams.delete(k));
    try { window.history.replaceState(null, "", url.pathname + url.search); } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed in on the way back from Google or Facebook: the first time through, an account
  // with no phone or ZIP yet is asked for them (skippable), as the site's sign-in does. An
  // email account that signs in with Google or Facebook under the same address is the same
  // account (Supabase links them by email), so it already has both and goes straight in.
  useEffect(() => {
    if (loading || !user) return;
    const provider = takeSocialPending();
    if (!provider) return;
    const m = user.user_metadata || {};
    const knownPhone = String(customer?.phone || m.phone || "");
    const knownZip = String(customer?.zip || m.zip || "");
    if (knownPhone.replace(/\D/g, "").length >= 10 && /^\d{5}$/.test(knownZip)) return;
    setPhone(knownPhone);
    setZip(knownZip);
    setError("");
    setDetails(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  // Back from the provider's page with the browser's Back button, the page can come out of the
  // back-forward cache as it was left, mid-"Please wait…": make it usable again.
  useEffect(() => {
    const onShow = (e) => { if (e.persisted) { setSubmitting(false); takeSocialPending(); } };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [takeSocialPending]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontFamily: "system-ui" }}>
        Loading…
      </div>
    );
  }

  // The card floats over the tools rather than replacing them: a drawing or a 3D part in
  // progress, and the order's place in the browser history, are still there afterwards.
  const overlay = { position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, boxSizing: "border-box", background: "linear-gradient(180deg, rgba(11,30,44,0.97), rgba(15,61,92,0.97))", fontFamily: "'Inter', system-ui, sans-serif" };

  if (user) {
    if (!details) return children;
    const saveDetails = async (e) => {
      e.preventDefault();
      setError("");
      if (phone.replace(/\D/g, "").length < 10) { setError("Enter a 10-digit phone number."); return; }
      if (!/^\d{5}$/.test(zip.trim())) { setError("Enter your 5-digit ZIP code."); return; }
      setSubmitting(true);
      const { error } = await saveContactDetails(phone.trim(), zip.trim());
      setSubmitting(false);
      if (error) { setError(error.message); return; }
      setDetails(null);
    };
    const first = String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim().split(/\s+/)[0];
    return (<>{children}
      <div role="dialog" aria-modal="true" aria-label="One last thing" style={overlay}>
        <form onSubmit={saveDetails} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize: 11, color: "#98A2AC", textTransform: "uppercase", letterSpacing: ".14em", textAlign: "center", marginBottom: 6 }}>One last thing</div>
          <div style={{ fontFamily: "'Oswald', sans-serif", textTransform: "uppercase", letterSpacing: "0.03em", fontSize: 22, fontWeight: 700, marginBottom: 4, color: "#0A2B41", textAlign: "center" }}>Welcome{first ? `, ${first}` : ""}</div>
          <div style={{ fontSize: 12.5, color: "#777", marginBottom: 22, textAlign: "center", lineHeight: 1.5 }}>
            You're signed in with {PROVIDER_NAME[details]}. Add a phone number so the shop can reach you about orders, and your ZIP code for pricing from the shop nearest you.
          </div>
          <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 12 }}>
            Phone
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" inputMode="tel" placeholder="(555) 555-5555"
              style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
          </label>
          <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 16 }}>
            ZIP code
            <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} required autoComplete="postal-code" inputMode="numeric" placeholder="75001"
              style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
          </label>
          {error && (
            <div role="alert" style={{ fontSize: 12.5, color: "#B3261E", marginBottom: 14, background: "#FDECEA", padding: 8, borderRadius: 6 }}>{error}</div>
          )}
          <button type="submit" disabled={submitting}
            style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: SAFETY, color: "#fff", fontWeight: 700, fontSize: 14, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => { setDetails(null); setError(""); }}
            style={{ width: "100%", marginTop: 8, padding: "10px", borderRadius: 8, border: "none", background: "transparent", color: "#777", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
            Skip for now
          </button>
        </form>
      </div>
    </>);
  }
  // Demo: the tools are open, the card is not up.
  if (!authOpen && !signupDone) return children;

  const dismiss = () => { setAuthOpen(false); setError(""); setPending(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNeedsResend(false);
    takeSocialPending(); // a Google or Facebook try abandoned earlier is not this sign-in
    setSubmitting(true);
    try {
      if (mode === "signup") {
        if (phone.replace(/\D/g, "").length < 10) { setError("A phone number is required so the shop can reach you about orders."); return; }
        if (!/^\d{5}$/.test(zip.trim())) { setError("A 5-digit ZIP code is required so we can show pricing from the shop nearest you."); return; }
        const { data, error } = await signUp(email, password, name, phone, zip.trim());
        if (error) { setError(error.message); return; }
        // The confirmation link in the email finishes the sign-in, so the gate shows
        // "check your email" unless a session came back (the gate then opens on its own).
        if (!data || !data.session) { setDoneKind("signup"); setSignupDone(true); }
      } else if (mode === "reset") {
        const { error } = await requestPasswordReset(email);
        if (error) { setError(error.message); return; }
        setDoneKind("reset"); setSignupDone(true);
      } else {
        const { error } = await signIn(email, password);
        // An account made with Google or Facebook has no password until one is set.
        const social = ["google", "facebook"].filter((p) => providers?.[p]).map((p) => PROVIDER_NAME[p]);
        if (error && social.length && /invalid login credentials/i.test(error.message || "")) {
          setError(`That email and password don't match. If you signed up with ${social.join(" or ")}, use that button above, or choose Forgot password to set a password.`);
          return;
        }
        if (error) { setError(error.message); setNeedsResend(!!error.notConfirmed); return; }
      }
    } catch (e) {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!pending) return;
    setSubmitting(true);
    try {
      const { error } = await resendConfirmation(pending.email, pending.password);
      if (error) { setError(error.message); return; }
      setError("");
      setEmail(pending.email);
      setPending(null);
      setDoneKind("signup"); setSignupDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSocial = async (provider) => {
    setError("");
    setPending(null);
    setSubmitting(true);
    const { error } = await signInWithProvider(provider);
    // On success the browser navigates away to the provider, so only an error ever lands here.
    if (error) { setError(error.message); setSubmitting(false); }
  };

  if (signupDone) {
    return (<>{children}
      <div role="dialog" aria-modal="true" aria-label="Check your email" style={overlay}>
        <div style={{ maxWidth: 380, textAlign: "center", background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: INK }}>Check your email</div>
          <div style={{ fontSize: 13.5, color: "#555", lineHeight: 1.5 }}>
            {doneKind === "reset"
              ? <>We sent an email to <strong>{email}</strong>. If that address has an account, it has a link to choose a new password. If it doesn't, it tells you how to create one. Check your spam folder if it doesn't show up in a minute.</>
              : <>We sent an email to <strong>{email}</strong>. If you're new, it has a link that confirms your account and signs you in right here. If you already have an account, it tells you how to sign in. Check your spam folder if it doesn't show up in a minute.</>}
          </div>
          <button onClick={() => { setSignupDone(false); setMode("signin"); }}
            style={{ marginTop: 18, width: "100%", padding: "10px", borderRadius: 8, border: `1px solid ${INK}`, background: "transparent", color: INK, fontWeight: 600, cursor: "pointer" }}>
            Back to Sign In
          </button>
          <button onClick={() => { setSignupDone(false); dismiss(); }}
            style={{ marginTop: 8, width: "100%", padding: "10px", borderRadius: 8, border: "none", background: "transparent", color: "#777", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
            Keep using the tools
          </button>
        </div>
      </div>
    </>);
  }

  return (<>{children}
    <div role="dialog" aria-modal="true" aria-label={mode === "signup" ? "Create an account" : "Sign in"} style={overlay}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", textTransform: "uppercase", letterSpacing: "0.03em", fontSize: 22, fontWeight: 700, marginBottom: 4, color: "#0A2B41", textAlign: "center" }}>{ON_FORTIFIED ? "Fortified Metals" : "RoofCoil.com Tools"}</div>
        <div style={{ fontSize: 12.5, color: "#777", marginBottom: 22, textAlign: "center" }}>
          {mode === "signin" ? "Sign in to see pricing and send orders to a shop" : mode === "reset" ? "Enter your email and we'll send a link to choose a new password" : "Free account — unlocks pricing, ordering and saved jobs"}
        </div>

        {mode !== "reset" && (providers?.google || providers?.facebook) && (
          <>
            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {providers.google && (
                <button type="button" onClick={() => handleSocial("google")} disabled={submitting}
                  style={{ width: "100%", padding: "11px", borderRadius: 8, border: "1px solid #dadce0", background: "#fff", color: "#3c4043", fontWeight: 600, fontSize: 14, cursor: submitting ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, opacity: submitting ? 0.7 : 1 }}>
                  <GoogleG /> Continue with Google
                </button>
              )}
              {providers.facebook && (
                <button type="button" onClick={() => handleSocial("facebook")} disabled={submitting}
                  style={{ width: "100%", padding: "11px", borderRadius: 8, border: "1px solid #1877F2", background: "#1877F2", color: "#fff", fontWeight: 600, fontSize: 14, cursor: submitting ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, opacity: submitting ? 0.7 : 1 }}>
                  <FacebookF /> Continue with Facebook
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px", color: "#98A2AC", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>
              <span style={{ flex: 1, height: 1, background: "#E7E2D6" }} />or use email<span style={{ flex: 1, height: 1, background: "#E7E2D6" }} />
            </div>
          </>
        )}

        {mode === "signup" && (
          <>
            <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 12 }}>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required
                style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
            </label>
            <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 12 }}>
              Phone
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" inputMode="tel" placeholder="(555) 555-5555"
                style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
            </label>
            <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 12 }}>
              ZIP code <span style={{ color: "#8A94A6" }}>— for pricing from the shop nearest you</span>
              <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} required autoComplete="postal-code" inputMode="numeric" placeholder="75001"
                style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
            </label>
          </>
        )}
        <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 12 }}>
          Email
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setPending(null); }} required
            style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
        </label>
        {mode !== "reset" && (
          <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 16 }}>
            Password
            <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setPending(null); }} required minLength={6}
              style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
          </label>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12.5, color: "#B3261E", marginBottom: 14, background: "#FDECEA", padding: 8, borderRadius: 6 }}>
            {error}
            {needsResend && (
              <button type="button" onClick={handleResend} disabled={submitting}
                style={{ display: "block", marginTop: 8, border: "none", borderRadius: 6, background: "#0F3D5C", color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "7px 11px", cursor: submitting ? "default" : "pointer" }}>
                {submitting ? "Sending…" : "Send a new link"}
              </button>
            )}
          </div>
        )}

        <button type="submit" disabled={submitting}
          style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: SAFETY, color: "#fff", fontWeight: 700, fontSize: 14, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Please wait…" : mode === "signin" ? "Sign In" : mode === "reset" ? "Send reset link" : "Create Account"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12.5, color: "#777" }}>
          {mode === "signin" ? (
            <>Don't have an account?{" "}
              <button type="button" onClick={() => { setMode("signup"); setError(""); }} style={{ border: "none", background: "none", color: SAFETY, fontWeight: 700, cursor: "pointer", padding: 0 }}>Sign up</button>
              {" · "}
              <button type="button" onClick={() => { setMode("reset"); setError(""); setPending(null); }} style={{ border: "none", background: "none", color: SAFETY, fontWeight: 700, cursor: "pointer", padding: 0 }}>Forgot password?</button>
            </>
          ) : mode === "reset" ? (
            <>Remembered it?{" "}
              <button type="button" onClick={() => { setMode("signin"); setError(""); }} style={{ border: "none", background: "none", color: SAFETY, fontWeight: 700, cursor: "pointer", padding: 0 }}>Sign in</button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button type="button" onClick={() => { setMode("signin"); setError(""); }} style={{ border: "none", background: "none", color: SAFETY, fontWeight: 700, cursor: "pointer", padding: 0 }}>Sign in</button>
            </>
          )}
        </div>

        <button type="button" onClick={dismiss}
          style={{ width: "100%", marginTop: 14, padding: "10px", borderRadius: 8, border: "none", background: "transparent", color: "#777", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
          ← Keep using the tools without an account
        </button>

        {ON_FORTIFIED && (
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 11, color: "#98A2AC" }}>
            Powered by <a href="https://www.roofcoil.com" target="_blank" rel="noopener noreferrer" style={{ color: "#0F3D5C", fontWeight: 700, textDecoration: "none" }}>RoofCoil.com</a>
          </div>
        )}
      </form>
    </div>
  </>);
}
