"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadClient, loadProfile, type Client, type WalletProfile } from "../lib/profile";

interface WalletState {
  loading: boolean;
  client?: Client;
  profile?: WalletProfile;
  reload(): Promise<void>;
}

const WalletContext = createContext<WalletState>({ loading: true, reload: async () => {} });

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<WalletState, "reload">>({ loading: true });

  const reload = useCallback(async () => {
    const [client, profile] = await Promise.all([loadClient(), loadProfile()]);
    setState({ loading: false, client, profile });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return <WalletContext.Provider value={{ ...state, reload }}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext);

/** Renders children only once this phone holds a safe; otherwise sends the client to log in or set up. */
export function RequireWallet({ children }: { children: (profile: WalletProfile) => React.ReactNode }) {
  const { loading, client, profile } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (loading || profile) return;
    router.replace(client ? "/onboarding" : "/login");
  }, [loading, client, profile, router]);

  return profile ? children(profile) : null;
}
