import { useRef, useState, type ReactNode } from "react";

/**
 * Aceternity's real `card-spotlight` component failed to install
 * (`@aceternity/card-spotlight` has an npm peer-dependency conflict as of
 * 2026-09-15) -- rather than fight it, this is the same mouse-follow
 * radial-glow effect hand-rolled directly. Small enough that reaching for
 * the actual dependency wasn't worth the trouble (see the ponytail plugin
 * installed alongside this rewrite).
 */
export function CardSpotlightFallback({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [hovering, setHovering] = useState(false);

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className ?? ""}`}
      onMouseMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        setPos({
          x: ((e.clientX - rect.left) / rect.width) * 100,
          y: ((e.clientY - rect.top) / rect.height) * 100,
        });
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: hovering ? 1 : 0,
          background: `radial-gradient(circle at ${pos.x}% ${pos.y}%, rgba(167,139,250,0.12), transparent 60%)`,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
