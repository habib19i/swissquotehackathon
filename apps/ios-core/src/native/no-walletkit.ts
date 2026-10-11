/**
 * Stands in for Reown's web WalletKit in the core: in the iOS app, WalletConnect sessions run natively
 * (Reown's Swift SDK), and the core only prepares and sends the transactions they ask for.
 */
const unavailable = () => {
  throw new Error("WalletConnect sessions are handled by the iOS app, not the wallet core.");
};

export const WalletKit = { init: unavailable };
export class Core {
  constructor() {
    unavailable();
  }
}
export const buildApprovedNamespaces = unavailable;
export const getSdkError = unavailable;
