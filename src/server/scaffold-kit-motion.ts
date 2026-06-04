/**
 * Phase 10 — Motion baseline.
 *
 * Ships a small, opinionated set of motion primitives to every generated app
 * so the model can compose "feels expensive" landing/dashboard pages without
 * inventing one-off framer-motion calls every time.
 *
 * Everything here imports `framer-motion` (alias-resolved from `motion`).
 * framer-motion is in KNOWN_PACKAGES so it's auto-installed on first import.
 *
 * Design intent (mirrors .lovable/plan.md Phase 10):
 *   - All primitives accept `delay` and `className`.
 *   - All primitives respect `prefers-reduced-motion` (motion auto-handles it,
 *     but we also early-return for `WordRotate` / `CountUp` interval timers).
 *   - All primitives are SSR/SSG safe — no `window` access at module scope.
 *   - Default to one-shot viewport reveals (`whileInView` + `once: true`) so
 *     scroll-back doesn't re-trigger animations, which feels janky.
 */

import type { ProjectFile } from "./scaffold-kit-types";

type KitFile = ProjectFile & { overwrite: boolean };

// ---------------------------------------------------------------------------
// src/components/motion/index.ts — single barrel export
// ---------------------------------------------------------------------------
const MOTION_INDEX = `// Petal motion primitives. Import from "@/components/motion".
export { FadeIn } from "./fade-in";
export { SlideUp } from "./slide-up";
export { Stagger, StaggerItem } from "./stagger";
export { Reveal } from "./reveal";
export { Magnetic } from "./magnetic";
export { Tilt } from "./tilt";
export { Parallax } from "./parallax";
export { SplitText } from "./split-text";
export { CountUp } from "./count-up";
export { WordRotate } from "./word-rotate";
export { BlurFade } from "./blur-fade";
`;

// ---------------------------------------------------------------------------
// FadeIn — simplest viewport-triggered fade.
// ---------------------------------------------------------------------------
const FADE_IN = `"use client";
import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

export interface FadeInProps extends HTMLMotionProps<"div"> {
  delay?: number;
  duration?: number;
  once?: boolean;
}

export const FadeIn = React.forwardRef<HTMLDivElement, FadeInProps>(
  ({ delay = 0, duration = 0.6, once = true, children, ...rest }, ref) => (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once, margin: "-10% 0px" }}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  ),
);
FadeIn.displayName = "FadeIn";
`;

// ---------------------------------------------------------------------------
// SlideUp — fade + Y translate. The default reveal for headings / cards.
// ---------------------------------------------------------------------------
const SLIDE_UP = `"use client";
import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

export interface SlideUpProps extends HTMLMotionProps<"div"> {
  delay?: number;
  duration?: number;
  distance?: number;
  once?: boolean;
}

export const SlideUp = React.forwardRef<HTMLDivElement, SlideUpProps>(
  ({ delay = 0, duration = 0.7, distance = 24, once = true, children, ...rest }, ref) => (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-10% 0px" }}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  ),
);
SlideUp.displayName = "SlideUp";
`;

// ---------------------------------------------------------------------------
// Stagger / StaggerItem — orchestrate children with a delay cascade.
// Usage:
//   <Stagger>
//     <StaggerItem>...</StaggerItem>
//     <StaggerItem>...</StaggerItem>
//   </Stagger>
// ---------------------------------------------------------------------------
const STAGGER = `"use client";
import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

export interface StaggerProps extends HTMLMotionProps<"div"> {
  delay?: number;
  stagger?: number;
  once?: boolean;
}

export const Stagger = React.forwardRef<HTMLDivElement, StaggerProps>(
  ({ delay = 0, stagger = 0.08, once = true, children, ...rest }, ref) => (
    <motion.div
      ref={ref}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: "-10% 0px" }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  ),
);
Stagger.displayName = "Stagger";

export interface StaggerItemProps extends HTMLMotionProps<"div"> {
  distance?: number;
}

export const StaggerItem = React.forwardRef<HTMLDivElement, StaggerItemProps>(
  ({ distance = 20, children, ...rest }, ref) => (
    <motion.div
      ref={ref}
      variants={{
        hidden: { opacity: 0, y: distance },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
        },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  ),
);
StaggerItem.displayName = "StaggerItem";
`;

