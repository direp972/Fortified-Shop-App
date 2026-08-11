import React, { useState } from "react";
import { useAuth } from "./lib/AuthProvider";

const INK = "#1C1C1E";
const SAFETY = "#D4AF37";

export default function AuthGate({ children }) {
  const { user, loading, signUp, signIn } = useAuth();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

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
        const { error } = await signUp(email, password, name);
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

  if (signupDone) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F1EA", fontFamily: "system-ui", padding: 20 }}>
        <div style={{ maxWidth: 380, textAlign: "center", background: "#fff", borderRadius: 12, padding: 28, boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}>
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F1EA", fontFamily: "system-ui", padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 12, padding: 28, boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: INK, textAlign: "center" }}>Fortified Sheet Metal</div>
        <div style={{ fontSize: 12.5, color: "#777", marginBottom: 22, textAlign: "center" }}>
          {mode === "signin" ? "Sign in to place or view orders" : "Create an account to get started"}
        </div>

        {mode === "signup" && (
          <label style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 12 }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required
              style={{ width: "100%", padding: 10, marginTop: 4, border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box" }} />
          </label>
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
      </form>
    </div>
  );
}
