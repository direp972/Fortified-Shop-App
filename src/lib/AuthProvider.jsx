import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [customer, setCustomer] = useState(null); // row from `customers` table (name, tier, etc.)
  const [isStaff, setIsStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  // Loads the customer/staff rows for a signed-in user, and self-heals by creating the
  // customer row if it's missing. That row can't be created at signUp() time — if email
  // confirmation is required, signUp() returns no active session yet, so any insert
  // attempted then has no authenticated user and Supabase's security policy correctly
  // rejects it. Creating it here instead, only once a real session exists, means it
  // works the same way whether email confirmation is on or off.
  const loadCustomer = useCallback(async (sessionUser) => {
    if (!sessionUser) {
      setCustomer(null);
      setIsStaff(false);
      return;
    }
    const userId = sessionUser.id;
    const [{ data: custRow }, { data: staffRow }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", userId).maybeSingle(),
      supabase.from("staff").select("id").eq("id", userId).maybeSingle(),
    ]);
    if (custRow) {
      setCustomer(custRow);
    } else {
      const name = sessionUser.user_metadata?.name || "";
      const phone = sessionUser.user_metadata?.phone || "";
      let { data: created, error } = await supabase
        .from("customers")
        .insert({ id: userId, email: sessionUser.email, name, phone, tier: "tier2" })
        .select()
        .maybeSingle();
      if (error && error.code === "23505") {
        // Another load won the insert (first render runs this twice; another tab can too) — read that row.
        ({ data: created } = await supabase.from("customers").select("*").eq("id", userId).maybeSingle());
      } else if (error) console.error("customer row creation error", error);
      setCustomer(created || null);
    }
    setIsStaff(!!staffRow);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      loadCustomer(session?.user || null).finally(() => setLoading(false));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      loadCustomer(session?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadCustomer]);

  const friendly = (m) => {
    m = typeof m === "string" ? m : (m && m.message) || "";
    if (/rate limit/i.test(m)) return "We're getting a lot of sign-ups right now — try again in a few minutes, or call 972-944-7963 and we'll set you up.";
    if (/not confirmed/i.test(m)) return "That email hasn't been confirmed yet — check your inbox (and spam) for the link, or send a new one.";
    return m;
  };

  // Returns {ok, j} for a reply the signup-email function itself wrote, or null for
  // anything else (unreachable, a gateway page, a non-JSON body) so the caller can fall back.
  const callSignupEmail = async (payload) => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    let r = null, j = null, slow = false;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => { slow = true; ctl.abort(); }, 20000);
      r = await fetch(url + "/functions/v1/signup-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey },
        body: JSON.stringify({ redirectTo: window.location.origin + window.location.pathname, ...payload }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      j = await r.json();
    } catch (e) { r = null; j = null; }
    // A request we gave up on may still have gone through and sent the email, so it is not
    // retried through the fallback: the person is told to look for the email first.
    if (slow) return { ok: false, j: { error: "This is taking longer than usual. If a confirmation email shows up in the next minute, use it — otherwise try again." } };
    const fromFn = j && (j.sent === true || typeof j.error === "string");
    return r && fromFn ? { ok: r.ok, j } : null;
  };

  const signUp = async (email, password, name, phone) => {
    // Sign-up goes through the signup-email Edge Function: it creates the account
    // unconfirmed and emails Supabase's own confirmation link through the shop's Resend
    // sender, so the two-an-hour limit of Supabase's built-in mailer never applies. The
    // link lands back on this page with the session in the URL hash, which supabase-js
    // picks up on load; loadCustomer then reads the name and phone from the user metadata.
    // No session comes back here, so AuthGate shows "check your email". If the function
    // can't be reached, supabase.auth.signUp (Supabase's own mailer) is the fallback.
    const fn = await callSignupEmail({ email, password, name, company: "", phone });
    if (fn) {
      if (!fn.ok) return { data: null, error: { message: friendly(fn.j.error) || "Sign up failed — please try again." } };
      return { data: { user: null, session: null }, error: null };
    }
    try {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name, phone } } });
      if (error) return { data, error: { message: friendly(error) || "Sign up failed — please try again." } };
      return { data, error };
    } catch (e) {
      return { data: null, error: { message: "Couldn't reach the server — check your connection and try again." } };
    }
  };

  // A sign-in that failed with "not confirmed" can ask for a fresh link with just the email
  // and password it already has; the function keeps the name and phone from the sign-up.
  const resendConfirmation = async (email, password) => {
    const fn = await callSignupEmail({ email, password, resend: true });
    if (!fn) return { error: { message: "Couldn't reach the server — check your connection and try again." } };
    if (!fn.ok) return { error: { message: friendly(fn.j.error) || "Couldn't send a new link — please try again." } };
    return { error: null };
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { data, error: { ...error, message: friendly(error) || error.message, notConfirmed: /not confirmed/i.test(error.message || "") } };
    return { data, error };
  };

  const signInWithGoogle = async () => {
    // Come back to the exact page that started the sign-in: the app lives at / on
    // shop.roofcoil.com and at /app behind fortifiedmetals.com's proxy. Both origins
    // are on the Supabase redirect allow-list.
    const redirectTo = window.location.origin + window.location.pathname;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" } },
    });
    return { data, error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshCustomer = () => loadCustomer(user);

  const value = { user, customer, isStaff, loading, signUp, signIn, signInWithGoogle, signOut, refreshCustomer, resendConfirmation };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
