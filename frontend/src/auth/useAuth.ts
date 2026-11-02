import { createContext, useContext } from "react";
import type { Session } from "./session";
type AuthContextValue = {
  session: Session;
  retry: () => void;
  logout: () => Promise<void>;
};
export const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider is required");
  return context;
}
