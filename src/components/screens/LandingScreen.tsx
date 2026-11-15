import React, { useEffect, useRef, useState } from 'react';
import {
  LANDING_HOLD_DURATION_MS,
  LANDING_MEDIA_SLIDES,
} from '../../data/landingMedia';
import {
  DISINTEGRATE_CONFIG,
  buildDisintegrateGrid,
  drawCoverSource,
  getDisintegrateDurationMs,
  renderDisintegrateFrame,
  renderProceduralPlanetaryCanvas,
  type DisintegrateCell,
} from '../../lib/transitions/disintegrate';

interface LandingScreenProps {
  isExiting: boolean;
  onGetStarted: () => void;
  onExitComplete: () => void;
}

type SlideSource = HTMLImageElement | HTMLCanvasElement;

export const LandingScreen: React.FC<LandingScreenProps> = ({
  isExiting,
  onGetStarted,
  onExitComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourcesRef = useRef<Array<SlideSource | null>>(
    LANDING_MEDIA_SLIDES.map(() => null)
  );
  const fallbacksRef = useRef<Array<HTMLCanvasElement | null>>(
    LANDING_MEDIA_SLIDES.map(() => null)
  );
  const cellsRef = useRef<DisintegrateCell[]>([]);
  const sizeRef = useRef<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  });

  const activeIdxRef = useRef(0);
  const nextIdxRef = useRef(1);
  const phaseRef = useRef<'hold' | 'dissolve' | 'exit'>('hold');
  const phaseStartRef = useRef<number>(performance.now());
  const exitDoneCalledRef = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Preload NASA Image Library public-domain assets with silent procedural fallback
  useEffect(() => {
    let cancelled = false;
    const { width, height } = sizeRef.current;

    LANDING_MEDIA_SLIDES.forEach((slide, idx) => {
      fallbacksRef.current[idx] = renderProceduralPlanetaryCanvas(
        slide.fallbackKind,
        width,
        height
      );

      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!cancelled && img.naturalWidth > 0) {
          sourcesRef.current[idx] = img;
        }
      };
      img.onerror = () => {
        // Silent fallback: procedural planetary surface remains active without error UI
      };
      img.src = slide.imageUrl;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Handle transition trigger when user clicks "Get started"
  useEffect(() => {
    if (isExiting && phaseRef.current !== 'exit') {
      phaseRef.current = 'exit';
      phaseStartRef.current = performance.now();
      exitDoneCalledRef.current = false;
    }
  }, [isExiting]);

  // Main Canvas loop: 5.5s hold + left-to-right pixel dissolve wave
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const syncDimensions = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width: w, height: h };
      cellsRef.current = buildDisintegrateGrid(w, h, DISINTEGRATE_CONFIG, 2026);
    };

    syncDimensions();
    window.addEventListener('resize', syncDimensions);

    const getSlideSource = (idx: number): HTMLImageElement | HTMLCanvasElement | null => {
      return sourcesRef.current[idx] ?? fallbacksRef.current[idx];
    };

    let rafId = 0;
    const dissolveDuration = getDisintegrateDurationMs(DISINTEGRATE_CONFIG);

    const frame = (now: number) => {
      const { width, height } = sizeRef.current;
      const elapsed = now - phaseStartRef.current;

      if (phaseRef.current === 'exit') {
        if (reducedMotion) {
          ctx.clearRect(0, 0, width, height);
          if (!exitDoneCalledRef.current) {
            exitDoneCalledRef.current = true;
            onExitComplete();
          }
          return;
        }
        const progress = Math.min(1, elapsed / dissolveDuration);
        const outgoing = getSlideSource(activeIdxRef.current);
        if (outgoing) {
          renderDisintegrateFrame(
            ctx,
            outgoing,
            null,
            cellsRef.current,
            width,
            height,
            progress,
            DISINTEGRATE_CONFIG,
            true
          );
        } else {
          ctx.clearRect(0, 0, width, height);
        }

        if (progress >= 1 && !exitDoneCalledRef.current) {
          exitDoneCalledRef.current = true;
          onExitComplete();
          return;
        }
      } else if (phaseRef.current === 'hold') {
        const current = getSlideSource(activeIdxRef.current);
        if (current) {
          ctx.clearRect(0, 0, width, height);
          drawCoverSource(ctx, current, width, height, 1);
        }
        if (elapsed >= LANDING_HOLD_DURATION_MS) {
          nextIdxRef.current = (activeIdxRef.current + 1) % LANDING_MEDIA_SLIDES.length;
          phaseRef.current = 'dissolve';
          phaseStartRef.current = now;
        }
      } else if (phaseRef.current === 'dissolve') {
        const progress = reducedMotion ? 1 : Math.min(1, elapsed / dissolveDuration);
        const outgoing = getSlideSource(activeIdxRef.current);
        const incoming = getSlideSource(nextIdxRef.current);

        if (outgoing) {
          renderDisintegrateFrame(
            ctx,
            outgoing,
            incoming,
            cellsRef.current,
            width,
            height,
            progress,
            DISINTEGRATE_CONFIG,
            false
          );
        }

        if (progress >= 1) {
          activeIdxRef.current = nextIdxRef.current;
          phaseRef.current = 'hold';
          phaseStartRef.current = now;
        }
      }

      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncDimensions);
    };
  }, [onExitComplete, reducedMotion]);

  return (
    <section
      aria-label="Terra-Analog introduction"
      className={`fixed inset-0 z-30 w-screen h-screen overflow-hidden font-mono ${
        isExiting ? 'pointer-events-none' : ''
      }`}
    >
      <canvas
        ref={canvasRef}
        data-testid="landing-canvas"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full block"
      />

      {/* Bottom-up readability scrim */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-gradient-to-t from-[#0B0D10]/92 via-[#0B0D10]/48 to-[#0B0D10]/20 transition-opacity duration-300 ${
          isExiting ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* Top-left subtle logo */}
      <div
        className={`absolute top-6 left-7 z-10 text-[15px] font-bold text-[#F2F4F8] transition-opacity duration-200 ${
          isExiting ? 'opacity-0' : 'opacity-100'
        }`}
      >
        Terra-Analog
      </div>

      {/* Centered hero content */}
      <div
        className={`relative z-10 w-full h-full flex flex-col items-center justify-center px-6 text-center transition-opacity duration-200 ${
          isExiting ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <h1 className="max-w-[820px] text-[clamp(28px,3.8vw,48px)] font-bold leading-[1.2] text-[#F2F4F8] text-balance">
          Find Earth&apos;s twin for any place on Mars or the Moon
        </h1>

        <p className="mt-5 max-w-[720px] text-[15px] leading-[1.6] text-[#C7CEDB]">
          Match planetary sites with real terrain on Earth, then plan your field research.
        </p>

        <button
          type="button"
          onClick={onGetStarted}
          disabled={isExiting}
          className="mt-9 px-8 py-3.5 rounded-lg bg-[#F2F4F8] text-[#0B0D10] hover:bg-white text-[15px] font-bold cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Get started
        </button>
      </div>
    </section>
  );
};
