import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

const AuthContext = createContext(null);

// Google and Facebook sign-in. Supabase only answers for the providers switched on in its
// dashboard (any other sends the browser to a bare "provider is not enabled" page), so the
// sign-in card reads the project's public settings and shows just those buttons. Switching
// one on in the dashboard brings its button up with no redeploy. Read once per page load.
const SOCIAL = ["google", "facebook"];
let socialProviders = null;
function getSocialProviders() {
  if (!socialProviders) {
    socialProviders = fetch(import.meta.env.VITE_SUPABASE_URL + "/auth/v1/settings", { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => ({ google: !!j?.external?.google, facebook: !!j?.external?.facebook }))
      .catch(() => { socialProviders = null; return { google: false, facebook: false }; });
  }
  return socialProviders;
}

// The round trip leaves the page, so a note in sessionStorage (this tab only) says which
// provider it went to; whatever comes back reads it once. Older than 15 minutes, it's stale.
const OAUTH_PENDING = "rc-oauth-pending";
function takeSocialPending() {
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem(OAUTH_PENDING) || "null"); sessionStorage.removeItem(OAUTH_PENDING); } catch (e) { /* ignore */ }
  return p && SOCIAL.includes(p.provider) && Date.now() - p.at < 15 * 60 * 1000 ? p.provider : null;
}

// What Supabase adds to the address when it comes back with an error.
export const AUTH_ERROR_PARAMS = ["error", "error_code", "error_description"];

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [customer, setCustomer] = useState(null); // row from `customers` table (name, tier, etc.)
  const [isStaff, setIsStaff] = useState(false);
  const [ownedShops, setOwnedShops] = useState([]); // directory listings this account owns (manage-listing)
  // Shops this account runs (public.shop_members, through my_shops()): each gives the
  // account that shop's Price List backend, costs, tiers, materials board and Shop Floor.
  const [memberShops, setMemberShops] = useState([]);
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
      setOwnedShops([]);
      setMemberShops([]);
      return;
    }
    const userId = sessionUser.id;
    // Any shop invite addressed to this account's confirmed email becomes a membership now,
    // before the shop list below is read (the customers trigger covers brand-new accounts;
    // this covers the rest). Best effort: a failure here just means no new shop this load.
    try { await supabase.rpc("accept_my_invites"); } catch (e) { /* ignore */ }
    const [{ data: custRow }, { data: staffRow }, { data: shopRows }, { data: memberRows }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", userId).maybeSingle(),
      supabase.from("staff").select("id").eq("id", userId).maybeSingle(),
      supabase.from("directory_listings").select("id, name, accepts_orders, order_email").eq("owner_id", userId),
      supabase.rpc("my_shops"),
    ]);
    setOwnedShops(shopRows || []);
    setMemberShops(Array.isArray(memberRows) ? memberRows : []);
    if (custRow) {
      setCustomer(custRow);
    } else {
      const name = sessionUser.user_metadata?.name || "";
      const phone = sessionUser.user_metadata?.phone || "";
      const zip = sessionUser.user_metadata?.zip || null;
      let { data: created, error } = await supabase
        .from("customers")
        .insert({ id: userId, email: sessionUser.email, name, phone, zip }) // tiers are per shop (shop_customers), not on this row
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

  const signUp = async (email, password, name, phone, zip) => {
    // Sign-up goes through the signup-email Edge Function: it creates the account
    // unconfirmed and emails Supabase's own confirmation link through the shop's Resend
    // sender, so the two-an-hour limit of Supabase's built-in mailer never applies. The
    // link lands back on this page with the session in the URL hash, which supabase-js
    // picks up on load; loadCustomer then reads the name and phone from the user metadata.
    // No session comes back here, so AuthGate shows "check your email". If the function
    // can't be reached, supabase.auth.signUp (Supabase's own mailer) is the fallback.
    const fn = await callSignupEmail({ email, password, name, company: "", phone, zip });
    if (fn) {
      if (!fn.ok) return { data: null, error: { message: friendly(fn.j.error) || "Sign up failed — please try again." } };
      return { data: { user: null, session: null }, error: null };
    }
    try {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name, phone, zip } } });
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

  // "Forgot password": the function emails a link to reset.html for a confirmed account, a
  // fresh confirmation link for a pending one, and a "no account" note otherwise.
  const requestPasswordReset = async (email) => {
    const fn = await callSignupEmail({ email, reset: true });
    if (!fn) return { error: { message: "Couldn't reach the server — check your connection and try again." } };
    if (!fn.ok) return { error: { message: friendly(fn.j.error) || "Couldn't send a reset link — please try again." } };
    return { error: null };
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { data, error: { ...error, message: friendly(error) || error.message, notConfirmed: /not confirmed/i.test(error.message || "") } };
    return { data, error };
  };

  // Google or Facebook: Supabase runs the round trip and sends the browser back to the page
  // that started it, with the session in the URL hash, which supabase-js picks up on load.
  // The app is at / on shop.roofcoil.com and fortified-shop-app.vercel.app and at /app
  // behind the www.roofcoil.com and fortifiedmetals.com proxies; all of them are on the
  // project's redirect allow-list (an address that isn't comes back to the Site URL,
  // shop.roofcoil.com, signed in there instead). The query comes along so a shop's ?shop=
  // link still picks that shop; a stale error from a failed try does not.
  const signInWithProvider = async (provider) => {
    const back = new URL(window.location.href);
    AUTH_ERROR_PARAMS.forEach((k) => back.searchParams.delete(k));
    back.hash = "";
    // Google: someone with two Google accounts picks one. Facebook: if the email permission
    // was declined last time, it is asked for again — there is no account without an email.
    const queryParams = provider === "google" ? { prompt: "select_account" } : { auth_type: "rerequest" };
    try { sessionStorage.setItem(OAUTH_PENDING, JSON.stringify({ provider, at: Date.now() })); } catch (e) { /* ignore */ }
    const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: back.toString(), queryParams } });
    if (error) {
      takeSocialPending();
      return { data, error: { message: "Couldn't start that sign-in — try again, or use your email." } };
    }
    return { data, error };
  };

  // Google and Facebook share a name and an email but no phone or ZIP, so AuthGate asks for
  // them after the first social sign-in. They go to the account's metadata like an email
  // sign-up's do; the on_auth_user_details trigger copies them onto the customers row where
  // it has none yet, and the reload below picks that up (the ZIP picks the nearest shop).
  const saveContactDetails = async (phone, zip) => {
    const { data, error } = await supabase.auth.updateUser({ data: { phone, zip } });
    if (error) return { error: { message: friendly(error) || "Couldn't save that — please try again." } };
    await loadCustomer(data.user);
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshCustomer = () => loadCustomer(user);

  const value = { user, customer, isStaff, ownedShops, memberShops, loading, signUp, signIn, signInWithProvider, getSocialProviders, takeSocialPending, saveContactDetails, signOut, refreshCustomer, resendConfirmation, requestPasswordReset };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
