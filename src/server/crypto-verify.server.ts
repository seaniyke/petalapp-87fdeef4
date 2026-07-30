/**
 * On-chain verification for crypto checkout submissions.
 *
 * Given a pending `crypto_payments` row, we look the transaction hash up on a
 * public explorer for the right chain and decide whether it:
 *   - doesn't exist yet          → keep waiting
 *   - exists but is unconfirmed  → keep waiting, record confirmations
 *   - is confirmed and pays the right wallet the right USD value → confirm
 *   - is confirmed but pays the wrong wallet / too little        → flag
 *
 * No API keys required — Tronscan, Blockstream and Blockscout are all public.
 * Prices for BTC/ETH come from CoinGecko (USDT is pegged at $1).
 *
 * Server-only: never import this from client code.
 */

export type VerifyOutcome =
  | { kind: "not_found"; note: string }
  | { kind: "pending"; confirmations: number; note: string }
  | { kind: "mismatch"; note: string; detectedUsdCents?: number; confirmations?: number }
  | { kind: "confirmed"; confirmations: number; detectedUsdCents: number; note: string };

export type VerifiablePayment = {
  id: string;
  asset: string;
  chain: string;
  wallet_address: string;
  tx_hash: string;
  usd_amount_cents: number;
};

/** Accept anything within 3% of the invoiced amount (covers network fees / rate drift). */
const TOLERANCE = 0.97;

const MIN_CONFIRMATIONS: Record<string, number> = {
  tron: 19,
  ethereum: 6,
  bitcoin: 2,
};

const UA = { "User-Agent": "PetalBilling/1.0", Accept: "application/json" };

async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** USD spot price for BTC/ETH. USDT is treated as $1. Cached per process. */
let priceCache: { at: number; btc: number; eth: number } | null = null;

export async function fetchSpotPrices(): Promise<{ btc: number; eth: number }> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) {
    return { btc: priceCache.btc, eth: priceCache.eth };
  }
  const data = await getJson<{ bitcoin?: { usd: number }; ethereum?: { usd: number } }>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd",
  );
  const btc = Number(data?.bitcoin?.usd ?? 0);
  const eth = Number(data?.ethereum?.usd ?? 0);
  if (btc > 0 && eth > 0) priceCache = { at: Date.now(), btc, eth };
  return { btc, eth };
}

function chainKey(payment: VerifiablePayment): "tron" | "ethereum" | "bitcoin" | null {
  const c = `${payment.chain} ${payment.asset}`.toLowerCase();
  if (c.includes("tron") || c.includes("trc")) return "tron";
  if (c.includes("bitcoin") || c.trim().startsWith("btc")) return "bitcoin";
  if (c.includes("ethereum") || c.includes("erc") || c.includes("eth")) return "ethereum";
  return null;
}

