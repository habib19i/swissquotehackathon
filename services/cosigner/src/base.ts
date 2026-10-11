/**
 * Swissquote on Base Sepolia (CLAUDE.md section 7). Swissquote runs the bundler, which submits clients'
 * UserOperations from its own wallet, and the paymaster, which pays their gas once Swissquote has signed
 * for it. Neither gives Swissquote any power over a client's account: only the account's own keys can
 * make it act, and the account checks them on-chain.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  BaseError,
  RawContractError,
  createWalletClient,
  decodeErrorResult,
  erc20Abi,
  http,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  parseSignature,
  toHex,
  type Address,
  type Hex,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { entryPoint09Abi, toPackedUserOperation } from "viem/account-abstraction";
import {
  DEPLOYMENTS,
  ENTRY_POINT,
  GAS,
  USDC,
  UnsupportedCallError,
  accountAddress,
  accountSettings,
  baseClient,
  supportsApps,
  chain,
  chfForUsdc,
  decodeActions,
  deployment,
  formatUsdc,
  isDeployed,
  mpcSignerAddress,
  onChainRules,
  passkeyFromSpki,
  paymasterData,
  paymasterHash,
  rulebookAccountAbi,
  rulesTarget,
  syncActions,
  usdcBalance,
  usdcForChf,
  userOpFromJson,
  userOpHash,
  userOpToJson,
  type AccountSettings,
  type UserOp,
} from "@sqw/ethereum";
import { explorer, type EthAccountRecord, type EthFeeQuote, type EthPrepareRequest, type EthPrepared, type EthSent, type EthStatus, type Plan } from "@sqw/shared";
import { PolicyError } from "./bitcoin-policy";
import { reviewEthOp, type EthPolicyContext } from "./ethereum-policy";
import type { HotWallet } from "./hot-wallet";
import { prices, usdcChf } from "./price";
import { WalletError, type StoredWallet } from "./wallets";

/** Premium plan: most operations Swissquote sponsors per safe in 24 hours (abuse cap). */
const PREMIUM_DAILY_OPS = Number(process.env.ETH_SPONSOR_DAILY_CAP_OPS ?? 50);
/** Standard plan: the smallest network fee charged, in USDC units (USDC 0.01). */
const MIN_FEE_USDC = 10_000n;
/** Gas a typical operation uses, for fee quotes. */
const TYPICAL_GAS = 300_000n;
/** Swissquote's sponsorship expires if the operation is not sent within this time. */
const SPONSORSHIP_TTL_SECONDS = 600;

/** EntryPoint refusal codes (ERC-4337), in plain language. */
const ENTRY_POINT_REASONS: Record<string, string> = {
  AA22: "This operation took too long to confirm. Please try again.",
  AA23: "Your safe refused this operation.",
  AA24: "The signature does not match your safe.",
  AA25: "Another operation from your safe went first. Please try again.",
  AA31: "Swissquote's fee service is out of funds. Please try again later.",
  AA32: "Swissquote's sponsorship has expired. Please try again.",
  AA34: "Swissquote's sponsorship does not match this operation.",
};

/** USDC's gasless transfers (EIP-3009): the holder signs, anyone submits. */
const transferWithAuthorizationAbi = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

const KNOWN_ERRORS = [...rulebookAccountAbi, ...entryPoint09Abi, ...parseAbi(["error Error(string message)"])];

/** Why a call or an operation was refused, in plain language. */
export function explainRevert(data: Hex | undefined): string {
  if (!data || data === "0x") return "The network refused this operation.";
  try {
    const error = decodeErrorResult({ abi: KNOWN_ERRORS, data });
    switch (error.errorName) {
      case "OutsideRulebook":
        return "This person is not an approved contact on your safe yet, or your safe is frozen.";
      case "DailyLimitExceeded":
        return `This is more than you can still pay today with Face ID alone (${formatUsdc(error.args[0])} left).`;
      case "FailedOp":
      case "FailedOpWithRevert": {
        const reason = error.args[1];
        const inner = error.errorName === "FailedOpWithRevert" ? ` ${explainRevert(error.args[2])}` : "";
        return (ENTRY_POINT_REASONS[reason.slice(0, 4)] ?? `The network refused this operation (${reason}).`) + inner;
      }
      case "Error":
        return /exceeds balance/i.test(String(error.args[0])) ? "There is not enough USDC in your safe for this." : String(error.args[0]);
      default:
        return `The network refused this operation (${error.errorName}).`;
    }
  } catch {
    return "The network refused this operation.";
  }
}

function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const raw = err.walk((e) => e instanceof RawContractError) as RawContractError | null;
  const data = raw?.data;
  if (typeof data === "string") return data;
  return data?.data ?? (err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null)?.data;
}

