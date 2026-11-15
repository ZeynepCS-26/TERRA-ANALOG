import React, { useMemo } from 'react';
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
import { ASPECT_SECTORS } from '../../lib/terrain/terrainExtractor';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

export const SpectralSignatureChart: React.FC = () => {
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);

  const target =
    sites.find((s) => s.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH');
  const analog =
    sites.find((s) => s.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH');

  const aspectData = useMemo(() => {
    if (!target?.features && !analog?.features) return [];
    return ASPECT_SECTORS.map((sector, idx) => ({
      sector,
      targetPct: target?.features ? target.features.aspectHistogram[idx] ?? 0 : null,
      analogPct: analog?.features ? analog.features.aspectHistogram[idx] ?? 0 : null,
    }));
  }, [target, analog]);

  if (!target || !analog) return null;

  const targetColor = target.body === 'MOON' ? '#A9B4BF' : '#E08A5B';
  const targetShort = formatSiteShortName(target);
  const analogShort = formatSiteShortName(analog);

  const tLith =
    target.crewOverrides?.lithology ??
    target.geology?.lithology ??
    target.geminiEstimate?.probableGeology ??
    null;
  const aLith =
    analog.crewOverrides?.lithology ??
    analog.geology?.lithology ??
    analog.geminiEstimate?.probableGeology ??
    null;

  return (
    <section
      aria-label="Geomorphology aspect distribution and verified geology units"
      className="rounded-2xl bg-[#12151B] p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-[#F2F4F8]">
            Directional aspect &amp; lithology provenance
          </h3>
          <p className="text-[13px] text-[#9AA3B2]">
            Measured 8-sector terrain aspect from DEM + USGS SIM 3292 / Macrostrat geologic units
          </p>
        </div>

        <div className="flex items-center gap-4 text-[13px] font-medium text-[#F2F4F8]">
          <span className="inline-flex items-center gap-2">
            <span className="w-3.5 h-0.5 inline-block" style={{ backgroundColor: targetColor }} />
            {targetShort}
          </span>
          <span className="inline-flex items-center gap-2 text-[#A8C09B]">
            <span className="w-3.5 h-0.5 inline-block bg-[#8FA886]" />
            {analogShort}
          </span>
        </div>
      </div>

      {/* Real Geology & Ruggedness summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-[#161920] p-4 space-y-1.5 border border-white/6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-[#F2F4F8]">{targetShort} geology</span>
            <span className="font-mono text-[13px] text-[#9AA3B2]">
              {target.crewOverrides?.lithology
                ? 'crew-reported'
                : target.geology?.provenance.tag ?? 'unavailable'}
            </span>
          </div>
          <div className="text-[14px] text-[#E2E6ED]">
            {tLith ?? 'Geologic map unit unavailable for this body/coordinate.'}
          </div>
          <div className="font-mono text-[13px] text-[#9AA3B2]">
            {target.features
              ? `TRI ${target.features.triMeanM.toFixed(1)} m · P95 slope ${target.features.slopeP95Deg.toFixed(1)}° · Basin ${target.features.basinRatioPct}%`
              : 'DEM geomorphology pending/unavailable'}
          </div>
        </div>

        <div className="rounded-xl bg-[#161920] p-4 space-y-1.5 border border-white/6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-[#A8C09B]">{analogShort} geology</span>
            <span className="font-mono text-[13px] text-[#9AA3B2]">
              {analog.crewOverrides?.lithology
                ? 'crew-reported'
                : analog.geology?.provenance.tag ?? 'unavailable'}
            </span>
          </div>
          <div className="text-[14px] text-[#E2E6ED]">
            {aLith ?? 'Macrostrat unit unavailable for these coordinates.'}
          </div>
          <div className="font-mono text-[13px] text-[#9AA3B2]">
            {analog.features
              ? `TRI ${analog.features.triMeanM.toFixed(1)} m · P95 slope ${analog.features.slopeP95Deg.toFixed(1)}° · Basin ${analog.features.basinRatioPct}%`
              : 'DEM geomorphology pending/unavailable'}
          </div>
        </div>
      </div>

      {aspectData.length === 0 ? (
        <div className="h-[220px] flex items-center justify-center rounded-xl bg-white/[0.03] text-[14px] text-[#9AA3B2]">
          Aspect orientation sectors unavailable until DEM extraction finishes.
        </div>
      ) : (
        <div className="w-full h-[220px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aspectData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="sector"
                tick={{ fill: '#9AA3B2', fontSize: 13, fontFamily: 'JetBrains Mono' }}
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
                  `${value ?? 0}% facing`,
                  name === 'targetPct' ? targetShort : analogShort,
                ]}
              />
              <Bar dataKey="targetPct" fill={targetColor} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="analogPct" fill="#8FA886" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
};
