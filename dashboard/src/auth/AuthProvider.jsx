import React, { useEffect, useMemo, useState } from 'react';
import { AuthContext } from './AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      return undefined;
    }

    let mounted = true;

    const hydrateSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        setSession(null);
        setUser(null);
      } else {
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
      }
      setLoading(false);
    };

    hydrateSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      isConfigured: isSupabaseConfigured,
      isAuthenticated: Boolean(session?.user),
    }),
    [loading, session, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
