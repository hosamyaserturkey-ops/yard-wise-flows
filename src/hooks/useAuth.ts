import { createContext, useContext } from "react";
import type { AuthError, User, Session } from "@supabase/supabase-js";

export type AppRole = "super_admin" | "admin" | "user" | "inspector" | "line_rep";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  username: string | null;
  role: AppRole;
  yard_id: string | null;
  yard_name: string | null;
  /** Shipping line code a 'line_rep' represents; null for every other role. */
  shipping_line: string | null;
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
  isInspector: () => boolean;
  isLineRep: () => boolean;
  /** Effective yard scope for reads. Null = all yards (super_admin viewing everything). */
  currentYardId: () => string | null;
  /** Super_admin only: the yard they've selected from the top-bar switcher, or null for "All yards". */
  selectedYardId: string | null;
  setSelectedYardId: (id: string | null) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
