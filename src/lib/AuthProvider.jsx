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

  const loadCustomer = useCallback(async (userId) => {
    if (!userId) {
      setCustomer(null);
      setIsStaff(false);
      return;
    }
    const [{ data: custRow }, { data: staffRow }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", userId).maybeSingle(),
      supabase.from("staff").select("id").eq("id", userId).maybeSingle(),
    ]);
    setCustomer(custRow || null);
    setIsStaff(!!staffRow);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      loadCustomer(session?.user?.id).finally(() => setLoading(false));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      loadCustomer(session?.user?.id);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadCustomer]);

  const signUp = async (email, password, name) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };
    // Create their customer record right away. Defaults to Tier 2 (retail/"off the
    // street" pricing) until a staff member manually assigns them a better tier.
    if (data.user) {
      const { error: custError } = await supabase
        .from("customers")
        .insert({ id: data.user.id, email, name: name || "", tier: "tier2" });
      if (custError) return { error: custError };
    }
    return { data };
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshCustomer = () => loadCustomer(user?.id);

  const value = { user, customer, isStaff, loading, signUp, signIn, signOut, refreshCustomer };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
