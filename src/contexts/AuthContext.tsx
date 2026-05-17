import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext, type AppRole, type Profile } from "@/hooks/useAuth";
import { usernameToEmail } from "@/lib/auth-utils";
import type { User, Session } from "@supabase/supabase-js";

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, username, yard_id, created_at, updated_at')
        .eq('user_id', userId)
        .single();
      if (error) throw error;

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .order('role', { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: allRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      const roles = (allRoles || []).map((r) => r.role as AppRole);
      let role: AppRole = 'user';
      if (roles.includes('super_admin')) role = 'super_admin';
      else if (roles.includes('admin')) role = 'admin';
      else if (roleData?.role) role = roleData.role as AppRole;

      let yard_name: string | null = null;
      if (data.yard_id) {
        const { data: yard } = await supabase
          .from('yards')
          .select('name')
          .eq('id', data.yard_id)
          .maybeSingle();
        yard_name = yard?.name ?? null;
      }

      setProfile({ ...data, role, yard_name } as Profile);
    } catch (e) {
      console.error('Error fetching profile:', e);
      setProfile(null);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchProfile(session.user.id), 0);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
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
  const currentYardId = () => profile?.yard_id ?? null;

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, signIn, signOut, isAdmin, isSuperAdmin, currentYardId }}
    >
      {children}
    </AuthContext.Provider>
  );
};
