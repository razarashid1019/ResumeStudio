import { motion } from "motion/react";

/** A horizontal (or vertical) connector between two pipeline nodes, with
 * small light particles continuously traveling along it -- the visual cue
 * that this is a live, moving pipeline and not a static diagram. */
export function FlowConnector({
  color,
  direction = "horizontal",
  active = true,
}: {
  color: string;
  direction?: "horizontal" | "vertical";
  active?: boolean;
}) {
  const isH = direction === "horizontal";
  return (
    <div
      className={
        isH ? "relative h-px flex-1 min-w-6 overflow-hidden" : "relative w-px flex-1 min-h-6 overflow-hidden"
      }
      style={{ background: `linear-gradient(${isH ? "to right" : "to bottom"}, ${color}55, ${color}22)` }}
    >
      {active &&
        [0, 1].map((i) => (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              width: isH ? 5 : 5,
              height: isH ? 5 : 5,
              background: color,
              boxShadow: `0 0 6px ${color}`,
              top: isH ? "50%" : undefined,
              left: isH ? undefined : "50%",
              translateY: isH ? "-50%" : undefined,
              translateX: isH ? undefined : "-50%",
            }}
            animate={isH ? { left: ["0%", "100%"] } : { top: ["0%", "100%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "linear", delay: i * 0.9 }}
          />
        ))}
    </div>
  );
}
