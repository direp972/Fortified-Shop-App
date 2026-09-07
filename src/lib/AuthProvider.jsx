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
    if (/not confirmed/i.test(m)) return "That email has an account that was never confirmed. Call 972-944-7963 and we'll fix it in a minute.";
    return m;
  };

  const signUp = async (email, password, name, phone) => {
    // Sign-up goes through the signup-direct Edge Function, which creates the account
    // already confirmed — no confirmation email, so Supabase's built-in mailer limit (a
    // couple of emails an hour) can't lock people out — and then signs in with the ordinary
    // password grant from this browser. The name and phone ride along as user metadata;
    // loadCustomer picks them up from the session. If the function can't be reached,
    // supabase.auth.signUp (confirmation email) is the fallback.
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    let r = null, j = null;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      r = await fetch(url + "/functions/v1/signup-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey },
        body: JSON.stringify({ email, password, name, company: "", phone }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      j = await r.json();
    } catch (e) { r = null; j = null; }
    // Only a reply the function itself wrote counts; anything else falls back below.
    const fromFn = j && (j.created === true || typeof j.error === "string");
    if (r && fromFn) {
      if (!r.ok) return { data: null, error: { message: friendly(j.error) || "Sign up failed — please try again." } };
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const m = /invalid login/i.test(error.message || "")
          ? "Couldn't sign in with that password. If this email already has an account, use its password — or call 972-944-7963."
          : friendly(error);
        return { data, error: { message: m } };
      }
      return { data, error: null };
    }
    try {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name, phone } } });
      if (error) return { data, error: { message: friendly(error) || "Sign up failed — please try again." } };
      return { data, error };
    } catch (e) {
      return { data: null, error: { message: "Couldn't reach the server — check your connection and try again." } };
    }
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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

  const value = { user, customer, isStaff, loading, signUp, signIn, signInWithGoogle, signOut, refreshCustomer };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
