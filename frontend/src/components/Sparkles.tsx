import { useMemo } from "react";
import { motion } from "motion/react";

/**
 * Aceternity's `sparkles` component pulls in @tsparticles/* pinned to a
 * version whose types don't match what actually installed (real type
 * errors, not lint noise: `initParticlesEngine` isn't exported the way
 * the component expects, several particle-effect properties don't exist
 * on the installed types). Chasing a working version pin for a purely
 * decorative background effect isn't worth it -- this is the same visual
 * idea (small glowing dots, randomly placed, gently pulsing) with zero
 * dependencies instead.
 */
export function Sparkles({ count = 40, color = "#a78bfa" }: { count?: number; color?: string }) {
  const dots = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 0.5,
        delay: Math.random() * 4,
      })),
    [count],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((d, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            background: color,
          }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 3, repeat: Infinity, delay: d.delay, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
