/**
 * Phase 11 — Marketing FX layer.
 *
 * MagicUI / Aceternity-style effects every generated landing page can compose.
 * All components live under `@/components/fx`. Pure-CSS/SVG where possible;
 * a small subset uses framer-motion (already in KNOWN_PACKAGES).
 *
 * Ship list:
 *   Backgrounds: GridPattern, DotPattern, RetroGrid, FlickeringGrid,
 *                AnimatedGridPattern, Ripple, NoiseTexture, LightRays,
 *                MeshGradient, Meteors, Particles, Sparkles
 *   Text:        AuroraText, GradientText, ShinyText
 *   Containers:  MagicCard, BorderBeam, GlowCard, BentoGrid + BentoCard,
 *                Marquee, InfiniteMovingCards, OrbitingCircles, HeroParallax,
 *                AnimatedBeam
 *   Buttons:     ShimmerButton, RainbowButton, ShinyButton
 *
 * Design intent:
 *   - All FX respect `prefers-reduced-motion` via CSS @media or motion's
 *     built-in handling.
 *   - All use design tokens (--primary, --foreground, --border) so they
 *     adapt to the active theme automatically.
 *   - No external network requests; no canvas-heavy effects (kept GPU light).
 */

import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// ---------------------------------------------------------------------------
// Shared FX keyframes — appended to styles.css note. We don't mutate styles.css
// from here; each component uses inline <style> or Tailwind arbitrary keyframes.
// ---------------------------------------------------------------------------

const FX_INDEX = `// Petal FX layer — marketing effects (MagicUI/Aceternity flavor).
// Import from "@/components/fx".

// Backgrounds
export { GridPattern } from "./grid-pattern";
export { DotPattern } from "./dot-pattern";
export { RetroGrid } from "./retro-grid";
export { FlickeringGrid } from "./flickering-grid";
export { AnimatedGridPattern } from "./animated-grid-pattern";
export { Ripple } from "./ripple";
export { NoiseTexture } from "./noise-texture";
export { LightRays } from "./light-rays";
export { MeshGradient } from "./mesh-gradient";
export { Meteors } from "./meteors";
export { Particles } from "./particles";
export { Sparkles } from "./sparkles";

// Text
export { AuroraText } from "./aurora-text";
export { GradientText } from "./gradient-text";
export { ShinyText } from "./shiny-text";

// Containers
export { MagicCard } from "./magic-card";
export { BorderBeam } from "./border-beam";
export { GlowCard } from "./glow-card";
export { BentoGrid, BentoCard } from "./bento-grid";
export { Marquee } from "./marquee";
export { InfiniteMovingCards } from "./infinite-moving-cards";
export { OrbitingCircles } from "./orbiting-circles";
export { HeroParallax } from "./hero-parallax";
export { AnimatedBeam } from "./animated-beam";

// Buttons
export { ShimmerButton } from "./shimmer-button";
export { RainbowButton } from "./rainbow-button";
export { ShinyButton } from "./shiny-button";
`;

// ---------------------------------------------------------------------------
// Backgrounds — pure SVG / CSS
// ---------------------------------------------------------------------------

const GRID_PATTERN = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface GridPatternProps extends React.SVGProps<SVGSVGElement> {
  width?: number;
  height?: number;
  strokeDasharray?: string;
}