// ---------------------------------------------------------------------------
// Reveal — directional viewport reveal with a configurable axis.
// ---------------------------------------------------------------------------
const REVEAL = `"use client";
import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

export interface RevealProps extends HTMLMotionProps<"div"> {
  direction?: "up" | "down" | "left" | "right";
  delay?: number;
  duration?: number;
  distance?: number;
  once?: boolean;
}

const axisMap = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
} as const;

export const Reveal = React.forwardRef<HTMLDivElement, RevealProps>(
  (
    { direction = "up", delay = 0, duration = 0.7, distance = 32, once = true, children, ...rest },
    ref,
  ) => {
    const a = axisMap[direction];
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, x: a.x * distance, y: a.y * distance }}
        whileInView={{ opacity: 1, x: 0, y: 0 }}
        viewport={{ once, margin: "-10% 0px" }}
        transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
Reveal.displayName = "Reveal";
`;

// ---------------------------------------------------------------------------
// Magnetic — cursor-attracted wrapper for buttons / CTAs.
// ---------------------------------------------------------------------------
const MAGNETIC = `"use client";
import * as React from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export interface MagneticProps extends React.HTMLAttributes<HTMLDivElement> {
  strength?: number;
}

export const Magnetic = React.forwardRef<HTMLDivElement, MagneticProps>(
  ({ strength = 0.35, children, style, ...rest }, ref) => {
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const sx = useSpring(x, { stiffness: 200, damping: 18, mass: 0.4 });
    const sy = useSpring(y, { stiffness: 200, damping: 18, mass: 0.4 });
    const inner = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLDivElement);

    const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const el = inner.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      x.set((e.clientX - (r.left + r.width / 2)) * strength);
      y.set((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const onLeave = () => {
      x.set(0);
      y.set(0);
    };

    return (
      <motion.div
        ref={inner}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ x: sx, y: sy, display: "inline-block", ...style }}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
Magnetic.displayName = "Magnetic";
`;

// ---------------------------------------------------------------------------
// Tilt — 3D card tilt on hover.
// ---------------------------------------------------------------------------
const TILT = `"use client";
import * as React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

export interface TiltProps extends React.HTMLAttributes<HTMLDivElement> {
  max?: number;
  scale?: number;
}

export const Tilt = React.forwardRef<HTMLDivElement, TiltProps>(
  ({ max = 12, scale = 1.02, children, style, ...rest }, ref) => {
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const sx = useSpring(x, { stiffness: 180, damping: 20 });
    const sy = useSpring(y, { stiffness: 180, damping: 20 });
    const rotateX = useTransform(sy, [-0.5, 0.5], [max, -max]);
    const rotateY = useTransform(sx, [-0.5, 0.5], [-max, max]);
    const inner = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLDivElement);

    const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const el = inner.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      x.set((e.clientX - r.left) / r.width - 0.5);
      y.set((e.clientY - r.top) / r.height - 0.5);
    };
    const onLeave = () => {
      x.set(0);
      y.set(0);
    };

    return (
      <motion.div
        ref={inner}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        whileHover={{ scale }}
        style={{ rotateX, rotateY, transformPerspective: 1000, transformStyle: "preserve-3d", ...style }}
        {...rest}
      >
        {children}
      </motion.div>
    );
  },
);
Tilt.displayName = "Tilt";
`;

// ---------------------------------------------------------------------------
// Parallax — translate Y based on scroll position. Great for hero images.
// ---------------------------------------------------------------------------
const PARALLAX = `"use client";
import * as React from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export interface ParallaxProps extends React.HTMLAttributes<HTMLDivElement> {
  /** -1 = move up while scrolling, 1 = move down. Magnitude scales travel. */
  speed?: number;
}

export const Parallax = React.forwardRef<HTMLDivElement, ParallaxProps>(
  ({ speed = -0.3, children, style, ...rest }, ref) => {
    const inner = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLDivElement);
    const { scrollYProgress } = useScroll({
      target: inner,
      offset: ["start end", "end start"],
    });
    const y = useTransform(scrollYProgress, [0, 1], [0, speed * 200]);
    return (
      <motion.div ref={inner} style={{ y, ...style }} {...rest}>
        {children}
      </motion.div>
    );
  },
);
Parallax.displayName = "Parallax";
`;

