import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatSiteShortName } from '../../lib/formatSite';
import {
  buildElevationHistogramFromDem,
  buildSlopeHistogramChartRows,
} from '../../lib/terrain/terrainExtractor';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const HYPSO_BINS = ['0–14%', '14–28%', '28–42%', '42–57%', '57–71%', '71–85%', '85–100%'];

export const TerrainHistograms: React.FC = () => {
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const filters = useWorkspaceStore((s) => s.filters);

  const [mode, setMode] = useState<'slope' | 'elevation'>('slope');

  const target =
    sites.find((s) => s.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH');
  const analog =
    sites.find((s) => s.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH');

  const data = useMemo(() => {
    if (mode === 'slope') {
      return buildSlopeHistogramChartRows(target?.features, analog?.features, filters);
    }
    const tHist = target?.demGrid ? buildElevationHistogramFromDem(target.demGrid, 7) : null;
    const aHist = analog?.demGrid ? buildElevationHistogramFromDem(analog.demGrid, 7) : null;
    return HYPSO_BINS.map((label, idx) => ({
      label,
      targetPct: tHist ? tHist[idx] : null,
      analogPct: aHist ? aHist[idx] : null,
    }));
  }, [mode, target, analog, filters]);

  const hasAnyData = data.some((d) => d.targetPct !== null || d.analogPct !== null);
  const targetColor = target?.body === 'MOON' ? '#A9B4BF' : '#C8553D';
  const targetShort = target ? formatSiteShortName(target) : 'Target';
  const analogShort = analog ? formatSiteShortName(analog) : 'Analog';

  return (
    <section
      aria-label="Slope and elevation distribution histograms"
      className="rounded-2xl bg-[#12151B] p-6 flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-[#F2F4F8]">
            {mode === 'slope' ? 'Slope gradient distribution' : 'Hypsometric relief distribution'}
          </h3>
          <p className="text-[13px] text-[#9AA3B2]">
            {mode === 'slope'
              ? `Calibration cap: ≤ ${filters.slopeMaxDeg}° max traverse slope`
              : 'Normalized DEM elevation quantiles (0–100% relief)'}
          </p>
        </div>

        <div className="flex items-center rounded-lg bg-white/5 p-1 gap-1">
          <button
            type="button"
            onClick={() => setMode('slope')}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors duration-150 ${
              mode === 'slope' ? 'bg-white/15 text-[#F2F4F8]' : 'text-[#9AA3B2] hover:text-[#F2F4F8]'
            }`}
          >
            Slope (°)
          </button>
          <button
            type="button"
            onClick={() => setMode('elevation')}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors duration-150 ${
              mode === 'elevation' ? 'bg-white/15 text-[#F2F4F8]' : 'text-[#9AA3B2] hover:text-[#F2F4F8]'
            }`}
          >
            Elevation
          </button>
        </div>
      </div>

      {!hasAnyData ? (
        <div className="h-[265px] flex items-center justify-center rounded-xl bg-white/[0.03] text-[14px] text-[#9AA3B2]">
          Real DEM terrain histogram unavailable until raster acquisition completes.
        </div>
      ) : (
        <div className="w-full h-[265px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                interval={0}
                height={46}
                angle={-25}
                textAnchor="end"
                tick={{ fill: '#9AA3B2', fontSize: 13, fontFamily: 'JetBrains Mono' }}
                tickFormatter={(val: string) => val.replace('–', '-').replace('%', '').replace('°', '')}
                stroke="rgba(255,255,255,0.12)"
              />
              <YAxis
                tick={{ fill: '#9AA3B2', fontSize: 13, fontFamily: 'JetBrains Mono' }}
                tickFormatter={(v) => `${v}%`}
                stroke="rgba(255,255,255,0.12)"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#101217',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '8px',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '13px',
                  color: '#F2F4F8',
                }}
                formatter={(value, name) => [
                  `${value ?? 0}% area`,
                  name === 'targetPct' ? targetShort : analogShort,
                ]}
              />
              <Bar
                dataKey="targetPct"
                name="targetPct"
                fill={targetColor}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="analogPct"
                name="analogPct"
                fill="#8FA886"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
};
