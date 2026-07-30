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
  {
    id: "usdt-trc20",
    asset: "USDT",
    network: "TRON (TRC-20)",
    address: "TDz6CcbY6AcZa52gaPAabeJVE6FyfrgPTw",
  },
  {
    id: "usdt-erc20",
    asset: "USDT",
    network: "Ethereum (ERC-20)",
    address: "0x0380b3d109be405091A6BD2F20A060e457e240dE",
  },
  {
    id: "btc",
    asset: "BTC",
    network: "Bitcoin",
    address: "bc1qxedh2rmv3jkw6legcmdjkd4ynpleqghkd07rn6",
  },
  {
    id: "eth",
    asset: "ETH",
    network: "Ethereum",
    address: "0x0380b3d109be405091A6BD2F20A060e457e240dE",
  },
];


export const ACTIVE_WALLETS = CRYPTO_WALLETS.filter((w) => w.address.trim().length > 0);

/** QR image for a wallet address (no extra dependency needed). */
export function qrUrl(address: string, size = 200) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(
    address,
  )}`;
}
