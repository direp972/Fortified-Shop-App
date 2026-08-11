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
      const { data: created, error } = await supabase
        .from("customers")
        .insert({ id: userId, email: sessionUser.email, name, tier: "tier2" })
        .select()
        .maybeSingle();
      if (error) console.error("customer row creation error", error);
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

  const signUp = async (email, password, name) => {
    // Store the name in the auth user's own metadata (not the customers table) since
    // that's reliably available immediately, regardless of whether email confirmation
    // is required — loadCustomer picks it up from here once a real session exists.
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    return { data, error };
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshCustomer = () => loadCustomer(user);

  const value = { user, customer, isStaff, loading, signUp, signIn, signOut, refreshCustomer };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
