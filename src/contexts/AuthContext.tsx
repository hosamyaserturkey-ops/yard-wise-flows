import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext, type AppRole, type Profile } from "@/hooks/useAuth";
import { usernameToEmail } from "@/lib/auth-utils";
import type { User, Session } from "@supabase/supabase-js";

const SELECTED_YARD_KEY = "cy.selectedYardId";

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedYardId, setSelectedYardIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(SELECTED_YARD_KEY);
  });
  const setSelectedYardId = (id: string | null) => {
    setSelectedYardIdState(id);
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(SELECTED_YARD_KEY, id);
      else window.localStorage.removeItem(SELECTED_YARD_KEY);
    }
  };
  const activeUserIdRef = useRef<string | null>(null);

  const fetchProfile = async (userId: string) => {
    activeUserIdRef.current = userId;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, username, yard_id, shipping_line, created_at, updated_at')
        .eq('user_id', userId)
        .single();
      if (error) throw error;

      const { data: allRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      const roles = (allRoles || []).map((r) => r.role as AppRole);
      let role: AppRole = 'user';
      if (roles.includes('super_admin')) role = 'super_admin';
      else if (roles.includes('admin')) role = 'admin';
      else if (roles.includes('inspector')) role = 'inspector';
      else if (roles.includes('line_rep')) role = 'line_rep';

      let yard_name: string | null = null;
      if (data.yard_id) {
        const { data: yard } = await supabase
          .from('yards')
          .select('name')
          .eq('id', data.yard_id)
          .maybeSingle();
        yard_name = yard?.name ?? null;
      }

      // Discard if the user has signed out (or switched) while we were fetching.
      if (activeUserIdRef.current !== userId) return;
      setProfile({ ...data, role, yard_name } as Profile);
    } catch (e) {
      console.error('Error fetching profile:', e);
      if (activeUserIdRef.current === userId) setProfile(null);
    } finally {
      if (activeUserIdRef.current === userId) setLoading(false);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchProfile(session.user.id), 0);
      } else {
        activeUserIdRef.current = null;
        setProfile(null);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isSuperAdmin = () => profile?.role === 'super_admin';
  const isAdmin = () => profile?.role === 'admin' || profile?.role === 'super_admin';
  const isInspector = () => profile?.role === 'inspector';
  const isLineRep = () => profile?.role === 'line_rep';
  const currentYardId = () => {
    if (profile?.role === 'super_admin') return selectedYardId; // null = all yards
    return profile?.yard_id ?? null;
  };

  return (
    <AuthContext.Provider
      value={{
        user, session, profile, loading,
        signIn, signOut,
        isAdmin, isSuperAdmin, isInspector, isLineRep,
        currentYardId,
        selectedYardId, setSelectedYardId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
