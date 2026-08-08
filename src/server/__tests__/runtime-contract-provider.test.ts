import assert from "node:assert/strict";
import { enforceRuntimeContracts } from "../runtime-contract.server";

const missingProvider = [
  {
    path: "src/App.tsx",
    content: `import { CartContext } from "./cart";
export default function App() { return (<main>Store</main>); }`,
  },
  {
    path: "src/cart.tsx",
    content: `import { createContext, useContext } from "react";
export const CartContext = createContext<CartState | undefined>(undefined);
export const useCart = () => useContext(CartContext);`,
  },
];

const missingResult = enforceRuntimeContracts(missingProvider);
assert.equal(missingResult.providersWrapped.length, 0);
assert.doesNotMatch(
  missingResult.files.find((file) => file.path === "src/App.tsx")?.content ?? "",
  /Provider\s+value=\{undefined as any\}/,
  "runtime repair must never invent an undefined context value",
);

const realProvider = [
  {
    path: "src/App.tsx",
    content: `import { CartProvider } from "./cart";
export default function App() { return (<CartProvider><main>Store</main></CartProvider>); }`,
  },
  {
    path: "src/cart.tsx",
    content: `import { createContext } from "react";
export const CartContext = createContext({ items: [] as string[] });
export function CartProvider({ children }: { children: React.ReactNode }) {
  return <CartContext.Provider value={{ items: [] }}>{children}</CartContext.Provider>;
}`,
  },
];

const realResult = enforceRuntimeContracts(realProvider);
assert.equal(realResult.providersWrapped.length, 0);
assert.equal(
  realResult.files.find((file) => file.path === "src/App.tsx")?.content,
  realProvider[0].content,
  "an existing stateful provider must remain the sole provider",
);

console.log("runtime-contract-provider: all assertions passed");