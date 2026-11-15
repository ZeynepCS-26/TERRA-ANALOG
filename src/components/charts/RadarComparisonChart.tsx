import React, { useMemo } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { formatSiteShortName } from '../../lib/formatSite';
import { evaluateSiteSimilarity } from '../../lib/similarity/similarityEngine';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

export const RadarComparisonChart: React.FC = () => {
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const weights = useWorkspaceStore((s) => s.weights);
  const filters = useWorkspaceStore((s) => s.filters);

  const target =
    sites.find((s) => s.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH');
  const analog =
    sites.find((s) => s.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH');

  const match = useMemo(() => {
    if (!target || !analog) return null;
    return evaluateSiteSimilarity(target, analog, weights, filters);
  }, [target, analog, weights, filters]);

  if (!target || !analog || !match) return null;

  const targetColor = target.body === 'MOON' ? '#A9B4BF' : '#E08A5B';
  const targetShort = formatSiteShortName(target);
  const analogShort = formatSiteShortName(analog);

  return (
    <section
      aria-label="7-dimension planetary analog radar comparison"
      className="rounded-2xl bg-[#12151B] p-6 flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-[#F2F4F8]">
            7-axis parameter envelope
          </h3>
          <p className="text-[13px] text-[#9AA3B2]">
            {match.availableCount} of {match.totalCount} parameters available · confidence{' '}
            <span className="text-[#F2F4F8] font-medium">{match.confidence}</span>
          </p>
        </div>
        <div className="flex items-center gap-4 text-[13px] font-medium">
          <span className="inline-flex items-center gap-2 text-[#F2F4F8]">
            <span className="w-2.5 h-2.5 inline-block rounded-full" style={{ backgroundColor: targetColor }} />
            {targetShort}
          </span>
          <span className="inline-flex items-center gap-2 text-[#A8C09B]">
            <span className="w-2.5 h-2.5 inline-block rounded-full bg-[#8FA886]" />
            {analogShort}
          </span>
        </div>
      </div>

      <div className="w-full h-[270px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={match.radarData} outerRadius="68%">
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: '#E2E6ED', fontSize: 13, fontFamily: 'JetBrains Mono' }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fill: '#9AA3B2', fontSize: 13, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
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
            />
            <Radar
              name={targetShort}
              dataKey="target"
              stroke={targetColor}
              fill={targetColor}
              fillOpacity={0.22}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Radar
              name={analogShort}
              dataKey="analog"
              stroke="#8FA886"
              fill="#8FA886"
              fillOpacity={0.22}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};
