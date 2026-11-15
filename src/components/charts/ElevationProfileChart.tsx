import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatSiteShortName } from '../../lib/formatSite';
import {
  boundsToSpanKm,
  computeRealTransectProfile,
} from '../../lib/terrain/terrainExtractor';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

export const ElevationProfileChart: React.FC = () => {
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const transectA = useWorkspaceStore((s) => s.transectA);
  const transectB = useWorkspaceStore((s) => s.transectB);
  const elevationExpanded = useWorkspaceStore((s) => s.elevationExpanded);
  const setElevationExpanded = useWorkspaceStore((s) => s.setElevationExpanded);
  const setTransectEndpoints = useWorkspaceStore((s) => s.setTransectEndpoints);

  const [showDelta, setShowDelta] = useState(false);

  const target =
    sites.find((s) => s.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH');
  const analog =
    sites.find((s) => s.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH');

  const summary = useMemo(() => {
    if (!target || !analog) {
      return {
        points: [],
        rmseM: null,
        pearsonR: null,
        lengthKm: 0,
        targetAvailable: false,
        analogAvailable: false,
      };
    }
    const spanKm =
      (boundsToSpanKm(target.bounds, target.lat, target.body) +
        boundsToSpanKm(analog.bounds, analog.lat, analog.body)) /
      2;
    return computeRealTransectProfile(
      target.demGrid,
      analog.demGrid,
      spanKm,
      transectA,
      transectB,
      34
    );
  }, [target, analog, transectA, transectB]);

  const targetColor = target?.body === 'MOON' ? '#A9B4BF' : '#E08A5B';
  const analogColor = '#8FA886';
  const targetShort = target ? formatSiteShortName(target) : 'Target';
  const analogShort = analog ? formatSiteShortName(analog) : 'Analog';

  const spark = useMemo(() => {
    const w = 148;
    const h = 30;
    const vals = summary.points
      .flatMap((p) => [p.targetRelM, p.analogRelM])
      .filter((v): v is number => v !== null);
    const min = vals.length > 0 ? Math.min(...vals, -10) : -10;
    const max = vals.length > 0 ? Math.max(...vals, 10) : 10;
    const span = Math.max(1, max - min);

    const buildPts = (key: 'targetRelM' | 'analogRelM') =>
      summary.points
        .map((p, idx) => {
          const val = p[key];
          if (val === null) return null;
          const x = (idx / Math.max(1, summary.points.length - 1)) * w;
          const y = h - ((val - min) / span) * (h - 6) - 3;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .filter((pt): pt is string => pt !== null)
        .join(' ');

    return {
      w,
      h,
      targetPts: buildPts('targetRelM'),
      analogPts: buildPts('analogRelM'),
    };
  }, [summary.points]);

  const isLoadingDem = target?.demStatus === 'loading' || analog?.demStatus === 'loading';
  const hasNegativeR = summary.pearsonR !== null && summary.pearsonR < 0;
  const hasNoDataGaps = summary.points.some(
    (p) => (summary.targetAvailable && p.targetRelM === null) || (summary.analogAvailable && p.analogRelM === null)
  );

  if (!elevationExpanded) {
    return (
      <button
        type="button"
        onClick={() => setElevationExpanded(true)}
        aria-expanded={false}
        aria-label="Expand elevation profile"
        data-testid="elevation-sparkline-strip"
        className="w-full h-[56px] rounded-xl bg-[#101217]/82 hover:bg-[#161920]/90 backdrop-blur-md px-4 flex items-center justify-between gap-4 text-left cursor-pointer transition-colors duration-200 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            viewBox={`0 0 ${spark.w} ${spark.h}`}
            className="w-[120px] sm:w-[148px] h-[30px] shrink-0"
            aria-hidden="true"
          >
            {spark.targetPts && (
              <polyline
                fill="none"
                stroke={targetColor}
                strokeWidth="1.8"
                points={spark.targetPts}
              />
            )}
            {spark.analogPts && (
              <polyline
                fill="none"
                stroke={analogColor}
                strokeWidth="1.6"
                strokeDasharray="3 2"
                points={spark.analogPts}
              />
            )}
          </svg>
          <span className="text-[14px] font-medium text-[#F2F4F8] whitespace-nowrap truncate">
            {isLoadingDem
              ? 'Acquiring DEM transect…'
              : !summary.targetAvailable && !summary.analogAvailable
                ? 'Elevation profile (unavailable)'
                : 'Elevation profile'}
          </span>
        </div>

        <div className="flex items-center gap-4 shrink-0 font-mono text-[13px] tabular-nums">
          <span className="hidden sm:inline text-[#9AA3B2]">
            RMSE{' '}
            <span className="text-[#F2F4F8] font-bold">
              {summary.rmseM !== null ? `${summary.rmseM} m` : '—'}
            </span>
          </span>
          <span className="text-[#9AA3B2] inline-flex items-center gap-1.5">
            r{' '}
            <span
              className="font-bold"
              style={{
                color:
                  summary.pearsonR === null
                    ? '#9AA3B2'
                    : summary.pearsonR >= 0.7
                      ? '#8FA886'
                      : summary.pearsonR >= 0.4
                        ? '#D9A441'
                        : '#E08A5B',
              }}
            >
              {summary.pearsonR !== null ? summary.pearsonR.toFixed(2) : '—'}
            </span>
            {hasNegativeR && (
              <span
                data-testid="negative-r-warning-compact"
                className="inline-flex items-center gap-1 rounded bg-[#2A1414] border border-[#C8553D]/45 px-1.5 py-0.5 text-[13px] text-[#E08A5B]"
              >
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>r &lt; 0</span>
              </span>
            )}
          </span>
          <ChevronUp className="w-4 h-4 text-[#9AA3B2]" aria-hidden="true" />
        </div>
      </button>
    );
  }

  return (
    <section
      aria-label="Expanded elevation profile"
      data-testid="elevation-expanded-panel"
      className="w-full rounded-2xl bg-[#101217]/92 backdrop-blur-xl p-4 sm:p-5 space-y-3 shadow-[0_18px_48px_rgba(0,0,0,0.6)] animate-[panelReveal_250ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="text-[15px] font-semibold text-[#F2F4F8]">
            Transect A–A&apos; profile
          </span>
          <span className="font-mono text-[13px] text-[#9AA3B2] tabular-nums">
            {summary.lengthKm} km baseline
          </span>
        </div>

        <div className="flex items-center gap-5 font-mono tabular-nums">
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-[13px] text-[#9AA3B2]">RMSE</span>
            <span className="text-[20px] font-bold text-[#F2F4F8]">
              {summary.rmseM !== null ? `${summary.rmseM} m` : 'N/A'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-[13px] text-[#9AA3B2]">Pearson r</span>
            <span
              className="text-[20px] font-bold"
              style={{
                color:
                  summary.pearsonR === null
                    ? '#9AA3B2'
                    : summary.pearsonR >= 0.7
                      ? '#8FA886'
                      : summary.pearsonR >= 0.4
                        ? '#D9A441'
                        : '#E08A5B',
              }}
            >
              {summary.pearsonR !== null ? summary.pearsonR.toFixed(3) : 'N/A'}
            </span>
            {hasNegativeR && (
              <span
                data-testid="negative-r-warning"
                className="inline-flex items-center gap-1 rounded-md bg-[#2A1414] border border-[#C8553D]/45 px-2 py-0.5 text-[13px] text-[#E08A5B]"
              >
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Inverted relief (r &lt; 0)</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setElevationExpanded(false)}
            aria-label="Collapse elevation profile"
            className="p-1.5 rounded-lg text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/10 cursor-pointer transition-colors duration-150"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-4 text-[#E2E6ED]">
          <span className="inline-flex items-center gap-2">
            <span className="w-3.5 h-0.5 inline-block" style={{ backgroundColor: targetColor }} />
            {targetShort} {!summary.targetAvailable ? '(DEM unavailable)' : ''}
          </span>
          <span className="inline-flex items-center gap-2 text-[#A8C09B]">
            <span className="w-3.5 h-0.5 inline-block bg-[#8FA886]" />
            {analogShort} {!summary.analogAvailable ? '(DEM unavailable)' : ''}
          </span>
          {hasNoDataGaps && (
            <span className="text-[#D9A441]">Gaps = no data (PSR)</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDelta((v) => !v)}
            aria-pressed={showDelta}
            className={`px-2.5 py-1 rounded-md text-[13px] cursor-pointer transition-colors duration-150 ${
              showDelta
                ? 'bg-white/15 text-[#F2F4F8] font-medium'
                : 'text-[#9AA3B2] hover:text-[#F2F4F8]'
            }`}
          >
            Delta |Δz|
          </button>
          <button
            type="button"
            onClick={() => setTransectEndpoints({ u: 0.16, v: 0.48 }, { u: 0.84, v: 0.52 })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/10 cursor-pointer transition-colors duration-150"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Reset A–A&apos;
          </button>
        </div>
      </div>

      {!summary.targetAvailable && !summary.analogAvailable ? (
        <div className="h-[185px] flex items-center justify-center rounded-xl bg-white/[0.03] text-[14px] text-[#9AA3B2] text-center px-4">
          {isLoadingDem
            ? 'Acquiring real elevation rasters from NASA Trek / AWS Terrarium…'
            : 'Real DEM grid unavailable for this site pair. Upload a GeoTIFF or select a site with coverage.'}
        </div>
      ) : (
        <div className="w-full h-[185px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={summary.points} margin={{ top: 6, right: 24, left: 0, bottom: 2 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" />
              <XAxis
                dataKey="distKm"
                interval={6}
                minTickGap={36}
                tick={{ fill: '#9AA3B2', fontSize: 13, fontFamily: 'JetBrains Mono' }}
                tickFormatter={(v) => `${Number(v).toFixed(1)} km`}
                stroke="rgba(255,255,255,0.12)"
              />
              <YAxis
                yAxisId="elev"
                tick={{ fill: '#9AA3B2', fontSize: 13, fontFamily: 'JetBrains Mono' }}
                tickFormatter={(v) => `${v}m`}
                stroke="rgba(255,255,255,0.12)"
              />
              {showDelta && (
                <YAxis
                  yAxisId="delta"
                  orientation="right"
                  tick={{ fill: '#D9A441', fontSize: 13, fontFamily: 'JetBrains Mono' }}
                  tickFormatter={(v) => `Δ${v}`}
                  stroke="rgba(255,255,255,0.12)"
                />
              )}
              <Tooltip
                contentStyle={{
                  backgroundColor: '#101217',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '8px',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '13px',
                  color: '#F2F4F8',
                }}
                labelFormatter={(val) => `Distance: ${val} km`}
                formatter={(value, name) => {
                  if (name === 'targetRelM') return [`${value ?? 'N/A'} m`, `${targetShort} Δz`];
                  if (name === 'analogRelM') return [`${value ?? 'N/A'} m`, `${analogShort} Δz`];
                  if (name === 'deltaM') return [`${value ?? 'N/A'} m`, '|Difference|'];
                  return [String(value), String(name)];
                }}
              />
              {showDelta && (
                <Area
                  yAxisId="delta"
                  type="monotone"
                  dataKey="deltaM"
                  fill="rgba(217, 164, 65, 0.16)"
                  stroke="rgba(217, 164, 65, 0.50)"
                  strokeWidth={1}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
              <Line
                yAxisId="elev"
                type="monotone"
                dataKey="targetRelM"
                stroke={targetColor}
                strokeWidth={2.4}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="elev"
                type="monotone"
                dataKey="analogRelM"
                stroke={analogColor}
                strokeWidth={2.2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
};