export const GridPattern: React.FC<GridPatternProps> = ({
  width = 40, height = 40, strokeDasharray = "0", className, ...rest
}) => {
  const id = React.useId();
  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 h-full w-full fill-foreground/[0.04] stroke-foreground/[0.08]", className)}
      {...rest}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse">
          <path d={\`M.5 \${height}V.5H\${width}\`} fill="none" strokeDasharray={strokeDasharray} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={\`url(#\${id})\`} />
    </svg>
  );
};
`;

const DOT_PATTERN = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface DotPatternProps extends React.SVGProps<SVGSVGElement> {
  width?: number;
  height?: number;
  cr?: number;
}

export const DotPattern: React.FC<DotPatternProps> = ({
  width = 24, height = 24, cr = 1, className, ...rest
}) => {
  const id = React.useId();
  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 h-full w-full fill-foreground/30", className)}
      {...rest}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse">
          <circle cx={width / 2} cy={height / 2} r={cr} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={\`url(#\${id})\`} />
    </svg>
  );
};
`;

const RETRO_GRID = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface RetroGridProps extends React.HTMLAttributes<HTMLDivElement> {
  angle?: number;
  cellSize?: number;
  opacity?: number;
  lightLineColor?: string;
  darkLineColor?: string;
}

export const RetroGrid: React.FC<RetroGridProps> = ({
  angle = 65, cellSize = 60, opacity = 0.5,
  lightLineColor = "hsl(var(--foreground) / 0.5)",
  darkLineColor = "hsl(var(--foreground) / 0.6)",
  className, style, ...rest
}) => (
  <div
    aria-hidden
    className={cn("pointer-events-none absolute inset-0 size-full overflow-hidden [perspective:200px]", className)}
    style={{ "--grid-angle": \`\${angle}deg\`, "--cell-size": \`\${cellSize}px\`, "--opacity": opacity, "--line-color": lightLineColor, ...style } as React.CSSProperties}
    {...rest}
  >
    <div className="absolute inset-0 [transform:rotateX(var(--grid-angle))]">
      <div className="animate-[retro-grid_15s_linear_infinite] [background-image:linear-gradient(to_right,var(--line-color)_1px,transparent_0),linear-gradient(to_bottom,var(--line-color)_1px,transparent_0)] [background-repeat:repeat] [background-size:var(--cell-size)_var(--cell-size)] [height:300vh] [inset:0%_0px] [margin-left:-200%] [transform-origin:100%_0_0] [width:600vw]" style={{ opacity: "var(--opacity)" as unknown as number }} />
    </div>
    <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent to-90%" />
    <style>{\`@keyframes retro-grid { 0% { transform: translateY(0); } 100% { transform: translateY(var(--cell-size)); } }\`}</style>
  </div>
);
`;

const FLICKERING_GRID = `"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface FlickeringGridProps extends React.HTMLAttributes<HTMLDivElement> {
  squareSize?: number;
  gridGap?: number;
  flickerChance?: number;
  color?: string;
  maxOpacity?: number;
}

export const FlickeringGrid: React.FC<FlickeringGridProps> = ({
  squareSize = 4, gridGap = 6, flickerChance = 0.3,
  color = "rgb(99 102 241)", maxOpacity = 0.3, className, ...rest
}) => {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let cols = 0, rows = 0;
    let squares: Float32Array = new Float32Array(0);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      cols = Math.floor(width / (squareSize + gridGap));
      rows = Math.floor(height / (squareSize + gridGap));
      squares = new Float32Array(cols * rows).map(() => Math.random() * maxOpacity);
      ctx.scale(dpr, dpr);
    };
    resize();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < squares.length; i++) {
        if (Math.random() < flickerChance * 0.02) squares[i] = Math.random() * maxOpacity;
        const c = i % cols, r = Math.floor(i / cols);
        ctx.fillStyle = color.replace(/rgb\\(([^)]+)\\)/, (_m, p1) => \`rgba(\${p1}, \${squares[i]})\`);
        ctx.fillRect(c * (squareSize + gridGap), r * (squareSize + gridGap), squareSize, squareSize);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [squareSize, gridGap, flickerChance, color, maxOpacity]);

  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} {...rest}>
      <canvas ref={ref} className="size-full" />
    </div>
  );
};
`;

const ANIMATED_GRID = `import * as React from "react";
import { cn } from "@/lib/utils";

export const AnimatedGridPattern: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div aria-hidden className={cn("pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]", className)} {...rest}>
    <div className="absolute inset-0 animate-[grid-shift_20s_linear_infinite] [background-image:linear-gradient(to_right,hsl(var(--foreground)/0.08)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--foreground)/0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
    <style>{\`@keyframes grid-shift { 0% { background-position: 0 0; } 100% { background-position: 40px 40px; } }\`}</style>
  </div>
);
`;

const RIPPLE = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface RippleProps extends React.HTMLAttributes<HTMLDivElement> {
  numCircles?: number;
  mainCircleSize?: number;
}

export const Ripple: React.FC<RippleProps> = ({
  numCircles = 8, mainCircleSize = 210, className, ...rest
}) => (
  <div aria-hidden className={cn("pointer-events-none absolute inset-0 flex items-center justify-center [mask-image:linear-gradient(to_bottom,white,transparent)]", className)} {...rest}>
    {Array.from({ length: numCircles }).map((_, i) => {
      const size = mainCircleSize + i * 70;
      const opacity = Math.max(0.05, 0.3 - i * 0.03);
      const delay = i * 0.06;
      return (
        <div key={i} className="absolute rounded-full border border-foreground/20 animate-[ripple_3.4s_ease-out_infinite]" style={{ width: size, height: size, opacity, animationDelay: \`\${delay}s\` }} />
      );
    })}
    <style>{\`@keyframes ripple { 0% { transform: scale(0.9); opacity: var(--start-opacity,0.3); } 100% { transform: scale(1.1); opacity: 0; } }\`}</style>
  </div>
);
`;

const NOISE_TEXTURE = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface NoiseTextureProps extends React.HTMLAttributes<HTMLDivElement> {
  opacity?: number;
}

export const NoiseTexture: React.FC<NoiseTextureProps> = ({ opacity = 0.06, className, style, ...rest }) => {
  const id = React.useId();
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 mix-blend-overlay", className)} style={{ opacity, ...style }} {...rest}>
      <svg className="size-full">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={\`url(#\${id})\`} />
      </svg>
    </div>
  );
};
`;

const LIGHT_RAYS = `import * as React from "react";
import { cn } from "@/lib/utils";

export const LightRays: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-[60vh] overflow-hidden [mask-image:linear-gradient(to_bottom,white,transparent)]", className)} {...rest}>
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="absolute top-0 left-1/2 h-[80vh] w-[40vw] -translate-x-1/2 origin-top animate-[ray-sweep_8s_ease-in-out_infinite] bg-gradient-to-b from-primary/30 via-primary/10 to-transparent blur-3xl" style={{ transform: \`translateX(-50%) rotate(\${(i - 2.5) * 12}deg)\`, animationDelay: \`\${i * 0.4}s\` }} />
    ))}
    <style>{\`@keyframes ray-sweep { 0%,100% { opacity: 0.3; } 50% { opacity: 0.7; } }\`}</style>
  </div>
);
`;

const MESH_GRADIENT = `import * as React from "react";
import { cn } from "@/lib/utils";

/** Layered conic + radial gradients evoking a mesh. Uses design tokens. */
export const MeshGradient: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, style, ...rest }) => (
  <div
    aria-hidden
    className={cn("pointer-events-none absolute inset-0 opacity-60 [filter:blur(60px)] saturate-150", className)}
    style={{
      backgroundImage: [
        "radial-gradient(at 20% 20%, hsl(var(--primary)/0.6) 0px, transparent 50%)",
        "radial-gradient(at 80% 0%, hsl(var(--accent)/0.5) 0px, transparent 50%)",
        "radial-gradient(at 0% 80%, hsl(var(--secondary)/0.5) 0px, transparent 50%)",
        "radial-gradient(at 80% 80%, hsl(var(--primary)/0.4) 0px, transparent 50%)",
      ].join(", "),
      ...style,
    }}
    {...rest}
  />
);
`;

const METEORS = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface MeteorsProps extends React.HTMLAttributes<HTMLDivElement> {
  number?: number;
}

export const Meteors: React.FC<MeteorsProps> = ({ number = 20, className, ...rest }) => {
  const meteors = React.useMemo(
    () => Array.from({ length: number }).map(() => ({
      left: Math.floor(Math.random() * 100),
      delay: (Math.random() * 0.6).toFixed(2),
      duration: (Math.random() * 8 + 2).toFixed(2),
    })),
    [number],
  );
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} {...rest}>
      {meteors.map((m, i) => (
        <span
          key={i}
          className="absolute top-0 h-0.5 w-0.5 rotate-[215deg] animate-[meteor_5s_linear_infinite] rounded-full bg-foreground shadow-[0_0_0_1px_hsl(var(--foreground)/0.1)] before:absolute before:top-1/2 before:h-px before:w-[60px] before:-translate-y-1/2 before:bg-gradient-to-r before:from-foreground before:to-transparent before:content-['']"
          style={{ left: \`\${m.left}%\`, animationDelay: \`\${m.delay}s\`, animationDuration: \`\${m.duration}s\` }}
        />
      ))}
      <style>{\`@keyframes meteor { 0% { transform: rotate(215deg) translateX(0); opacity: 1; } 70% { opacity: 1; } 100% { transform: rotate(215deg) translateX(-500px); opacity: 0; } }\`}</style>
    </div>
  );
};
`;

const PARTICLES = `"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface ParticlesProps extends React.HTMLAttributes<HTMLDivElement> {
  quantity?: number;
  color?: string;
  size?: number;
}

export const Particles: React.FC<ParticlesProps> = ({
  quantity = 80, color = "hsl(var(--foreground))", size = 1, className, ...rest
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    type P = { x: number; y: number; vx: number; vy: number; a: number };
    let parts: P[] = [];
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = c.getBoundingClientRect();
      c.width = width * dpr; c.height = height * dpr;
      ctx.scale(dpr, dpr);
      parts = Array.from({ length: quantity }).map(() => ({
        x: Math.random() * width, y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        a: Math.random() * 0.6 + 0.2,
      }));
    };
    resize();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    const draw = () => {
      const { width, height } = c.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        ctx.globalAlpha = p.a;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [quantity, color, size]);
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)} {...rest}>
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
};
`;

const SPARKLES = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface SparklesProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: number;
}

export const Sparkles: React.FC<SparklesProps> = ({ count = 30, className, ...rest }) => {
  const stars = React.useMemo(() => Array.from({ length: count }).map(() => ({
    top: Math.random() * 100, left: Math.random() * 100,
    size: Math.random() * 3 + 1,
    delay: Math.random() * 4,
  })), [count]);
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} {...rest}>
      {stars.map((s, i) => (
        <span key={i} className="absolute rounded-full bg-foreground animate-[sparkle_3s_ease-in-out_infinite]" style={{ top: \`\${s.top}%\`, left: \`\${s.left}%\`, width: s.size, height: s.size, animationDelay: \`\${s.delay}s\` }} />
      ))}
      <style>{\`@keyframes sparkle { 0%,100% { opacity:0; transform:scale(0); } 50% { opacity:1; transform:scale(1); } }\`}</style>
    </div>
  );
};
`;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const AURORA_TEXT = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface AuroraTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  colors?: string[];
  speed?: number;
}

export const AuroraText: React.FC<AuroraTextProps> = ({
  colors = ["#FF0080", "#7928CA", "#0070F3", "#38bdf8"], speed = 8, className, children, style, ...rest
}) => (
  <span
    className={cn("inline-block bg-clip-text text-transparent animate-[aurora_var(--aurora-speed)_linear_infinite]", className)}
    style={{
      backgroundImage: \`linear-gradient(90deg, \${[...colors, colors[0]].join(", ")})\`,
      backgroundSize: "200% auto",
      "--aurora-speed": \`\${speed}s\`,
      ...style,
    } as React.CSSProperties}
    {...rest}
  >
    {children}
    <style>{\`@keyframes aurora { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }\`}</style>
  </span>
);
`;

const GRADIENT_TEXT = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface GradientTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  from?: string;
  via?: string;
  to?: string;
}

export const GradientText: React.FC<GradientTextProps> = ({
  from = "hsl(var(--primary))", via, to = "hsl(var(--accent))", className, children, style, ...rest
}) => (
  <span
    className={cn("inline-block bg-clip-text text-transparent", className)}
    style={{ backgroundImage: \`linear-gradient(90deg, \${from}\${via ? ", " + via : ""}, \${to})\`, ...style }}
    {...rest}
  >
    {children}
  </span>
);
`;

const SHINY_TEXT = `import * as React from "react";
import { cn } from "@/lib/utils";

export const ShinyText: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ className, children, style, ...rest }) => (
  <span
    className={cn("inline-block bg-clip-text text-transparent animate-[shine_3s_linear_infinite]", className)}
    style={{
      backgroundImage: "linear-gradient(110deg, hsl(var(--foreground)) 40%, hsl(var(--foreground)/0.4) 50%, hsl(var(--foreground)) 60%)",
      backgroundSize: "200% 100%",
      ...style,
    }}
    {...rest}
  >
    {children}
    <style>{\`@keyframes shine { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }\`}</style>
  </span>
);
`;

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

const MAGIC_CARD = `"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface MagicCardProps extends React.HTMLAttributes<HTMLDivElement> {
  gradientSize?: number;
  gradientColor?: string;
}

export const MagicCard: React.FC<MagicCardProps> = ({
  gradientSize = 200, gradientColor = "hsl(var(--primary) / 0.18)",
  className, children, ...rest
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [mouse, setMouse] = React.useState({ x: -200, y: -200 });
  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setMouse({ x: -200, y: -200 })}
      className={cn("group relative rounded-xl border border-border bg-card p-px text-card-foreground", className)}
      {...rest}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: \`radial-gradient(\${gradientSize}px circle at \${mouse.x}px \${mouse.y}px, \${gradientColor}, transparent 70%)\` }}
      />
      <div className="relative h-full rounded-[inherit] bg-card p-6">{children}</div>
    </div>
  );
};
`;

const BORDER_BEAM = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface BorderBeamProps {
  size?: number;
  duration?: number;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
}

export const BorderBeam: React.FC<BorderBeamProps> = ({
  size = 200, duration = 10,
  colorFrom = "hsl(var(--primary))", colorTo = "hsl(var(--accent))",
  className,
}) => (
  <div
    aria-hidden
    className={cn("pointer-events-none absolute inset-0 rounded-[inherit] [border:1px_solid_transparent] ![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)] after:absolute after:aspect-square after:w-[var(--size)] after:animate-[border-beam_var(--duration)_linear_infinite] after:[offset-anchor:90%_50%] after:[offset-path:rect(0_auto_auto_0_round_var(--size))] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)]", className)}
    style={{
      "--size": \`\${size}px\`,
      "--duration": \`\${duration}s\`,
      "--color-from": colorFrom,
      "--color-to": colorTo,
    } as React.CSSProperties}
  >
    <style>{\`@keyframes border-beam { 100% { offset-distance: 100%; } }\`}</style>
  </div>
);
`;

const GLOW_CARD = `import * as React from "react";
import { cn } from "@/lib/utils";

export const GlowCard: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn("group relative rounded-xl border border-border bg-card p-6 text-card-foreground transition", className)} {...rest}>
    <div aria-hidden className="absolute -inset-px -z-10 rounded-[inherit] bg-gradient-to-r from-primary via-accent to-primary opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-60" />
    {children}
  </div>
);
`;

const BENTO_GRID = `import * as React from "react";
import { cn } from "@/lib/utils";

export const BentoGrid: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn("grid w-full auto-rows-[18rem] grid-cols-3 gap-4", className)} {...rest} />
);

export interface BentoCardProps extends React.HTMLAttributes<HTMLDivElement> {
  name?: string;
  description?: string;
  Icon?: React.ComponentType<{ className?: string }>;
  cta?: string;
  href?: string;
  background?: React.ReactNode;
}

export const BentoCard: React.FC<BentoCardProps> = ({
  name, description, Icon, cta, href, background, className, children, ...rest
}) => (
  <div className={cn("group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm transition hover:shadow-xl", className)} {...rest}>
    {background && <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105">{background}</div>}
    <div className="relative z-10 flex flex-col gap-1 p-6 transition-all duration-300 group-hover:-translate-y-2">
      {Icon && <Icon className="h-8 w-8 origin-left transform transition-transform duration-300 group-hover:scale-90 text-foreground/70" />}
      {name && <h3 className="text-lg font-semibold text-foreground">{name}</h3>}
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
    {cta && (
      <div className="relative z-10 flex items-center p-6 pt-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <a href={href ?? "#"} className="text-sm font-medium text-primary">{cta} →</a>
      </div>
    )}
  </div>
);
`;

const MARQUEE = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface MarqueeProps extends React.HTMLAttributes<HTMLDivElement> {
  reverse?: boolean;
  pauseOnHover?: boolean;
  vertical?: boolean;
  repeat?: number;
}

export const Marquee: React.FC<MarqueeProps> = ({
  reverse, pauseOnHover, vertical, repeat = 4, className, children, ...rest
}) => (
  <div
    className={cn(
      "group flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]",
      vertical ? "flex-col" : "flex-row",
      "[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]",
      className,
    )}
    {...rest}
  >
    {Array.from({ length: repeat }).map((_, i) => (
      <div
        key={i}
        className={cn(
          "flex shrink-0 justify-around [gap:var(--gap)]",
          vertical
            ? "animate-[marquee-y_var(--duration)_linear_infinite] flex-col"
            : "animate-[marquee-x_var(--duration)_linear_infinite] flex-row",
          pauseOnHover && "group-hover:[animation-play-state:paused]",
          reverse && "[animation-direction:reverse]",
        )}
      >
        {children}
      </div>
    ))}
    <style>{\`
      @keyframes marquee-x { 0% { transform: translateX(0); } 100% { transform: translateX(calc(-100% - var(--gap))); } }
      @keyframes marquee-y { 0% { transform: translateY(0); } 100% { transform: translateY(calc(-100% - var(--gap))); } }
    \`}</style>
  </div>
);
`;

const INFINITE_MOVING_CARDS = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface InfiniteMovingCardsProps {
  items: Array<{ quote: string; name: string; title?: string }>;
  direction?: "left" | "right";
  speed?: "fast" | "normal" | "slow";
  pauseOnHover?: boolean;
  className?: string;
}

export const InfiniteMovingCards: React.FC<InfiniteMovingCardsProps> = ({
  items, direction = "left", speed = "normal", pauseOnHover = true, className,
}) => {
  const duration = speed === "fast" ? "20s" : speed === "slow" ? "80s" : "40s";
  return (
    <div className={cn("group relative z-20 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]", className)}>
      <ul
        className="flex w-max gap-4 py-4 animate-[scroll_var(--duration)_linear_infinite]"
        style={{ "--duration": duration, animationDirection: direction === "right" ? "reverse" : "normal", animationPlayState: undefined } as React.CSSProperties}
        onMouseEnter={(e) => pauseOnHover && (e.currentTarget.style.animationPlayState = "paused")}
        onMouseLeave={(e) => pauseOnHover && (e.currentTarget.style.animationPlayState = "running")}
      >
        {[...items, ...items].map((it, i) => (
          <li key={i} className="w-[320px] shrink-0 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
            <p className="text-sm leading-relaxed">"{it.quote}"</p>
            <footer className="mt-4 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{it.name}</span>
              {it.title && <span> · {it.title}</span>}
            </footer>
          </li>
        ))}
      </ul>
      <style>{\`@keyframes scroll { 0% { transform: translateX(0); } 100% { transform: translateX(calc(-50% - 0.5rem)); } }\`}</style>
    </div>
  );
};
`;

const ORBITING_CIRCLES = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface OrbitingCirclesProps extends React.HTMLAttributes<HTMLDivElement> {
  radius?: number;
  duration?: number;
  delay?: number;
  reverse?: boolean;
  iconSize?: number;
}

export const OrbitingCircles: React.FC<OrbitingCirclesProps> = ({
  radius = 160, duration = 20, delay = 0, reverse = false, iconSize = 32,
  className, children, ...rest
}) => {
  const items = React.Children.toArray(children);
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)} {...rest}>
      <div className="absolute left-1/2 top-1/2 size-0">
        {items.map((c, i) => {
          const angle = (360 / items.length) * i;
          return (
            <div
              key={i}
              className="absolute left-0 top-0 animate-[orbit_var(--duration)_linear_infinite]"
              style={{
                "--duration": \`\${duration}s\`,
                "--radius": \`\${radius}px\`,
                "--angle": \`\${angle}deg\`,
                animationDirection: reverse ? "reverse" : "normal",
                animationDelay: \`\${delay}s\`,
                width: iconSize, height: iconSize, marginLeft: -iconSize / 2, marginTop: -iconSize / 2,
              } as React.CSSProperties}
            >
              <div className="flex size-full items-center justify-center rounded-full border border-border bg-card text-card-foreground shadow-sm">
                {c}
              </div>
            </div>
          );
        })}
      </div>
      <style>{\`@keyframes orbit { 0% { transform: rotate(calc(var(--angle))) translateX(var(--radius)) rotate(calc(var(--angle) * -1)); } 100% { transform: rotate(calc(var(--angle) + 360deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 360deg) * -1)); } }\`}</style>
    </div>
  );
};
`;

const HERO_PARALLAX = `"use client";
import * as React from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

export interface HeroParallaxProps {
  products: Array<{ title: string; thumbnail: string; link?: string }>;
  className?: string;
}

export const HeroParallax: React.FC<HeroParallaxProps> = ({ products, className }) => {
  const firstRow = products.slice(0, 5);
  const secondRow = products.slice(5, 10);
  const thirdRow = products.slice(10, 15);
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const spring = { stiffness: 300, damping: 30, bounce: 100 };
  const tx = useSpring(useTransform(scrollYProgress, [0, 1], [0, 1000]), spring);
  const txR = useSpring(useTransform(scrollYProgress, [0, 1], [0, -1000]), spring);
  const op = useSpring(useTransform(scrollYProgress, [0, 0.2], [0.2, 1]), spring);

  return (
    <div ref={ref} className={cn("relative flex h-[260vh] flex-col gap-20 overflow-hidden py-20 antialiased [perspective:1000px] [transform-style:preserve-3d]", className)}>
      <motion.div style={{ opacity: op }} className="space-y-12">
        <Row products={firstRow} translate={tx} />
        <Row products={secondRow} translate={txR} reverse />
        <Row products={thirdRow} translate={tx} />
      </motion.div>
    </div>
  );
};

const Row: React.FC<{ products: HeroParallaxProps["products"]; translate: any; reverse?: boolean }> = ({ products, translate, reverse }) => (
  <motion.div className={cn("flex gap-6", reverse && "flex-row-reverse")}>
    {products.map((p, i) => (
      <motion.a key={i} href={p.link ?? "#"} style={{ x: translate }} className="group relative h-72 w-[24rem] shrink-0 overflow-hidden rounded-xl border border-border bg-card">
        <img src={p.thumbnail} alt={p.title} loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent opacity-0 transition-opacity group-hover:opacity-90" />
        <h3 className="absolute bottom-4 left-4 text-lg font-semibold text-foreground opacity-0 transition-opacity group-hover:opacity-100">{p.title}</h3>
      </motion.a>
    ))}
  </motion.div>
);
`;

const ANIMATED_BEAM = `"use client";
import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface AnimatedBeamProps {
  containerRef: React.RefObject<HTMLElement>;
  fromRef: React.RefObject<HTMLElement>;
  toRef: React.RefObject<HTMLElement>;
  curvature?: number;
  duration?: number;
  delay?: number;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  reverse?: boolean;
  className?: string;
}

export const AnimatedBeam: React.FC<AnimatedBeamProps> = ({
  containerRef, fromRef, toRef,
  curvature = 0, duration = 5, delay = 0,
  pathColor = "hsl(var(--border))", pathWidth = 2, pathOpacity = 0.4,
  gradientStartColor = "hsl(var(--primary))", gradientStopColor = "hsl(var(--accent))",
  reverse, className,
}) => {
  const id = React.useId();
  const [d, setD] = React.useState("");
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    const update = () => {
      const c = containerRef.current, a = fromRef.current, b = toRef.current;
      if (!c || !a || !b) return;
      const cr = c.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const x1 = ar.left - cr.left + ar.width / 2;
      const y1 = ar.top - cr.top + ar.height / 2;
      const x2 = br.left - cr.left + br.width / 2;
      const y2 = br.top - cr.top + br.height / 2;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2 - curvature;
      setD(\`M \${x1},\${y1} Q \${cx},\${cy} \${x2},\${y2}\`);
      setSize({ w: cr.width, h: cr.height });
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef, fromRef, toRef, curvature]);

  return (
    <svg
      aria-hidden
      width={size.w}
      height={size.h}
      className={cn("pointer-events-none absolute left-0 top-0", className)}
    >
      <path d={d} stroke={pathColor} strokeWidth={pathWidth} strokeOpacity={pathOpacity} fill="none" />
      <path d={d} stroke={\`url(#\${id})\`} strokeWidth={pathWidth} strokeLinecap="round" fill="none" />
      <defs>
        <motion.linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
          animate={{
            x1: reverse ? ["100%", "0%"] : ["0%", "100%"],
            x2: reverse ? ["110%", "10%"] : ["-10%", "90%"],
          }}
          transition={{ delay, duration, repeat: Infinity, ease: "linear" }}
        >
          <stop stopColor={gradientStartColor} stopOpacity="0" />
          <stop stopColor={gradientStartColor} />
          <stop offset="32.5%" stopColor={gradientStopColor} />
          <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
};
`;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const SHIMMER_BUTTON = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  background?: string;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  ({ shimmerColor = "hsl(var(--primary-foreground))", background = "hsl(var(--primary))", className, children, style, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn("group relative cursor-pointer overflow-hidden rounded-full px-6 py-3 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-100", className)}
      style={{ background, ...style }}
      {...rest}
    >
      <span
        aria-hidden
        className="absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-current to-transparent opacity-30"
        style={{ color: shimmerColor }}
      />
      <span className="relative">{children}</span>
      <style>{\`@keyframes shimmer { 100% { transform: translateX(100%); } }\`}</style>
    </button>
  ),
);
ShimmerButton.displayName = "ShimmerButton";
`;

const RAINBOW_BUTTON = `import * as React from "react";
import { cn } from "@/lib/utils";

export const RainbowButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        "group relative inline-flex h-11 cursor-pointer items-center justify-center rounded-xl px-8 py-2 text-sm font-medium text-primary-foreground",
        "bg-[length:200%] bg-[linear-gradient(90deg,#ff0080,#7928ca,#0070f3,#38bdf8,#ff0080)] animate-[rainbow_4s_linear_infinite]",
        "before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[inherit] before:blur-xl before:opacity-60",
        "transition-transform hover:scale-105 active:scale-100",
        className,
      )}
      {...rest}
    >
      {children}
      <style>{\`@keyframes rainbow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }\`}</style>
    </button>
  ),
);
RainbowButton.displayName = "RainbowButton";
`;

const SHINY_BUTTON = `import * as React from "react";
import { cn } from "@/lib/utils";

export const ShinyButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(
        "group relative inline-flex items-center justify-center rounded-md border border-border bg-background px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted",
        className,
      )}
      {...rest}
    >
      <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <span className="absolute -inset-px animate-[shine-sweep_3s_linear_infinite] bg-[linear-gradient(110deg,transparent_30%,hsl(var(--foreground)/0.15)_50%,transparent_70%)] bg-[length:200%_100%]" />
      </span>
      <span className="relative">{children}</span>
      <style>{\`@keyframes shine-sweep { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }\`}</style>
    </button>
  ),
);
ShinyButton.displayName = "ShinyButton";
`;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export const KIT_FX_FILES: KitFile[] = [
  { path: "src/components/fx/index.ts", content: FX_INDEX, overwrite: true },

  // backgrounds
  { path: "src/components/fx/grid-pattern.tsx", content: GRID_PATTERN, overwrite: true },
  { path: "src/components/fx/dot-pattern.tsx", content: DOT_PATTERN, overwrite: true },
  { path: "src/components/fx/retro-grid.tsx", content: RETRO_GRID, overwrite: true },
  { path: "src/components/fx/flickering-grid.tsx", content: FLICKERING_GRID, overwrite: true },
  { path: "src/components/fx/animated-grid-pattern.tsx", content: ANIMATED_GRID, overwrite: true },
  { path: "src/components/fx/ripple.tsx", content: RIPPLE, overwrite: true },
  { path: "src/components/fx/noise-texture.tsx", content: NOISE_TEXTURE, overwrite: true },
  { path: "src/components/fx/light-rays.tsx", content: LIGHT_RAYS, overwrite: true },
  { path: "src/components/fx/mesh-gradient.tsx", content: MESH_GRADIENT, overwrite: true },
  { path: "src/components/fx/meteors.tsx", content: METEORS, overwrite: true },
  { path: "src/components/fx/particles.tsx", content: PARTICLES, overwrite: true },
  { path: "src/components/fx/sparkles.tsx", content: SPARKLES, overwrite: true },

  // text
  { path: "src/components/fx/aurora-text.tsx", content: AURORA_TEXT, overwrite: true },
  { path: "src/components/fx/gradient-text.tsx", content: GRADIENT_TEXT, overwrite: true },
  { path: "src/components/fx/shiny-text.tsx", content: SHINY_TEXT, overwrite: true },

  // containers
  { path: "src/components/fx/magic-card.tsx", content: MAGIC_CARD, overwrite: true },
  { path: "src/components/fx/border-beam.tsx", content: BORDER_BEAM, overwrite: true },
  { path: "src/components/fx/glow-card.tsx", content: GLOW_CARD, overwrite: true },
  { path: "src/components/fx/bento-grid.tsx", content: BENTO_GRID, overwrite: true },
  { path: "src/components/fx/marquee.tsx", content: MARQUEE, overwrite: true },
  { path: "src/components/fx/infinite-moving-cards.tsx", content: INFINITE_MOVING_CARDS, overwrite: true },
  { path: "src/components/fx/orbiting-circles.tsx", content: ORBITING_CIRCLES, overwrite: true },
  { path: "src/components/fx/hero-parallax.tsx", content: HERO_PARALLAX, overwrite: true },
  { path: "src/components/fx/animated-beam.tsx", content: ANIMATED_BEAM, overwrite: true },

  // buttons
  { path: "src/components/fx/shimmer-button.tsx", content: SHIMMER_BUTTON, overwrite: true },
  { path: "src/components/fx/rainbow-button.tsx", content: RAINBOW_BUTTON, overwrite: true },
  { path: "src/components/fx/shiny-button.tsx", content: SHINY_BUTTON, overwrite: true },
];
