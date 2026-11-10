"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/viz/useReducedMotion";

/** What the trace is showing. */
export type TraceMode = "idle" | "thinking" | "interviewer" | "user";

interface Style {
  core: [number, number, number];
  glow: [number, number, number];
  glowBlur: number; // CSS px
}

const STYLES: Record<"interviewer" | "user", Style> = {
  // Bright red core, soft crimson halo.
  interviewer: { core: [255, 26, 26], glow: [200, 0, 28], glowBlur: 18 },
  // Dimmer and desaturated, so it's obvious it's the candidate's turn.
  user: { core: [138, 16, 16], glow: [90, 10, 12], glowBlur: 10 },
};

const POINTS = 240;
const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;

/**
 * Canvas oscilloscope: one thin red line across the band.
 * - idle: flat, breathing glow (opacity 0.4 → 0.7, ~3 s)
 * - thinking: flat, gentle brightness pulse
 * - interviewer / user: smooth waveform whose height follows `level()`
 * Motion persistence comes from painting each frame over a translucent black fill.
 * With prefers-reduced-motion, a static glowing line is drawn instead.
 */
export default function Oscilloscope({
  mode,
  level,
  className = "",
}: {
  mode: TraceMode;
  /** Current loudness 0..1, read every frame (only used in interviewer/user modes). */
  level?: () => number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  // The animation loop reads the latest props through refs (no restart on change).
  const modeRef = useRef(mode);
  const levelRef = useRef(level);
  useEffect(() => {
    modeRef.current = mode;
    levelRef.current = level;
  }, [mode, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, width, height);
      if (reducedMotion) drawStatic();
    };

    /** Draws the line. `amp` is 0..1 of the available half-height; `alpha` is overall brightness. */
    const drawTrace = (amp: number, alpha: number, style: Style, t: number, user: boolean) => {
      const mid = height / 2;
      const maxAmp = height * 0.42;
      ctx.beginPath();
      for (let i = 0; i <= POINTS; i++) {
        const u = i / POINTS;
        const x = u * width;
        // Taper to flat at both ends, like a probe trace settling.
        const taper = Math.pow(Math.sin(Math.PI * u), 1.6);
        // Sum of a few drifting sines: smooth, never jagged.
        const s = user ? 1.15 : 1;
        const wave =
          0.55 * Math.sin(2 * Math.PI * u * 3.1 * s + t * 0.0043) +
          0.3 * Math.sin(2 * Math.PI * u * 7.3 * s - t * 0.0069) +
          0.15 * Math.sin(2 * Math.PI * u * 13.7 * s + t * 0.0113);
        const y = mid + maxAmp * amp * taper * wave;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Outer glow.
      ctx.shadowColor = rgba(style.glow, alpha);
      ctx.shadowBlur = style.glowBlur;
      ctx.strokeStyle = rgba(style.glow, 0.55 * alpha);
      ctx.lineWidth = 3;
      ctx.stroke();
      // Bright thin core.
      ctx.shadowColor = rgba(style.core, alpha);
      ctx.shadowBlur = 5;
      ctx.strokeStyle = rgba(style.core, alpha);
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    function drawStatic() {
      ctx!.fillStyle = "#050505";
      ctx!.fillRect(0, 0, width, height);
      const style = modeRef.current === "user" ? STYLES.user : STYLES.interviewer;
      drawTrace(0, 0.7, style, 0, false);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    if (reducedMotion) {
      // Static glow; redraw only when the mode changes colour.
      let lastMode = modeRef.current;
      const id = setInterval(() => {
        if (modeRef.current !== lastMode) {
          lastMode = modeRef.current;
          drawStatic();
        }
      }, 200);
      return () => {
        clearInterval(id);
        ro.disconnect();
      };
    }

    let raf = 0;
    let amp = 0; // smoothed amplitude
    const frame = (t: number) => {
      const m = modeRef.current;
      const live = m === "interviewer" || m === "user";
      const target = live ? Math.min(1, Math.max(0, levelRef.current?.() ?? 0)) : 0;
      amp += (target - amp) * (target > amp ? 0.35 : 0.12);

      let alpha: number;
      if (m === "idle") alpha = 0.55 + 0.15 * Math.sin((2 * Math.PI * t) / 3000); // 0.4 → 0.7
      else if (m === "thinking") alpha = 0.65 + 0.3 * Math.sin((2 * Math.PI * t) / 1200);
      else alpha = 1;

      // Persistence: fade the previous frames rather than clearing them. 8-bit rounding
      // leaves faint residue that never fully fades, so clear solidly whenever the
      // line is flat (nothing to trail), which wipes old ghosts at every pause.
      ctx.fillStyle = amp < 0.004 ? "#050505" : "rgba(5,5,5,0.3)";
      ctx.fillRect(0, 0, width, height);
      drawTrace(amp, alpha, m === "user" ? STYLES.user : STYLES.interviewer, t, m === "user");
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className}`} aria-hidden="true" />;
}
