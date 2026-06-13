"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface FadeInProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

/**
 * Subtle fade + translate entrance. Reduced-motion users get an instant
 * opacity fade only (no translate), respecting `prefers-reduced-motion`.
 */
export function FadeIn({ children, delay = 0, className }: FadeInProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.4, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
