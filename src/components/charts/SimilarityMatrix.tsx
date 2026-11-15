import React, { useMemo } from 'react';
import {
  formatSiteShortName,
  formatSpecStatus,
} from '../../lib/formatSite';
import {
  evaluateSiteSimilarity,
  similarityScoreToColor,
} from '../../lib/similarity/similarityEngine';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { CountryFlag } from '../ui/CountryFlag';

export const SimilarityMatrix: React.FC = () => {
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const weights = useWorkspaceStore((s) => s.weights);
  const filters = useWorkspaceStore((s) => s.filters);
  const selectPair = useWorkspaceStore((s) => s.selectPair);

  const targets = useMemo(() => sites.filter((s) => s.body !== 'EARTH'), [sites]);

  // Prioritize active, custom, and already-enriched Earth sites, capping visible columns to keep table scannable
  const visibleAnalogs = useMemo(() => {
    const earth = sites.filter((s) => s.body === 'EARTH');
    const prioritized = [...earth].sort((a, b) => {
      const aPri =
        (a.id === activeAnalogId ? 100 : 0) +
        (a.ingestMethod !== 'catalog' ? 20 : 0) +
        (a.demStatus === 'ready' ? 10 : 0);
      const bPri =
        (b.id === activeAnalogId ? 100 : 0) +
        (b.ingestMethod !== 'catalog' ? 20 : 0) +
        (b.demStatus === 'ready' ? 10 : 0);
      return bPri - aPri;
    });
    return prioritized.slice(0, 10);
  }, [sites, activeAnalogId]);

  const cells = useMemo(() => {
    const out = new Map<string, ReturnType<typeof evaluateSiteSimilarity>>();
    for (const t of targets) {
      for (const a of visibleAnalogs) {
        out.set(`${t.id}::${a.id}`, evaluateSiteSimilarity(t, a, weights, filters));
      }
    }
    return out;
  }, [targets, visibleAnalogs, weights, filters]);

  return (
    <section
      aria-label="Targets by Earth analogs similarity matrix"
      className="rounded-2xl bg-[#12151B] p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[18px] font-semibold text-[#F2F4F8]">
            Planetary target &times; Earth analog similarity
          </h3>
          <p className="text-[14px] text-[#9AA3B2]">
            Select any cell to lock that pair and trigger DEM/climate acquisition if pending ({targets.length} targets &times; {visibleAnalogs.length} shown Earth sites)
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-[#9AA3B2]">
          <span className="font-mono">50%</span>
          <div
            className="w-24 h-2.5 rounded-full"
            style={{
              background: 'linear-gradient(to right, #B5483A, #D9A441, #8FA886)',
            }}
          />
          <span className="font-mono text-[#F2F4F8]">95%</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-white/8 text-[#9AA3B2]">
              <th className="py-3 pr-4 font-medium text-[13px]">Target site</th>
              {visibleAnalogs.map((analog) => (
                <th key={analog.id} className="py-3 px-2 font-medium text-[13px] text-center whitespace-nowrap">
                  <div className="inline-flex items-center justify-center gap-2">
                    <CountryFlag isoCode={analog.isoCode} />
                    <span>{formatSiteShortName(analog)}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targets.map((target) => (
              <tr key={target.id} className="border-b border-white/5 last:border-b-0">
                <td className="py-3 pr-4 font-semibold text-[#F2F4F8] whitespace-nowrap">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full mr-2.5"
                    style={{ backgroundColor: target.body === 'MOON' ? '#A9B4BF' : '#C8553D' }}
                  />
                  {formatSiteShortName(target)}
                </td>
                {visibleAnalogs.map((analog) => {
                  const cell = cells.get(`${target.id}::${analog.id}`);
                  const score = cell?.scorePct ?? null;
                  const status = cell?.specStatus ?? 'INSUFFICIENT-DATA';
                  const isActive =
                    activeTargetId === target.id && activeAnalogId === analog.id;
                  const color = similarityScoreToColor(score);
                  const dotColor =
                    status === 'IN-SPEC'
                      ? '#8FA886'
                      : status === 'MARGINAL'
                        ? '#D9A441'
                        : status === 'INSUFFICIENT-DATA'
                          ? '#9AA3B2'
                          : '#B5483A';

                  return (
                    <td key={analog.id} className="p-1.5">
                      <button
                        type="button"
                        onClick={() => selectPair(target.id, analog.id)}
                        className={`w-full py-3.5 px-3 rounded-xl text-center transition-colors duration-150 cursor-pointer ${
                          isActive
                            ? 'bg-white/15 ring-1 ring-white/50'
                            : 'bg-white/4 hover:bg-white/10'
                        }`}
                      >
                        <div
                          className="font-mono text-[22px] font-bold tabular-nums leading-tight"
                          style={{ color }}
                        >
                          {score !== null ? `${score.toFixed(1)}%` : 'N/A'}
                        </div>
                        <div className="mt-1 inline-flex items-center justify-center gap-1.5 text-[13px] text-[#F2F4F8] whitespace-nowrap">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span>
                            {cell ? `${cell.availableCount}/7 · ${formatSpecStatus(status)}` : 'Pending'}
                          </span>
                        </div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
