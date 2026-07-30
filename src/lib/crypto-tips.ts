/**
 * Crypto wallets Petal accepts coffee tips on.
 *
 * These are public receiving addresses — safe to ship in the client bundle.
 * Replace the placeholders with the real wallets; any entry left as an empty
 * string is automatically hidden from the /coffee page.
 */

export type CryptoWallet = {
  /** Stable id stored on the tip row. */
  id: string;
  /** Asset shown to the supporter, e.g. "USDT". */
  asset: string;
  /** Network the address lives on, e.g. "TRON (TRC-20)". */
  network: string;
  /** Public receiving address. Empty string = not configured yet. */
  address: string;
  /** Optional memo/tag some chains require. */
  memo?: string;
};

export const CRYPTO_WALLETS: CryptoWallet[] = [
  { id: "usdt-trc20", asset: "USDT", network: "TRON (TRC-20)", address: "" },
  { id: "usdt-erc20", asset: "USDT", network: "Ethereum (ERC-20)", address: "" },
  { id: "usdt-bep20", asset: "USDT", network: "BNB Smart Chain (BEP-20)", address: "" },
  { id: "btc", asset: "BTC", network: "Bitcoin", address: "" },
  { id: "eth", asset: "ETH", network: "Ethereum", address: "" },
  { id: "sol", asset: "SOL", network: "Solana", address: "" },
];

export const ACTIVE_WALLETS = CRYPTO_WALLETS.filter((w) => w.address.trim().length > 0);

/** QR image for a wallet address (no extra dependency needed). */
export function qrUrl(address: string, size = 200) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(
    address,
  )}`;
}
