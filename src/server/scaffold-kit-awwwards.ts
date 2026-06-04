/**
 * Phase 16 — Awwwards layer (opt-in, heavy).
 *
 * None of these packages ship in REQUIRED_DEPS — they are pulled on demand
 * when a file imports them. Use them when the project vibe explicitly calls
 * for cinematic motion / 3D / interactive showcases (creative agencies,
 * product launches, portfolios, awards-grade landings).
 *
 *   - @/components/three/scene           R3F <Canvas> wrapper + lights + camera
 *   - @/components/three/floating-mesh   drei <Float> hero mesh (icosahedron/torus/box)
 *   - @/components/three/hero-sphere     distorted-material gradient sphere
 *   - @/components/three/spline-embed    Spline iframe + lazy mount
 *   - @/components/scroll/lenis-provider client-only smooth-scroll provider
 *   - @/hooks/use-scroll-scene           GSAP + ScrollTrigger scoped hook
 *   - @/hooks/use-horizontal-scroll      GSAP horizontal pin-scroll
 *   - @/lib/confetti                     canvas-confetti success helpers
 *   - @/lib/view-transitions             View Transitions API wrapper
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// ---------------------------------------------------------------------------
// R3F base Scene
// ---------------------------------------------------------------------------
const SCENE = `import * as React from "react";
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Environment, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { cn } from "@/lib/utils";

export interface SceneProps extends Omit<CanvasProps, "children"> {
  children: React.ReactNode;
  controls?: boolean;
  environment?: "studio" | "city" | "sunset" | "night" | "warehouse" | "forest" | "apartment" | "park" | "lobby" | "dawn" | null;
  cameraPosition?: [number, number, number];
  fov?: number;
  className?: string;
}

/**
 * Opinionated <Canvas> wrapper. Adds sensible lighting + camera + optional
 * orbit controls + HDRI environment. Use as the root of any 3D scene.
 *
 *   <Scene environment="studio" cameraPosition={[0, 0, 6]}>
 *     <FloatingMesh shape="icosahedron" />
 *   </Scene>
 */
export function Scene({
  children, controls = false, environment = "city",
  cameraPosition = [0, 0, 5], fov = 45, className, ...rest
}: SceneProps) {
  return (
    <Canvas
      className={cn("h-full w-full", className)}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      {...rest}
    >
      <PerspectiveCamera makeDefault position={cameraPosition} fov={fov} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-5, -3, -5]} intensity={0.3} />
      {environment && <Environment preset={environment} />}
      {children}
      {controls && <OrbitControls enablePan={false} enableZoom={false} />}
    </Canvas>
  );
}
`;

// ---------------------------------------------------------------------------
// Floating mesh — hero centerpiece
// ---------------------------------------------------------------------------
const FLOATING_MESH = `import * as React from "react";
import { Float, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

export interface FloatingMeshProps {
  shape?: "icosahedron" | "torus" | "torusKnot" | "box" | "sphere";
  color?: string;
  distort?: number;
  speed?: number;
  scale?: number;
  wireframe?: boolean;
}

/**
 * Hero centerpiece mesh that gently floats + rotates. Wrapped in drei's
 * <Float> so it has organic motion without a manual useFrame loop.
 *
 *   <Scene><FloatingMesh shape="torusKnot" color="#a855f7" distort={0.4} /></Scene>
 */
export function FloatingMesh({
  shape = "icosahedron", color = "#8b5cf6", distort = 0.3, speed = 1.4,
  scale = 1.6, wireframe = false,
}: FloatingMeshProps) {
  const geo = React.useMemo(() => {
    switch (shape) {
      case "torus":     return new THREE.TorusGeometry(1, 0.35, 32, 96);
      case "torusKnot": return new THREE.TorusKnotGeometry(0.9, 0.32, 128, 32);
      case "box":       return new THREE.BoxGeometry(1.4, 1.4, 1.4, 4, 4, 4);
      case "sphere":    return new THREE.SphereGeometry(1, 64, 64);
      default:          return new THREE.IcosahedronGeometry(1.2, 4);
    }
  }, [shape]);

  return (
    <Float floatIntensity={1.2} rotationIntensity={0.8} speed={speed}>
      <mesh geometry={geo} scale={scale}>
        <MeshDistortMaterial
          color={color}
          distort={distort}
          speed={speed * 1.5}
          roughness={0.2}
          metalness={0.4}
          wireframe={wireframe}
        />
      </mesh>
    </Float>
  );
}
`;

// ---------------------------------------------------------------------------
// HeroSphere — preset gradient sphere for landing pages
// ---------------------------------------------------------------------------
const HERO_SPHERE = `import * as React from "react";
import { Scene } from "./scene";
import { FloatingMesh } from "./floating-mesh";

/**
 * One-line hero 3D centerpiece. Drop into any hero section:
 *
 *   <div className="relative h-[480px] w-full">
 *     <HeroSphere color="oklch(0.65 0.2 280)" />
 *   </div>
 *
 * Uses absolute positioning so it can sit behind text content.
 */
export function HeroSphere({ color = "#8b5cf6", shape = "icosahedron" as const }: { color?: string; shape?: "icosahedron" | "torusKnot" | "sphere" }) {
  return (
    <Scene environment="studio" cameraPosition={[0, 0, 5]} className="!absolute inset-0">
      <FloatingMesh shape={shape} color={color} distort={0.4} speed={1.4} scale={1.7} />
    </Scene>
  );
}
`;

// ---------------------------------------------------------------------------
// Spline embed — fastest path to 3D for non-coders
// ---------------------------------------------------------------------------
const SPLINE_EMBED = `import * as React from "react";
import { cn } from "@/lib/utils";

const Spline = React.lazy(() => import("@splinetool/react-spline"));

export interface SplineEmbedProps {
  scene: string; // a public Spline scene URL (e.g. https://prod.spline.design/.../scene.splinecode)
  className?: string;
  fallback?: React.ReactNode;
}

/**
 * Lazy-mounted Spline scene. Use when the designer ships a .splinecode URL
 * — avoids hand-authoring a Three.js scene. Falls back to a neutral
 * shimmer while the runtime loads.
 *
 *   <SplineEmbed scene="https://prod.spline.design/abc/scene.splinecode" className="h-[600px]" />
 */
export function SplineEmbed({ scene, className, fallback }: SplineEmbedProps) {
  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <React.Suspense fallback={fallback ?? <div className="h-full w-full animate-pulse bg-muted" />}>
        <Spline scene={scene} />
      </React.Suspense>
    </div>
  );
}
`;

// ---------------------------------------------------------------------------
// Lenis smooth-scroll provider
// ---------------------------------------------------------------------------
const LENIS_PROVIDER = `import * as React from "react";
import Lenis from "lenis";

