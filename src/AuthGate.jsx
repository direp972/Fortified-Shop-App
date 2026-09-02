import React, { useState, useEffect } from "react";
import { useAuth } from "./lib/AuthProvider";

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

export default function AuthGate({ children }) {
  const { user, loading, signUp, signIn, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  // If Google (or Supabase) bounced us back with an error, it arrives in the URL hash
  // (#error=...&error_description=...). Surface it once and clean the address bar.
  useEffect(() => {
    const h = window.location.hash || "";
    if (h.indexOf("error") === -1) return;
    const p = new URLSearchParams(h.replace(/^#/, ""));
    if (p.get("error")) {
      setError(p.get("error_description") || p.get("error"));
      try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* ignore */ }
    }
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontFamily: "system-ui" }}>
        Loading…
      </div>
    );
  }

  if (user) return children;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "signup") {
        if (phone.replace(/\D/g, "").length < 10) { setError("A phone number is required so the shop can reach you about orders."); return; }
        const { error } = await signUp(email, password, name, phone);
        if (error) { setError(error.message); return; }
        setSignupDone(true);
      } else {
        const { error } = await signIn(email, password);
        if (error) { setError(error.message); return; }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setSubmitting(true);
    const { error } = await signInWithGoogle();
    // On success the browser navigates away to Google, so only an error ever lands here.
    if (error) { setError(error.message); setSubmitting(false); }
  };

  if (signupDone) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #0B1E2C, #0F3D5C)", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 }}>
        <div style={{ maxWidth: 380, textAlign: "center", background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: INK }}>Check your email</div>
          <div style={{ fontSize: 13.5, color: "#555", lineHeight: 1.5 }}>
            We sent a confirmation link to <strong>{email}</strong>. Click it, then come back and sign in.
          </div>
          <button onClick={() => { setSignupDone(false); setMode("signin"); }}
            style={{ marginTop: 18, width: "100%", padding: "10px", borderRadius: 8, border: `1px solid ${INK}`, background: "transparent", color: INK, fontWeight: 600, cursor: "pointer" }}>
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #0B1E2C, #0F3D5C)", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", textTransform: "uppercase", letterSpacing: "0.03em", fontSize: 22, fontWeight: 700, marginBottom: 4, color: "#0A2B41", textAlign: "center" }}>{ON_FORTIFIED ? "Fortified Metals" : "RoofCoil.com Tools"}</div>
        <div style={{ fontSize: 12.5, color: "#777", marginBottom: 22, textAlign: "center" }}>
          {mode === "signin" ? "Sign in to place or view orders" : "Create an account to get started"}
        </div>

        <button type="button" onClick={handleGoogle} disabled={submitting}
          style={{ width: "100%", padding: "11px", borderRadius: 8, border: "1px solid #dadce0", background: "#fff", color: "#3c4043", fontWeight: 600, fontSize: 14, cursor: submitting ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16, opacity: submitting ? 0.7 : 1 }}>
          <GoogleG /> Continue with Google
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px", color: "#98A2AC", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>
          <span style={{ flex: 1, height: 1, background: "#E7E2D6" }} />or use email<span style={{ flex: 1, height: 1, background: "#E7E2D6" }} />
        </div>

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
          </>
        )}
        <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 12 }}>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
        </label>
        <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 16 }}>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
        </label>

        {error && <div style={{ fontSize: 12.5, color: "#B3261E", marginBottom: 14, background: "#FDECEA", padding: 8, borderRadius: 6 }}>{error}</div>}

        <button type="submit" disabled={submitting}
          style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", background: SAFETY, color: "#fff", fontWeight: 700, fontSize: 14, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12.5, color: "#777" }}>
          {mode === "signin" ? (
            <>Don't have an account?{" "}
              <button type="button" onClick={() => { setMode("signup"); setError(""); }} style={{ border: "none", background: "none", color: SAFETY, fontWeight: 700, cursor: "pointer", padding: 0 }}>Sign up</button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button type="button" onClick={() => { setMode("signin"); setError(""); }} style={{ border: "none", background: "none", color: SAFETY, fontWeight: 700, cursor: "pointer", padding: 0 }}>Sign in</button>
            </>
          )}
        </div>

        {ON_FORTIFIED && (
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 11, color: "#98A2AC" }}>
            Powered by <a href="https://www.roofcoil.com" target="_blank" rel="noopener noreferrer" style={{ color: "#0F3D5C", fontWeight: 700, textDecoration: "none" }}>RoofCoil.com</a>
          </div>
        )}
      </form>
    </div>
  );
}
