import type { ShareHolder } from "@sqw/shared";

export const PARTICIPANTS = 3;
export const THRESHOLD = 2;

/** Fixed party ids across the whole system (CLAUDE.md section 5). */
export const PARTY_ID: Record<ShareHolder, number> = {
  phone: 0,
  cosigner: 1,
  "recovery-provider": 2,
};

export const PHONE = PARTY_ID.phone;
