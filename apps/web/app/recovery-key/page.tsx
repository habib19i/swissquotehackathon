"use client";

import { useRouter } from "next/navigation";
import { RecoveryKeySetup } from "../../components/recovery-key-setup";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";

/** Adds the recovery key to a safe created before this step existed in onboarding. */
export default function RecoveryKeyPage() {
  const router = useRouter();
  return (
    <RequireWallet>
      {(profile) => (
        <Screen back={{ href: "/" }}>
          <RecoveryKeySetup profile={profile} onDone={() => router.replace("/")} />
        </Screen>
      )}
    </RequireWallet>
  );
}
