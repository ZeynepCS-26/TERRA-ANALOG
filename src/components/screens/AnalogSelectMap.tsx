import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ArrowLeft } from 'lucide-react';
import { feature } from 'topojson-client';
import landAtlas from 'world-atlas/land-110m.json';
import { formatSiteFullName } from '../../lib/formatSite';
import {
  clampTooltipPosition,
  computeBubbleRadius,
  getBestTargetForAnalog,
  getNextAnalogId,
  getOrderedAnalogIds,
} from '../../lib/analogMap/analogMapLogic';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

interface AnalogSelectMapProps {
  onBack: () => void;
  onContinue: (analogId: string, bestTargetId: string) => void;
  initialSelectedId?: string | null;
  zoomToInitial?: boolean;
}

interface ProjectedPoint {
  analogId: string;
  x: number;
  y: number;
  radius: number;
  scorePct: number | null;
  fullName: string;
  bestTargetId: string;
  bestTargetLabel: string;
  bestTargetBody: 'MARS' | 'MOON' | 'EARTH';
  demStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
}

const LEGEND_TICKS = [
  { score: 70, label: '70%' },
  { score: 85, label: '85%' },
  { score: 95, label: '95%' },
];

export const AnalogSelectMap: React.FC<AnalogSelectMapProps> = ({
  onBack,
  onContinue,
  initialSelectedId = null,
  zoomToInitial = false,
}) => {
  const sites = useWorkspaceStore((s) => s.sites);
  const weights = useWorkspaceStore((s) => s.weights);
  const filters = useWorkspaceStore((s) => s.filters);
  const enrichTopAnalogsBatch = useWorkspaceStore((s) => s.enrichTopAnalogsBatch);
  const enrichSiteById = useWorkspaceStore((s) => s.enrichSiteById);

  const [viewport, setViewport] = useState<{ w: number; h: number }>({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandingToWorkspace, setExpandingToWorkspace] = useState(false);

  const [zoom, setZoom] = useState<{ scale: number; tx: number; ty: number }>({
    scale: 1,
    tx: 0,
    ty: 0,
  });
  const initialFocusAppliedRef = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomRafRef = useRef<number | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    void enrichTopAnalogsBatch(9);
  }, [enrichTopAnalogsBatch]);

  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const landGeo = useMemo(() => {
    const topo = landAtlas as unknown as Parameters<typeof feature>[0] & {
      objects: { land: Parameters<typeof feature>[1] };
    };
    return feature(topo, topo.objects.land);
  }, []);

  const graticuleGeo = useMemo(() => d3.geoGraticule10(), []);

  const { projection, landPath, graticulePath, spherePath } = useMemo(() => {
    const padX = Math.max(24, viewport.w * 0.04);
    const padTop = Math.max(132, viewport.h * 0.16);
    const padBottom = Math.max(92, viewport.h * 0.12);

    const proj = d3.geoNaturalEarth1().fitExtent(
      [
        [padX, padTop],
        [viewport.w - padX, viewport.h - padBottom],
      ],
      { type: 'Sphere' }
    );

    const pathGen = d3.geoPath(proj);
    return {
      projection: proj,
      landPath: pathGen(landGeo) ?? '',
      graticulePath: pathGen(graticuleGeo) ?? '',
      spherePath: pathGen({ type: 'Sphere' }) ?? '',
    };
  }, [viewport.w, viewport.h, landGeo, graticuleGeo]);

  const targets = useMemo(() => sites.filter((s) => s.body !== 'EARTH'), [sites]);
  const analogs = useMemo(() => sites.filter((s) => s.body === 'EARTH'), [sites]);

  const points: ProjectedPoint[] = useMemo(() => {
    return analogs.map((analog) => {
      const coords = projection([analog.lon, analog.lat]) ?? [
        viewport.w * 0.5,
        viewport.h * 0.5,
      ];
      const match = getBestTargetForAnalog(analog, targets, weights, filters);
      const bestTarget = match.bestTarget ?? targets[0];
      return {
        analogId: analog.id,
        x: coords[0],
        y: coords[1],
        radius: computeBubbleRadius(match.scorePct, 55, 97, 7, 18),
        scorePct: match.scorePct,
        fullName: formatSiteFullName(analog),
        bestTargetId: bestTarget?.id ?? 'jezero',
        bestTargetLabel: bestTarget ? formatSiteFullName(bestTarget) : 'Jezero Crater, Mars',
        bestTargetBody: bestTarget?.body ?? 'MARS',
        demStatus: analog.demStatus,
      };
    });
  }, [analogs, targets, projection, viewport.w, viewport.h, weights, filters]);

  const orderedIds = useMemo(() => getOrderedAnalogIds(analogs), [analogs]);

  const animateZoomTo = useCallback((targetScale: number, targetTx: number, targetTy: number) => {
    if (zoomRafRef.current) {
      window.cancelAnimationFrame(zoomRafRef.current);
      zoomRafRef.current = null;
    }

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setZoom({ scale: targetScale, tx: targetTx, ty: targetTy });
      return;
    }

    const start = { ...zoomRef.current };
    const startTime = performance.now();
    const duration = 680;

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setZoom({
        scale: start.scale + (targetScale - start.scale) * ease,
        tx: start.tx + (targetTx - start.tx) * ease,
        ty: start.ty + (targetTy - start.ty) * ease,
      });
      if (t < 1) {
        zoomRafRef.current = window.requestAnimationFrame(tick);
      } else {
        zoomRafRef.current = null;
      }
    };

    zoomRafRef.current = window.requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomRafRef.current) {
        window.cancelAnimationFrame(zoomRafRef.current);
      }
    };
  }, []);

  const selectPoint = useCallback(
    (pt: ProjectedPoint) => {
      setSelectedId(pt.analogId);
      setFocusedId(pt.analogId);
      if (pt.demStatus === 'idle') {
        void enrichSiteById(pt.analogId);
      }
      const targetScale = 2.35;
      const padTop = Math.max(132, viewport.h * 0.16);
      const padBottom = Math.max(92, viewport.h * 0.12);
      const targetCenterX = viewport.w * 0.5;
      const targetCenterY = viewport.h * 0.52;
      const rawTx = targetCenterX - pt.x * targetScale;
      const rawTy = targetCenterY - pt.y * targetScale;
      const maxTy = padTop * (1 - targetScale);
      const minTy = (viewport.h - padBottom) * (1 - targetScale);
      const ty = Math.max(minTy, Math.min(maxTy, rawTy));
      animateZoomTo(targetScale, rawTx, ty);
    },
    [animateZoomTo, enrichSiteById, viewport.w, viewport.h]
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    animateZoomTo(1, 0, 0);
  }, [animateZoomTo]);

  useEffect(() => {
    if (!zoomToInitial || !initialSelectedId || initialFocusAppliedRef.current) return;
    const pt = points.find((p) => p.analogId === initialSelectedId);
    if (!pt) return;
    initialFocusAppliedRef.current = true;
    setSelectedId(pt.analogId);
    setFocusedId(pt.analogId);
    // Keep map unzoomed on page load as requested
  }, [zoomToInitial, initialSelectedId, points]);

  const selectedPoint = useMemo(
    () => points.find((p) => p.analogId === selectedId) ?? null,
    [points, selectedId]
  );

  const handleContinue = useCallback(() => {
    if (!selectedPoint || expandingToWorkspace) return;
    setExpandingToWorkspace(true);
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = prefersReduced ? 60 : 720;
    window.setTimeout(() => {
      onContinue(selectedPoint.analogId, selectedPoint.bestTargetId);
    }, delay);
  }, [selectedPoint, expandingToWorkspace, onContinue]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (expandingToWorkspace) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextId = getNextAnalogId(orderedIds, focusedId ?? selectedId, 1);
        if (nextId) {
          setFocusedId(nextId);
          buttonRefs.current[nextId]?.focus();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prevId = getNextAnalogId(orderedIds, focusedId ?? selectedId, -1);
        if (prevId) {
          setFocusedId(prevId);
          buttonRefs.current[prevId]?.focus();
        }
      } else if (e.key === 'Enter') {
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && activeEl.tagName === 'BUTTON') {
          return;
        }
        const targetId = focusedId ?? selectedId;
        if (targetId) {
          const pt = points.find((p) => p.analogId === targetId);
          if (pt) {
            e.preventDefault();
            if (selectedId === pt.analogId) {
              handleContinue();
            } else {
              selectPoint(pt);
            }
          }
        }
      } else if (e.key === 'Escape' && selectedId) {
        e.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    expandingToWorkspace,
    orderedIds,
    focusedId,
    selectedId,
    points,
    selectPoint,
    clearSelection,
    handleContinue,
  ]);

  const activeTooltipId = hoveredId ?? focusedId ?? selectedId;
  const activeTooltipPoint = points.find((p) => p.analogId === activeTooltipId) ?? null;

  const toScreenCoords = (pt: ProjectedPoint) => ({
    sx: pt.x * zoom.scale + zoom.tx,
    sy: pt.y * zoom.scale + zoom.ty,
  });

  const tooltipPos = activeTooltipPoint
    ? (() => {
        const { sx, sy } = toScreenCoords(activeTooltipPoint);
        const visualRadius =
          activeTooltipPoint.analogId === selectedId
            ? activeTooltipPoint.radius * 1.45 + 14
            : activeTooltipPoint.radius + 14;
        return clampTooltipPosition(sx, sy, viewport.w, viewport.h, 310, 68, Math.round(visualRadius));
      })()
    : null;

  const expandOrigin = selectedPoint
    ? toScreenCoords(selectedPoint)
    : { sx: viewport.w * 0.5, sy: viewport.h * 0.5 };
  const maxCoverRadius = Math.hypot(viewport.w, viewport.h) * 1.15;

  return (
    <section
      aria-label="Analog selection world map"
      className="fixed inset-0 z-20 w-screen h-screen overflow-hidden bg-[#0B0D10] text-[#F2F4F8] font-mono select-none"
    >
      <button
        type="button"
        onClick={onBack}
        className="fixed top-6 left-7 z-30 inline-flex items-center gap-2 text-[14px] text-[#C7CEDB] hover:text-white cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>Back</span>
      </button>

      <header className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 z-20 w-[min(780px,calc(100vw-180px))] text-center">
        <h1 className="text-[clamp(22px,2.4vw,32px)] font-bold leading-[1.2] text-[#F2F4F8] text-balance">
          Select one analog point to begin
        </h1>
        <p className="mt-2 text-[14px] leading-[1.5] text-[#9AA3B2]">
          Pick from {analogs.length} Earth sites. Real DEM &amp; climate metrics enrich automatically.
        </p>
      </header>

      <svg
        width={viewport.w}
        height={viewport.h}
        viewBox={`0 0 ${viewport.w} ${viewport.h}`}
        className="absolute inset-0 w-full h-full block"
        onClick={(e) => {
          if (e.target === e.currentTarget && selectedId) {
            clearSelection();
          }
        }}
      >
        <g transform={`translate(${zoom.tx}, ${zoom.ty}) scale(${zoom.scale})`}>
          <path
            d={spherePath}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.9 / zoom.scale}
          />
          <path
            d={graticulePath}
            fill="none"
            stroke="rgba(255,255,255,0.045)"
            strokeWidth={0.7 / zoom.scale}
          />
          <path
            d={landPath}
            fill="#1A1D21"
            stroke="#2D333B"
            strokeWidth={0.85 / zoom.scale}
          />

          {points.map((pt) => {
            const isSelected = pt.analogId === selectedId;
            const isHighlighted = pt.analogId === hoveredId || pt.analogId === focusedId;
            const baseR = pt.radius / Math.pow(zoom.scale, 0.55);
            const r = isSelected ? baseR * 1.45 : isHighlighted ? baseR * 1.18 : baseR;
            const isReady = pt.scorePct !== null;

            return (
              <g key={pt.analogId} pointerEvents="none">
                {isSelected && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={r + 6 / zoom.scale}
                    fill="none"
                    stroke="rgba(168, 192, 155, 0.55)"
                    strokeWidth={1.25 / zoom.scale}
                  />
                )}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={r}
                  fill={
                    isSelected
                      ? 'rgba(143, 168, 134, 0.65)'
                      : isReady
                        ? 'rgba(143, 168, 134, 0.36)'
                        : 'rgba(154, 163, 178, 0.18)'
                  }
                  stroke={isSelected ? '#F2F4F8' : isReady ? '#A8C09B' : '#6B7280'}
                  strokeWidth={(isSelected ? 1.8 : 1.1) / zoom.scale}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute inset-0 z-10 pointer-events-none">
        {points.map((pt) => {
          const { sx, sy } = toScreenCoords(pt);
          const isSelected = pt.analogId === selectedId;
          const hitSize = Math.max(32, Math.round(pt.radius * 2 + 10));
          const scoreLabel = pt.scorePct !== null ? `${pt.scorePct.toFixed(1)}%` : 'pending DEM';

          return (
            <button
              key={pt.analogId}
              ref={(el) => {
                buttonRefs.current[pt.analogId] = el;
              }}
              type="button"
              data-testid={`analog-bubble-${pt.analogId}`}
              aria-label={`${pt.fullName} — Best match ${pt.bestTargetLabel} ${scoreLabel}`}
              aria-pressed={isSelected}
              onClick={() => selectPoint(pt)}
              onMouseEnter={() => {
                setHoveredId(pt.analogId);
                if (pt.demStatus === 'idle') void enrichSiteById(pt.analogId);
              }}
              onMouseLeave={() => setHoveredId((prev) => (prev === pt.analogId ? null : prev))}
              onFocus={() => setFocusedId(pt.analogId)}
              onBlur={() => setFocusedId((prev) => (prev === pt.analogId ? null : prev))}
              style={{
                left: `${sx}px`,
                top: `${sy}px`,
                width: `${hitSize}px`,
                height: `${hitSize}px`,
              }}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2F4F8]"
            />
          );
        })}
      </div>

      {activeTooltipPoint && tooltipPos && !expandingToWorkspace && (
        <div
          role="status"
          data-testid="analog-map-tooltip"
          style={{
            left: `${tooltipPos.left}px`,
            top: `${tooltipPos.top}px`,
          }}
          className="pointer-events-none fixed z-30 rounded-lg bg-[#101217]/94 px-3.5 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
        >
          <div className="text-[14px] font-bold text-[#F2F4F8] whitespace-nowrap">
            {activeTooltipPoint.fullName}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[13px] text-[#C7CEDB] whitespace-nowrap">
            <span
              aria-hidden="true"
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor:
                  activeTooltipPoint.bestTargetBody === 'MOON' ? '#A9B4BF' : '#E08A5B',
              }}
            />
            <span>
              Best match: {activeTooltipPoint.bestTargetLabel} &middot;{' '}
              {activeTooltipPoint.scorePct !== null
                ? `${activeTooltipPoint.scorePct.toFixed(1)}%`
                : activeTooltipPoint.demStatus === 'loading'
                  ? 'Acquiring…'
                  : activeTooltipPoint.demStatus === 'unavailable'
                    ? 'Insufficient data'
                    : 'Pending (hover/click to fetch)'}
            </span>
          </div>
        </div>
      )}

      <div className="fixed bottom-6 inset-x-7 z-30 flex flex-wrap items-center justify-between gap-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-4 text-[13px] text-[#9AA3B2]">
          <div className="flex items-center gap-2.5" aria-hidden="true">
            {LEGEND_TICKS.map((tick) => {
              const r = computeBubbleRadius(tick.score, 55, 97, 6, 13);
              return (
                <div key={tick.score} className="flex items-center gap-1.5">
                  <span
                    className="inline-block rounded-full border border-[#A8C09B] bg-[#8FA886]/35"
                    style={{ width: `${r * 2}px`, height: `${r * 2}px` }}
                  />
                  <span className="tabular-nums">{tick.label}</span>
                </div>
              );
            })}
          </div>
          <span>Bubble size reflects real similarity score</span>
        </div>

        {selectedPoint && (
          <button
            type="button"
            onClick={handleContinue}
            disabled={expandingToWorkspace}
            className="pointer-events-auto px-7 py-3 rounded-lg bg-[#F2F4F8] text-[#0B0D10] hover:bg-white text-[14px] font-bold cursor-pointer transition-all duration-150 shadow-[0_12px_32px_rgba(0,0,0,0.45)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Continue
          </button>
        )}
      </div>

      {expandingToWorkspace && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 pointer-events-none overflow-hidden"
        >
          <div
            style={{
              left: `${expandOrigin.sx}px`,
              top: `${expandOrigin.sy}px`,
              width: `${maxCoverRadius * 2}px`,
              height: `${maxCoverRadius * 2}px`,
              animation: 'bubbleExpandCover 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8FA886]"
          />
        </div>
      )}
    </section>
  );
};