export interface LenisProviderProps {
  children: React.ReactNode;
  /** Disable on mobile / reduced-motion. Defaults to true. */
  respectReducedMotion?: boolean;
  /** Lerp factor — lower = smoother + slower. Default 0.1. */
  lerp?: number;
}

/**
 * Wrap the app root once to enable buttery smooth scrolling. Also exposes
 * the Lenis instance on \`window.__lenis\` so GSAP ScrollTrigger can sync
 * (call \`lenis.on('scroll', ScrollTrigger.update)\`).
 *
 *   <LenisProvider><App /></LenisProvider>
 *
 * Disabled automatically when prefers-reduced-motion is set.
 */
export function LenisProvider({ children, respectReducedMotion = true, lerp = 0.1 }: LenisProviderProps) {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (respectReducedMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ lerp, smoothWheel: true });
    (window as any).__lenis = lenis;
    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      delete (window as any).__lenis;
    };
  }, [lerp, respectReducedMotion]);

  return <>{children}</>;
}
`;

// ---------------------------------------------------------------------------
// useScrollScene — GSAP + ScrollTrigger scoped hook
// ---------------------------------------------------------------------------
const USE_SCROLL_SCENE = `import { useLayoutEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

/**
 * Scoped GSAP context tied to a container ref. Auto-cleans up all tweens
 * and ScrollTriggers on unmount.
 *
 *   const ref = useRef<HTMLDivElement>(null);
 *   useScrollScene(ref, () => {
 *     gsap.from(".reveal", {
 *       y: 60, opacity: 0, stagger: 0.08,
 *       scrollTrigger: { trigger: ".reveal", start: "top 80%" },
 *     });
 *   });
 *   return <div ref={ref}>...<h2 className="reveal">Hello</h2></div>;
 */
export function useScrollScene<T extends HTMLElement>(
  ref: RefObject<T | null>,
  setup: (ctx: gsap.Context) => void,
  deps: ReadonlyArray<unknown> = [],
) {
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context((self) => setup(self), ref.current);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export { gsap, ScrollTrigger };
`;

// ---------------------------------------------------------------------------
// useHorizontalScroll — pinned horizontal scroll section
// ---------------------------------------------------------------------------
const USE_HORIZONTAL_SCROLL = `import { useLayoutEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

/**
 * Pinned horizontal scroll. Wrap a section that contains a wide inner
 * flex/grid and the user's vertical scroll translates the inner track
 * horizontally. Classic Awwwards effect.
 *
 *   const wrap = useRef<HTMLDivElement>(null);
 *   const track = useRef<HTMLDivElement>(null);
 *   useHorizontalScroll(wrap, track);
 *   return (
 *     <section ref={wrap} className="h-screen overflow-hidden">
 *       <div ref={track} className="flex h-full w-max gap-8 p-12">
 *         {items.map(...)}
 *       </div>
 *     </section>
 *   );
 */
export function useHorizontalScroll<W extends HTMLElement, T extends HTMLElement>(
  wrapperRef: RefObject<W | null>,
  trackRef: RefObject<T | null>,
) {
  useLayoutEffect(() => {
    const wrap = wrapperRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;
    const ctx = gsap.context(() => {
      const total = track.scrollWidth - wrap.offsetWidth;
      gsap.to(track, {
        x: -total,
        ease: "none",
        scrollTrigger: {
          trigger: wrap,
          start: "top top",
          end: () => "+=" + total,
          scrub: 1,
          pin: true,
          invalidateOnRefresh: true,
        },
      });
    }, wrap);
    return () => ctx.revert();
  }, [wrapperRef, trackRef]);
}
`;

// ---------------------------------------------------------------------------
// confetti — success-state delight
// ---------------------------------------------------------------------------
const CONFETTI = `import confetti from "canvas-confetti";

/**
 * Quick success confetti burst. Use sparingly — checkout success, signup
 * complete, achievement unlocked. Reads --color-primary / --color-accent
 * if they resolve to a colour the canvas can parse, else falls back.
 *
 *   await checkout(); celebrate();
 */
export function celebrate(opts?: confetti.Options) {
  return confetti({
    particleCount: 120,
    spread: 80,
    startVelocity: 45,
    origin: { y: 0.7 },
    ...opts,
  });
}

/** Two-side cannon burst (left + right). Bigger moment. */
export function celebrateCannons() {
  const duration = 1200;
  const end = Date.now() + duration;
  (function frame() {
    confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0 } });
    confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

/** Subtle, focused burst from a DOM element (e.g. a CTA button). */
export function celebrateFrom(el: Element) {
  const r = el.getBoundingClientRect();
  const x = (r.left + r.width / 2) / window.innerWidth;
  const y = (r.top + r.height / 2) / window.innerHeight;
  return confetti({ particleCount: 80, spread: 70, origin: { x, y } });
}
`;

// ---------------------------------------------------------------------------
// View Transitions API wrapper
// ---------------------------------------------------------------------------
const VIEW_TRANSITIONS = `/**
 * View Transitions API wrapper. Provides cinematic page/route transitions
 * with one line: \`withViewTransition(() => navigate("/about"))\`.
 *
 * Falls back to running the update synchronously on browsers without
 * support. Safari 26 (June 2026) ships full cross-browser support.
 *
 * Add this to src/styles.css for a fade-blur default:
 *   ::view-transition-old(root), ::view-transition-new(root) {
 *     animation-duration: 0.4s; mix-blend-mode: normal;
 *   }
 *   ::view-transition-old(root) { animation-name: vt-fade-out; }
 *   ::view-transition-new(root) { animation-name: vt-fade-in; }
 *   @keyframes vt-fade-out { to { opacity: 0; filter: blur(8px); } }
 *   @keyframes vt-fade-in  { from { opacity: 0; filter: blur(8px); } }
 */
export function withViewTransition(update: () => void | Promise<void>) {
  if (typeof document === "undefined") return update();
  const doc = document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
  };
  if (typeof doc.startViewTransition !== "function") return update();
  return doc.startViewTransition(update).finished;
}

/**
 * React Router helper. Use in place of \`navigate(to)\` for cinematic route
 * transitions:
 *
 *   const navigate = useNavigate();
 *   navigateWithTransition(navigate, "/about");
 */
export function navigateWithTransition(navigate: (to: string) => void, to: string) {
  return withViewTransition(() => navigate(to));
}
`;

export const KIT_AWWWARDS_FILES: KitFile[] = [
  // 3D
  { path: "src/components/three/scene.tsx", content: SCENE, overwrite: true },
  { path: "src/components/three/floating-mesh.tsx", content: FLOATING_MESH, overwrite: true },
  { path: "src/components/three/hero-sphere.tsx", content: HERO_SPHERE, overwrite: true },
  { path: "src/components/three/spline-embed.tsx", content: SPLINE_EMBED, overwrite: true },
  // Smooth scroll + scroll-driven motion
  { path: "src/components/scroll/lenis-provider.tsx", content: LENIS_PROVIDER, overwrite: true },
  { path: "src/hooks/use-scroll-scene.ts", content: USE_SCROLL_SCENE, overwrite: true },
  { path: "src/hooks/use-horizontal-scroll.ts", content: USE_HORIZONTAL_SCROLL, overwrite: true },
  // Delight + route transitions
  { path: "src/lib/confetti.ts", content: CONFETTI, overwrite: true },
  { path: "src/lib/view-transitions.ts", content: VIEW_TRANSITIONS, overwrite: true },
];