function eq(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function decide(
  receivedUsd: number,
  invoicedCents: number,
  confirmations: number,
  minConf: number,
  what: string,
): VerifyOutcome {
  const detectedUsdCents = Math.round(receivedUsd * 100);
  if (detectedUsdCents < Math.floor(invoicedCents * TOLERANCE)) {
    return {
      kind: "mismatch",
      detectedUsdCents,
      confirmations,
      note: `Underpaid: received ~$${(detectedUsdCents / 100).toFixed(2)} of $${(
        invoicedCents / 100
      ).toFixed(2)} (${what}).`,
    };
  }
  if (confirmations < minConf) {
    return {
      kind: "pending",
      confirmations,
      note: `Seen on-chain — ${confirmations}/${minConf} confirmations.`,
    };
  }
  return {
    kind: "confirmed",
    confirmations,
    detectedUsdCents,
    note: `Confirmed on-chain (${what}, ${confirmations} confirmations).`,
  };
}

// ---------------------------------------------------------------- TRON

type TronscanTx = {
  contractRet?: string;
  confirmed?: boolean;
  confirmations?: number;
  toAddress?: string;
  contractData?: { amount?: number };
  tokenTransferInfo?: {
    to_address?: string;
    amount_str?: string;
    decimals?: number;
    symbol?: string;
  };
  trc20TransferInfo?: Array<{
    to_address?: string;
    amount_str?: string;
    decimals?: number;
    symbol?: string;
  }>;
};

async function verifyTron(p: VerifiablePayment): Promise<VerifyOutcome> {
  const tx = await getJson<TronscanTx>(
    `https://apilist.tronscanapi.com/api/transaction-info?hash=${encodeURIComponent(p.tx_hash)}`,
  );
  if (!tx || (!tx.tokenTransferInfo && !tx.trc20TransferInfo?.length && !tx.contractRet)) {
    return { kind: "not_found", note: "Transaction not visible on TRON yet." };
  }
  if (tx.contractRet && tx.contractRet !== "SUCCESS") {
    return { kind: "mismatch", note: `TRON reports the transaction as ${tx.contractRet}.` };
  }

  const transfers = [
    ...(tx.tokenTransferInfo ? [tx.tokenTransferInfo] : []),
    ...(tx.trc20TransferInfo ?? []),
  ];
  const match = transfers.find((t) => t.to_address && eq(t.to_address, p.wallet_address));
  if (!match) {
    return {
      kind: "mismatch",
      note: "That transaction doesn't pay Petal's TRON address.",
    };
  }

  const decimals = Number(match.decimals ?? 6);
  const amount = Number(match.amount_str ?? 0) / Math.pow(10, decimals);
  const confirmations = tx.confirmed ? Math.max(tx.confirmations ?? 0, 19) : tx.confirmations ?? 0;
  return decide(amount, p.usd_amount_cents, confirmations, MIN_CONFIRMATIONS.tron, "USDT TRC-20");
}

// ------------------------------------------------------------ ETHEREUM

type BlockscoutTx = {
  status?: string;
  result?: string;
  confirmations?: number;
  value?: string;
  to?: { hash?: string };
};

type BlockscoutTransfers = {
  items?: Array<{
    to?: { hash?: string };
    total?: { value?: string; decimals?: string | number };
    token?: { symbol?: string };
  }>;
};

async function verifyEthereum(p: VerifiablePayment): Promise<VerifyOutcome> {
  const base = "https://eth.blockscout.com/api/v2/transactions";
  const tx = await getJson<BlockscoutTx>(`${base}/${encodeURIComponent(p.tx_hash)}`);
  if (!tx) return { kind: "not_found", note: "Transaction not visible on Ethereum yet." };
  if (tx.status && tx.status !== "ok") {
    return { kind: "mismatch", note: "That Ethereum transaction failed on-chain." };
  }
  const confirmations = Number(tx.confirmations ?? 0);
  const prices = await fetchSpotPrices();
  const isStable = p.asset.toUpperCase() === "USDT";

  if (isStable) {
    const tr = await getJson<BlockscoutTransfers>(
      `${base}/${encodeURIComponent(p.tx_hash)}/token-transfers`,
    );
    const match = (tr?.items ?? []).find(
      (i) => i.to?.hash && eq(i.to.hash, p.wallet_address),
    );
    if (!match) {
      return { kind: "mismatch", note: "That transaction doesn't pay Petal's ERC-20 address." };
    }
    const decimals = Number(match.total?.decimals ?? 6);
    const amount = Number(match.total?.value ?? 0) / Math.pow(10, decimals);
    return decide(amount, p.usd_amount_cents, confirmations, MIN_CONFIRMATIONS.ethereum, "USDT ERC-20");
  }

  if (!tx.to?.hash || !eq(tx.to.hash, p.wallet_address)) {
    return { kind: "mismatch", note: "That transaction doesn't pay Petal's ETH address." };
  }
  if (!prices.eth) {
    return { kind: "pending", confirmations, note: "Waiting on an ETH price quote." };
  }
  const ether = Number(tx.value ?? 0) / 1e18;
  return decide(
    ether * prices.eth,
    p.usd_amount_cents,
    confirmations,
    MIN_CONFIRMATIONS.ethereum,
    `${ether.toFixed(6)} ETH`,
  );
}

// ------------------------------------------------------------- BITCOIN

type BlockstreamTx = {
  vout?: Array<{ scriptpubkey_address?: string; value?: number }>;
  status?: { confirmed?: boolean; block_height?: number };
};

async function verifyBitcoin(p: VerifiablePayment): Promise<VerifyOutcome> {
  const tx = await getJson<BlockstreamTx>(
    `https://blockstream.info/api/tx/${encodeURIComponent(p.tx_hash)}`,
  );
  if (!tx?.vout) return { kind: "not_found", note: "Transaction not visible on Bitcoin yet." };

  const sats = tx.vout
    .filter((o) => o.scriptpubkey_address && eq(o.scriptpubkey_address, p.wallet_address))
    .reduce((s, o) => s + Number(o.value ?? 0), 0);
  if (sats <= 0) {
    return { kind: "mismatch", note: "That transaction doesn't pay Petal's BTC address." };
  }

  let confirmations = 0;
  if (tx.status?.confirmed && tx.status.block_height) {
    const tipRaw = await fetch("https://blockstream.info/api/blocks/tip/height", { headers: UA })
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null);
    const tip = Number(tipRaw ?? 0);
    confirmations = tip > 0 ? Math.max(1, tip - tx.status.block_height + 1) : 1;
  }

  const prices = await fetchSpotPrices();
  if (!prices.btc) {
    return { kind: "pending", confirmations, note: "Waiting on a BTC price quote." };
  }
  const btc = sats / 1e8;
  return decide(
    btc * prices.btc,
    p.usd_amount_cents,
    confirmations,
    MIN_CONFIRMATIONS.bitcoin,
    `${btc.toFixed(8)} BTC`,
  );
}

/** Look a submitted transaction up on its chain and decide what to do next. */
export async function verifyCryptoPayment(p: VerifiablePayment): Promise<VerifyOutcome> {
  const chain = chainKey(p);
  if (!chain) {
    return { kind: "mismatch", note: `Unsupported chain: ${p.chain}.` };
  }
  try {
    if (chain === "tron") return await verifyTron(p);
    if (chain === "bitcoin") return await verifyBitcoin(p);
    return await verifyEthereum(p);
  } catch (e) {
    return {
      kind: "not_found",
      note: `Explorer lookup failed: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }
}