// ---------------------------------------------------------------------------
// SplitText — splits text into words OR chars and reveals each in sequence.
// Pure DOM split, no extra deps.
// ---------------------------------------------------------------------------
const SPLIT_TEXT = `"use client";
import * as React from "react";
import { motion, type Variants } from "framer-motion";

export interface SplitTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  text: string;
  by?: "word" | "char";
  delay?: number;
  stagger?: number;
  once?: boolean;
  as?: "span" | "h1" | "h2" | "h3" | "p";
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: "0.5em" },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

export const SplitText: React.FC<SplitTextProps> = ({
  text,
  by = "word",
  delay = 0,
  stagger = 0.05,
  once = true,
  as = "span",
  className,
  ...rest
}) => {
  const tokens =
    by === "char" ? Array.from(text) : text.split(/(\\s+)/);
  const MotionTag = motion[as] as React.ElementType;
  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: "-10% 0px" }}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
      aria-label={text}
      {...rest}
    >
      {tokens.map((t, i) =>
        /^\\s+$/.test(t) ? (
          <span key={i} aria-hidden> {""}</span>
        ) : (
          <motion.span
            key={i}
            variants={itemVariants}
            style={{ display: "inline-block", whiteSpace: "pre" }}
            aria-hidden
          >
            {t}
          </motion.span>
        ),
      )}
    </MotionTag>
  );
};
`;

// ---------------------------------------------------------------------------
// CountUp — animated number counter. Triggers in-view, one-shot.
// ---------------------------------------------------------------------------
const COUNT_UP = `"use client";
import * as React from "react";
import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion";

export interface CountUpProps extends React.HTMLAttributes<HTMLSpanElement> {
  to: number;
  from?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  once?: boolean;
}

export const CountUp: React.FC<CountUpProps> = ({
  to,
  from = 0,
  duration = 1.6,
  decimals = 0,
  prefix = "",
  suffix = "",
  once = true,
  ...rest
}) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once, margin: "-10% 0px" });
  const value = useMotionValue(from);
  const rounded = useTransform(value, (v) => prefix + v.toFixed(decimals) + suffix);

  React.useEffect(() => {
    if (!inView) return;
    const controls = animate(value, to, { duration, ease: [0.22, 1, 0.36, 1] });
    return controls.stop;
  }, [inView, to, duration, value]);

  return (
    <motion.span ref={ref} {...rest}>
      {rounded}
    </motion.span>
  );
};
`;

// ---------------------------------------------------------------------------
// WordRotate — vertically rotates through a list of words. Hero workhorse.
// ---------------------------------------------------------------------------
const WORD_ROTATE = `"use client";
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface WordRotateProps {
  words: string[];
  interval?: number;
  className?: string;
}

export const WordRotate: React.FC<WordRotateProps> = ({
  words,
  interval = 2400,
  className,
}) => {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (words.length <= 1) return;
    const id = window.setInterval(() => setI((p) => (p + 1) % words.length), interval);
    return () => window.clearInterval(id);
  }, [words.length, interval]);
  return (
    <span className={"inline-block overflow-hidden align-bottom " + (className ?? "")}>
      <AnimatePresence mode="wait">
        <motion.span
          key={words[i]}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block"
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};
`;

// ---------------------------------------------------------------------------
// BlurFade — fade + tiny y + filter blur. Apple-like reveal.
// ---------------------------------------------------------------------------
const BLUR_FADE = `"use client";
import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

export interface BlurFadeProps extends HTMLMotionProps<"div"> {
  delay?: number;
  duration?: number;
  blur?: number;
  once?: boolean;
}

export const BlurFade = React.forwardRef<HTMLDivElement, BlurFadeProps>(
  ({ delay = 0, duration = 0.8, blur = 8, once = true, children, ...rest }, ref) => (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12, filter: \`blur(\${blur}px)\` }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once, margin: "-10% 0px" }}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  ),
);
BlurFade.displayName = "BlurFade";
`;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export const KIT_MOTION_FILES: KitFile[] = [
  { path: "src/components/motion/index.ts", content: MOTION_INDEX, overwrite: true },
  { path: "src/components/motion/fade-in.tsx", content: FADE_IN, overwrite: true },
  { path: "src/components/motion/slide-up.tsx", content: SLIDE_UP, overwrite: true },
  { path: "src/components/motion/stagger.tsx", content: STAGGER, overwrite: true },
  { path: "src/components/motion/reveal.tsx", content: REVEAL, overwrite: true },
  { path: "src/components/motion/magnetic.tsx", content: MAGNETIC, overwrite: true },
  { path: "src/components/motion/tilt.tsx", content: TILT, overwrite: true },
  { path: "src/components/motion/parallax.tsx", content: PARALLAX, overwrite: true },
  { path: "src/components/motion/split-text.tsx", content: SPLIT_TEXT, overwrite: true },
  { path: "src/components/motion/count-up.tsx", content: COUNT_UP, overwrite: true },
  { path: "src/components/motion/word-rotate.tsx", content: WORD_ROTATE, overwrite: true },
  { path: "src/components/motion/blur-fade.tsx", content: BLUR_FADE, overwrite: true },
];
