import { createContext, useContext } from "react";
import type { AuthError, User, Session } from "@supabase/supabase-js";

export type AppRole = "super_admin" | "admin" | "user";

export interface Profile {
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

export interface AuthContextType {
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

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