export function parseUserOp(json: unknown): UserOp {
  try {
    return userOpFromJson(json);
  } catch (err) {
    throw new PolicyError((err as Error).message);
  }
}

export function baseService(db: DatabaseSync, wallet: HotWallet) {
  const client = baseClient(process.env.BASE_SEPOLIA_RPC_URL);
  const relayer = createWalletClient({ account: wallet.ethAccount, chain, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });
  const swissquote = wallet.ethAccount.address;

  db.exec(`
    CREATE TABLE IF NOT EXISTS eth_ops (
      user_op_hash TEXT PRIMARY KEY,
      wallet_id    TEXT NOT NULL,
      tx_hash      TEXT NOT NULL,
      success      INTEGER NOT NULL,
      sponsored    INTEGER NOT NULL,
      at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Swissquote's wallet sends one transaction at a time, so its nonces stay in order.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  const requireEth = (w: StoredWallet) => {
    if (!w.ethereum) throw new WalletError(404, "This safe has no USDC account yet.");
    return w.ethereum;
  };

  const sponsoredToday = (walletId: string) =>
    (
      db.prepare("SELECT COUNT(*) AS n FROM eth_ops WHERE wallet_id = ? AND sponsored = 1 AND at > datetime('now', '-1 day')").get(walletId) as {
        n: number;
      }
    ).n;

  async function gasPrices() {
    const fees = await client.estimateFeesPerGas();
    return { maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  }

  async function feeQuote(plan: Plan, maxFeePerGas?: bigint): Promise<EthFeeQuote> {
    const { ethChf, usdcChf: rate } = await prices();
    const gasPrice = maxFeePerGas ?? (await gasPrices()).maxFeePerGas;
    const costChf = (Number(TYPICAL_GAS * gasPrice) / 1e18) * ethChf;
    if (plan === "premium") return { paidBy: "swissquote", feeUsdc: "0", feeChf: costChf };
    const fee = usdcForChf(costChf, rate) > MIN_FEE_USDC ? usdcForChf(costChf, rate) : MIN_FEE_USDC;
    return { paidBy: "client", feeUsdc: String(fee), feeChf: chfForUsdc(fee, rate) };
  }

  async function policyContext(w: StoredWallet): Promise<EthPolicyContext> {
    const eth = requireEth(w);
    const rate = await usdcChf();
    const { ethChf } = await prices();
    return {
      ethChf,
      account: eth.address,
      settings: accountSettings(eth),
      passkey: eth.passkey,
      rulebook: w.rulebook,
      target: rulesTarget(w.rulebook, rate, supportsApps(eth)),
      usdcChf: rate,
      swissquote,
    };
  }

  const nonceOf = (account: Address) =>
    client.readContract({ address: ENTRY_POINT, abi: entryPoint09Abi, functionName: "getNonce", args: [account, 0n] });

  /** Execution gas: simulated as the EntryPoint would run it, with a margin; defaults before deployment. */
  async function callGas(account: Address, callData: Hex, deployed: boolean): Promise<bigint> {
    if (!deployed) return GAS.callUndeployed;
    const measured = await client.estimateGas({ account: ENTRY_POINT, to: account, data: callData }).catch(() => undefined);
    return measured ? (measured * 13n) / 10n + 30_000n : GAS.call;
  }

  /** Simulates the account call as the EntryPoint would make it, to explain a refusal before Face ID. */
  async function preflight(account: Address, callData: Hex) {
    try {
      await client.call({ account: ENTRY_POINT, to: account, data: callData });
    } catch (err) {
      throw new PolicyError(explainRevert(revertData(err)));
    }
  }

  return {
    client,
    swissquote,
    policyContext,
    feeQuote,

    /** Swissquote computes the account's address itself, from the MPC key and the wallet passkey. */
    async newAccount(w: StoredWallet, passkeySpki: string): Promise<EthAccountRecord> {
      let passkey;
      try {
        passkey = passkeyFromSpki(passkeySpki);
      } catch (err) {
        throw new PolicyError((err as Error).message);
      }
      const target = rulesTarget(w.rulebook, await usdcChf());
      const settings: AccountSettings = {
        factory: DEPLOYMENTS.factory,
        mpcSigner: mpcSignerAddress(w.mpcPublicKey),
        passkeyX: passkey.x,
        passkeyY: passkey.y,
        contactsRoot: target.contactsRoot,
        dailyLimit: target.dailyLimit,
      };
      const address = await accountAddress(client, settings);
      const { factory, ...created } = settings;
      return { address, factory, settings: { ...created, dailyLimit: String(created.dailyLimit) }, passkey };
    },

    async status(w: StoredWallet): Promise<EthStatus> {
      const eth = requireEth(w);
      const ctx = await policyContext(w);
      const [onChain, balance] = await Promise.all([onChainRules(client, eth.address, ctx.settings), usdcBalance(client, eth.address)]);
      const sameKey = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();
      return {
        address: eth.address,
        deployed: onChain.deployed,
        balance: String(balance),
        usdcChf: ctx.usdcChf,
        onChain: {
          ...onChain,
          dailyLimit: String(onChain.dailyLimit),
          remainingToday: String(onChain.remainingToday),
          appDailyLimit: String(onChain.appDailyLimit),
          remainingAppToday: String(onChain.remainingAppToday),
        },
        target: { ...ctx.target, dailyLimit: String(ctx.target.dailyLimit), appLimit: String(ctx.target.appLimit) },
        appsSupported: supportsApps(eth),
        rulesUpToDate: syncActions(onChain, ctx.target).length === 0,
        passkeyUpToDate: sameKey(onChain.passkeyX, eth.passkey.x) && sameKey(onChain.passkeyY, eth.passkey.y),
      };
    },

    /**
     * Fills in nonce, gas and, when needed, the account's deployment, then sponsors the operation:
     * Premium, Swissquote pays the gas; Standard, only if the operation pays Swissquote the USDC fee.
     */
    async prepare(w: StoredWallet, { callData, signer }: EthPrepareRequest): Promise<EthPrepared> {
      const eth = requireEth(w);
      const ctx = await policyContext(w);
      const [deployed, nonce, gas] = await Promise.all([
        isDeployed(client, eth.address),
        nonceOf(eth.address),
        gasPrices(),
      ]);
      const op: UserOp = {
        sender: eth.address,
        nonce,
        callData,
        callGasLimit: await callGas(eth.address, callData, deployed),
        verificationGasLimit: deployed ? GAS.verification : GAS.verificationWithDeployment,
        preVerificationGas: GAS.preVerification,
        ...gas,
        ...(deployed ? {} : deployment(ctx.settings)),
        paymaster: DEPLOYMENTS.paymaster,
        paymasterVerificationGasLimit: GAS.paymasterVerification,
        paymasterPostOpGasLimit: GAS.paymasterPostOp,
        paymasterData: "0x",
        signature: "0x",
      };
      const fee = await feeQuote(w.plan, gas.maxFeePerGas);

      let paysSomeone: boolean;
      let paidFee: bigint;
      let review: EthPrepared["review"];
      if (signer === "passkey") {
        let actions;
        try {
          actions = decodeActions(eth.address, callData);
        } catch (err) {
          if (err instanceof UnsupportedCallError) throw new PolicyError(err.message);
          throw err;
        }
        const [action] = actions;
        const faceIdAlone = actions.length === 1 && (action.kind === "payContact" || (action.kind === "useApp" && !action.checked));
        if (!faceIdAlone) throw new PolicyError("Face ID alone can only pay an approved contact or use an approved app.");
        if (deployed) await preflight(eth.address, callData);
        // Approved apps are sponsored on both plans in this prototype: there is no fee field to pay from.
        paysSomeone = action.kind === "payContact";
        paidFee = action.kind === "payContact" ? action.fee : 0n;
      } else {
        const checked = reviewEthOp(op, ctx);
        if (checked.shield?.verdict === "BLOCKED") throw new PolicyError(checked.shield.reasons.join(" "));
        paysSomeone = Boolean(checked.payment);
        paidFee = checked.fee;
        review = checked.shield;
      }

      if (w.plan === "standard" && paysSomeone && paidFee < BigInt(fee.feeUsdc)) {
        throw new PolicyError(`On the Standard plan this operation must pay the network fee (${formatUsdc(BigInt(fee.feeUsdc))}).`);
      }
      if (w.plan === "premium" && sponsoredToday(w.walletId) >= PREMIUM_DAILY_OPS) {
        throw new PolicyError("Swissquote has already paid the network fees of many operations today. Please try again tomorrow.");
      }

      const validUntil = Math.floor(Date.now() / 1000) + SPONSORSHIP_TTL_SECONDS;
      const signature = await wallet.ethAccount.signMessage({ message: { raw: paymasterHash(op, validUntil, 0) } });
      const sponsored: UserOp = { ...op, paymasterData: paymasterData(validUntil, 0, signature) };
      return { userOp: userOpToJson(sponsored), userOpHash: userOpHash(sponsored), fee, review };
    },

    /** The bundler: submits a signed, Swissquote-sponsored operation and reports what really happened. */
    async send(w: StoredWallet, json: unknown): Promise<EthSent> {
      const eth = requireEth(w);
      const op = parseUserOp(json);
      if (!isAddressEqual(op.sender, eth.address)) throw new PolicyError("This operation is not for your safe.");
      if (!op.paymaster || !isAddressEqual(op.paymaster, DEPLOYMENTS.paymaster)) {
        throw new PolicyError("Swissquote only submits operations it sponsors.");
      }
      const hash = userOpHash(op);
      const args = [[toPackedUserOperation(op)], swissquote] as const;

      return exclusive(async () => {
        try {
          await client.simulateContract({ address: ENTRY_POINT, abi: entryPoint09Abi, functionName: "handleOps", args, account: wallet.ethAccount });
        } catch (err) {
          throw new PolicyError(explainRevert(revertData(err)));
        }
        const txHash = await relayer.writeContract({ address: ENTRY_POINT, abi: entryPoint09Abi, functionName: "handleOps", args });
        const receipt = await client.waitForTransactionReceipt({ hash: txHash });
        // The public RPC is load-balanced: wait until it reports the account's new nonce, so that what the
        // app reads next (balance, rules) already includes this operation.
        for (let i = 0; i < 20 && (await nonceOf(op.sender)) <= op.nonce; i++) await new Promise((r) => setTimeout(r, 500));
        const logs = parseEventLogs({ abi: entryPoint09Abi, logs: receipt.logs });
        const event = logs.find((l) => l.eventName === "UserOperationEvent" && l.args.userOpHash === hash);
        const revert = logs.find((l) => l.eventName === "UserOperationRevertReason" && l.args.userOpHash === hash);
        const success = receipt.status === "success" && event?.eventName === "UserOperationEvent" && event.args.success;

        db.prepare("INSERT OR REPLACE INTO eth_ops (user_op_hash, wallet_id, tx_hash, success, sponsored) VALUES (?, ?, ?, ?, ?)").run(
          hash,
          w.walletId,
          txHash,
          success ? 1 : 0,
          w.plan === "premium" ? 1 : 0,
        );
        const reason = success
          ? undefined
          : revert?.eventName === "UserOperationRevertReason"
            ? explainRevert(revert.args.revertReason)
            : "The network did not carry out this operation.";
        return { txHash, userOpHash: hash, success, reason };
      });
    },

    /** Demo: USDC from Swissquote's wallet (the mock Swissquote account) to a client's safe. */
    sendUsdc(to: Address, amount: bigint): Promise<Hex> {
      return exclusive(async () => {
        const held = await usdcBalance(client, swissquote);
        if (held < amount) {
          throw new PolicyError(
            `The demo Swissquote account holds only ${formatUsdc(held)}. Choose a smaller amount, or get more test USDC for it at faucet.circle.com (Base Sepolia).`,
          );
        }
        const txHash = await relayer.writeContract({ address: USDC.address, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
        const receipt = await client.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new PolicyError(`The transfer failed: ${explorer.baseTx(txHash)}`);
        return txHash;
      });
    },

    /**
     * Demo: collects the mock family's test USDC back into Swissquote's wallet, so it keeps circulating.
     * The family wallets hold no ETH: each signs a USDC transfer authorization that Swissquote submits.
     */
    async collectUsdc(holders: PrivateKeyAccount[]): Promise<Hex[]> {
      const hashes: Hex[] = [];
      for (const holder of holders) {
        const value = await usdcBalance(client, holder.address);
        if (value === 0n) continue;
        const message = {
          from: holder.address,
          to: swissquote,
          value,
          validAfter: 0n,
          validBefore: BigInt(Math.floor(Date.now() / 1000) + 3_600),
          nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
        };
        const signature = await holder.signTypedData({
          domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: USDC.address },
          types: {
            TransferWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          primaryType: "TransferWithAuthorization",
          message,
        });
        const { r, s, v } = parseSignature(signature);
        hashes.push(
          await exclusive(async () => {
            const hash = await relayer.writeContract({
              address: USDC.address,
              abi: transferWithAuthorizationAbi,
              functionName: "transferWithAuthorization",
              args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, Number(v), r, s],
            });
            await client.waitForTransactionReceipt({ hash });
            return hash;
          }),
        );
      }
      return hashes;
    },

    /** Demo: what Swissquote's wallet holds on Base, and the paymaster's gas deposit. */
    async demoAccount() {
      const [eth, usdc, deposit] = await Promise.all([
        client.getBalance({ address: swissquote }),
        usdcBalance(client, swissquote),
        client.readContract({ address: ENTRY_POINT, abi: entryPoint09Abi, functionName: "balanceOf", args: [DEPLOYMENTS.paymaster] }),
      ]);
      return { address: swissquote, eth: String(eth), usdc: String(usdc), paymasterDeposit: String(deposit) };
    },
  };
}

export type BaseService = ReturnType<typeof baseService>;
