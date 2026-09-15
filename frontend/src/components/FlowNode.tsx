import { motion } from "motion/react";
import { AnimatedNumber } from "@/components/AnimatedNumber";

export function FlowNode({
  label,
  count,
  color,
  size = "lg",
  delay = 0,
}: {
  label: string;
  count: number;
  color: string;
  size?: "lg" | "sm";
  delay?: number;
}) {
  const dim = size === "lg" ? 76 : 52;
  const isLive = count > 0;
  return (
    <motion.div
      className="flex shrink-0 flex-col items-center gap-2"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
    >
      <motion.div
        className="flex items-center justify-center rounded-full font-semibold tabular-nums"
        style={{
          width: dim,
          height: dim,
          fontSize: size === "lg" ? 22 : 15,
          background: `radial-gradient(circle at 35% 30%, ${color}3d, ${color}14)`,
          border: `1.5px solid ${color}55`,
          color,
        }}
        animate={
          isLive
            ? { boxShadow: [`0 0 0px ${color}00`, `0 0 22px ${color}55`, `0 0 0px ${color}00`] }
            : undefined
        }
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <AnimatedNumber value={count} />
      </motion.div>
      <div className={size === "lg" ? "text-xs font-medium" : "text-[11px] text-muted-foreground"}>
        {label}
      </div>
    </motion.div>
  );
}
