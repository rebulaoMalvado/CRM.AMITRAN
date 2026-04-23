import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/types/crm';

interface AuthContextType {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isHead: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('Erro ao buscar profile:', error);
    return null;
  }
  return data as Profile;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session) {
        fetchProfile(data.session.user.id).then(p => {
          if (!cancelled) setProfile(p);
        });
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      if (newSession) {
        // Defer to escape Supabase's internal auth lock — calling supabase.from()
        // synchronously inside this callback can deadlock.
        setTimeout(() => {
          if (cancelled) return;
          fetchProfile(newSession.user.id).then(p => {
            if (!cancelled) setProfile(p);
          });
        }, 0);
      } else {
        setProfile(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (session) setProfile(await fetchProfile(session.user.id));
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        isHead: profile?.role === 'head',
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
