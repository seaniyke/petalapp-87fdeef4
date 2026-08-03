import { strict as assert } from "node:assert";
import { enforceLayoutHygiene } from "../layout-hygiene.server";

const out = enforceLayoutHygiene([
  {
    path: "src/components/sections/Hero.tsx",
    content: `export default function Hero(){return (
  <section className="relative h-screen flex items-center">
    <div className="absolute inset-0 bg-black/50" />
    <h1 className="text-8xl font-bold">Find a place that fits</h1>
  </section>);}`,
  },
  {
    path: "src/components/SiteHeader.tsx",
    content: `export const H = () => <header className="fixed top-0 w-full z-50 px-4">hi</header>;`,
  },
  {
    path: "src/App.tsx",
    content: `export default () => <div className="min-h-screen bg-background">x</div>;`,
  },
]);

const hero = out.files[0].content;
assert.ok(!hero.includes("h-screen"), "hero must not stay viewport-locked");
assert.match(hero, /min-h-\[70svh\][^"]*py-16/);
assert.match(hero, /absolute inset-0 bg-black\/50 pointer-events-none z-0/);
assert.match(hero, /text-5xl sm:text-6xl md:text-7xl lg:text-8xl/);
assert.match(out.files[1].content, /sticky top-0/);
assert.match(out.files[2].content, /min-h-screen/, "page shell keeps full height");
console.log("layout-hygiene ok", out.notes);
