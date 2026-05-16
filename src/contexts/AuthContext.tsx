import { createContext, useContext, useEffect, useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = 'super_admin' | 'admin' | 'user';

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  username: string | null;
  role: AppRole;
  yard_id: string | null;
  yard_name: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  isAdmin: () => boolean;
  isSuperAdmin: () => boolean;
  currentYardId: () => string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const usernameToEmail = (username: string) => `${username.toLowerCase()}@containeryard.app`;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};

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

      // If user has multiple roles, prefer super_admin > admin > user
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
