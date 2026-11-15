import React, { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileText, Printer, X } from 'lucide-react';
import {
  formatCoordLabel,
  formatSiteFullName,
  formatSpecStatus,
} from '../../lib/formatSite';
import {
  evaluateSiteSimilarity,
  similarityScoreToColor,
} from '../../lib/similarity/similarityEngine';
import {
  boundsToSpanKm,
  computeRealTransectProfile,
} from '../../lib/terrain/terrainExtractor';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

const STEP_LABELS = [
  '1. Context',
  '2. Rationale',
  '3. Terrain',
  '4. Logistics',
  '5. Instruments',
  '6. Risk & print',
];

export const DossierStepperModal: React.FC = () => {
  const dossierOpen = useWorkspaceStore((s) => s.dossierOpen);
  const dossierStep = useWorkspaceStore((s) => s.dossierStep);
  const dossierDraft = useWorkspaceStore((s) => s.dossierDraft);
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const weights = useWorkspaceStore((s) => s.weights);
  const filters = useWorkspaceStore((s) => s.filters);
  const transectA = useWorkspaceStore((s) => s.transectA);
  const transectB = useWorkspaceStore((s) => s.transectB);

  const setDossierOpen = useWorkspaceStore((s) => s.setDossierOpen);
  const setDossierStep = useWorkspaceStore((s) => s.setDossierStep);
  const updateDossierDraft = useWorkspaceStore((s) => s.updateDossierDraft);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genModelMeta, setGenModelMeta] = useState<string | null>(null);

  const target =
    sites.find((s) => s.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH');
  const analog =
    sites.find((s) => s.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH');

  const match = useMemo(() => {
    if (!target || !analog) return null;
    return evaluateSiteSimilarity(target, analog, weights, filters);
  }, [target, analog, weights, filters]);

  const transect = useMemo(() => {
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
      28
    );
  }, [target, analog, transectA, transectB]);

  if (!dossierOpen || !target || !analog || !match) return null;

  const targetDisplay = formatSiteFullName(target);
  const analogDisplay = formatSiteFullName(analog);
  const targetCoords = formatCoordLabel(target.lat, target.lon);
  const analogCoords = formatCoordLabel(analog.lat, analog.lon);
  const targetDemSource = target.features?.provenance.source ?? target.demGrid?.source ?? 'unavailable';
  const analogDemSource = analog.features?.provenance.source ?? analog.demGrid?.source ?? 'unavailable';
  const targetLithology =
    target.crewOverrides?.lithology ??
    target.geology?.lithology ??
    target.geminiEstimate?.probableGeology ??
    'unavailable';
  const analogLithology =
    analog.crewOverrides?.lithology ??
    analog.geology?.lithology ??
    analog.geminiEstimate?.probableGeology ??
    'unavailable';

  const handleGenerateSummary = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const response = await fetch('/api/dossier/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetName: targetDisplay,
          targetBody: target.body,
          targetCoords,
          targetDemSource,
          targetLithology,
          analogName: analogDisplay,
          analogCountry: analog.country ?? 'Earth',
          analogCoords,
          analogLithology,
          similarityScorePct: match.scorePct,
          availableParameters: `${match.availableCount} of ${match.totalCount}`,
          confidence: match.confidence,
          rmseM: transect.rmseM,
          pearsonR: transect.pearsonR,
          missionProgram: target.missionProgram ?? `${target.body} Analog Campaign`,
          missionObjectives: dossierDraft.missionObjectives,
          mobilityConstraint: dossierDraft.mobilityConstraint,
          sciencePriorities: dossierDraft.sciencePriorities,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Server error (${response.status})`);
      }
      if (data.sections) {
        updateDossierDraft({
          executiveSummary: data.sections.executiveSummary || dossierDraft.executiveSummary,
          siteRationale: data.sections.siteRationale || dossierDraft.siteRationale,
          terrainHazardAssessment:
            data.sections.terrainHazardAssessment || dossierDraft.terrainHazardAssessment,
          instrumentTestPlan: data.sections.instrumentTestPlan || dossierDraft.instrumentTestPlan,
          operationalRecommendation:
            data.sections.operationalRecommendation || dossierDraft.operationalRecommendation,
        });
        setGenModelMeta(`Synthesized ${data.generatedAtUtc?.slice(0, 19) ?? ''} UTC`);
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate dossier summary.');
    } finally {
      setGenerating(false);
    }
  };

  const svgW = 540;
  const svgH = 95;
  const vals = transect.points
    .flatMap((p) => [p.targetRelM, p.analogRelM])
    .filter((v): v is number => v !== null);
  const minVal = vals.length > 0 ? Math.min(...vals, -10) : -10;
  const maxVal = vals.length > 0 ? Math.max(...vals, 10) : 10;
  const span = Math.max(1, maxVal - minVal);
  const toPts = (key: 'targetRelM' | 'analogRelM') =>
    transect.points
      .map((p, idx) => {
        const val = p[key];
        if (val === null) return null;
        const x = (idx / Math.max(1, transect.points.length - 1)) * svgW;
        const y = svgH - ((val - minVal) / span) * (svgH - 12) - 6;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter((s): s is string => s !== null)
      .join(' ');

  const scoreText = match.scorePct !== null ? `${match.scorePct.toFixed(1)}%` : 'N/A';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Field suitability dossier builder"
      className="fixed inset-0 z-[1300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
    >
      <div className="print-dossier-sheet w-full max-w-4xl max-h-[90vh] rounded-2xl bg-[#101217] flex flex-col overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.75)]">
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-6 py-5 border-b border-white/8">
          <div>
            <div className="text-[13px] text-[#9AA3B2]">
              Field suitability dossier · {targetDisplay} ≈ {analogDisplay} ({scoreText} ·{' '}
              {match.availableCount}/{match.totalCount} params)
            </div>
            <h2 className="text-[20px] font-semibold text-[#F2F4F8] mt-0.5">
              Technical mission memorandum builder
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateSummary}
              disabled={generating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/40 text-[#F2F4F8] hover:bg-white hover:text-[#0B0D10] text-[13px] font-medium cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0 transition-colors duration-150"
            >
              <FileText className="w-4 h-4" aria-hidden="true" />
              {generating ? 'Synthesizing brief...' : 'Generate executive summary'}
            </button>
            <button
              type="button"
              onClick={() => setDossierOpen(false)}
              aria-label="Close dossier builder"
              className="p-2 rounded-lg text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <nav
          aria-label="Dossier steps"
          className="no-print flex overflow-x-auto border-b border-white/8 bg-[#0D0F13]"
        >
          {STEP_LABELS.map((label, idx) => {
            const active = dossierStep === idx;
            const done = idx < dossierStep;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setDossierStep(idx)}
                className={`px-4 py-3 text-[13px] cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors duration-150 ${
                  active
                    ? 'bg-white/10 text-[#F2F4F8] font-semibold border-b-2 border-b-[#F2F4F8]'
                    : done
                      ? 'text-[#E2E6ED] font-medium hover:bg-white/5'
                      : 'text-[#9AA3B2] hover:text-[#F2F4F8]'
                }`}
              >
                {done && <Check className="w-3.5 h-3.5 text-[#8FA886]" aria-hidden="true" />}
                {label}
              </button>
            );
          })}
        </nav>

        {(genError || genModelMeta) && (
          <div
            className={`no-print px-6 py-2.5 text-[13px] ${
              genError ? 'bg-[#2A1414] text-[#E08A5B]' : 'bg-[#191D24] text-[#A8C09B]'
            }`}
          >
            {genError ? `Generation notice: ${genError}` : `Draft ready · ${genModelMeta}`}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {dossierStep === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Campaign title
                </label>
                <input
                  type="text"
                  value={dossierDraft.missionTitle}
                  onChange={(e) => updateDossierDraft({ missionTitle: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Principal investigator
                </label>
                <input
                  type="text"
                  value={dossierDraft.leadScientist}
                  onChange={(e) => updateDossierDraft({ leadScientist: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Field campaign window
                </label>
                <input
                  type="text"
                  value={dossierDraft.campaignWindow}
                  onChange={(e) => updateDossierDraft({ campaignWindow: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Mission objectives
                </label>
                <textarea
                  rows={3}
                  value={dossierDraft.missionObjectives}
                  onChange={(e) => updateDossierDraft({ missionObjectives: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Executive summary
                </label>
                <textarea
                  rows={4}
                  value={dossierDraft.executiveSummary}
                  onChange={(e) => updateDossierDraft({ executiveSummary: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
            </div>
          )}

          {dossierStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-[#161920] p-4 space-y-1">
                  <div className="text-[#9AA3B2] text-[13px]">Weighted similarity</div>
                  <div
                    className="font-mono text-[28px] font-bold tabular-nums leading-tight"
                    style={{ color: similarityScoreToColor(match.scorePct) }}
                  >
                    {scoreText}
                  </div>
                  <div className="text-[13px] text-[#F2F4F8] inline-flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          match.specStatus === 'IN-SPEC'
                            ? '#8FA886'
                            : match.specStatus === 'MARGINAL'
                              ? '#D9A441'
                              : match.specStatus === 'INSUFFICIENT-DATA'
                                ? '#9AA3B2'
                                : '#B5483A',
                      }}
                    />
                    {formatSpecStatus(match.specStatus)} ({match.availableCount}/{match.totalCount})
                  </div>
                </div>
                <div className="rounded-xl bg-[#161920] p-4 space-y-1">
                  <div className="text-[#9AA3B2] text-[13px]">Transect RMSE</div>
                  <div className="font-mono text-[28px] font-bold text-[#F2F4F8] tabular-nums leading-tight">
                    {transect.rmseM !== null ? `${transect.rmseM} m` : 'N/A'}
                  </div>
                  <div className="text-[13px] text-[#9AA3B2]">{transect.lengthKm} km baseline</div>
                </div>
                <div className="rounded-xl bg-[#161920] p-4 space-y-1">
                  <div className="text-[#9AA3B2] text-[13px]">Pearson correlation</div>
                  <div className="font-mono text-[28px] font-bold text-[#8FA886] tabular-nums leading-tight">
                    {transect.pearsonR !== null ? `r = ${transect.pearsonR.toFixed(3)}` : 'N/A'}
                  </div>
                  <div className="text-[13px] text-[#9AA3B2]">Detrended elevation fit</div>
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Site selection &amp; geological correlation rationale
                </label>
                <textarea
                  rows={5}
                  value={dossierDraft.siteRationale}
                  onChange={(e) => updateDossierDraft({ siteRationale: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Science &amp; lithology priorities
                </label>
                <textarea
                  rows={3}
                  value={dossierDraft.sciencePriorities}
                  onChange={(e) => updateDossierDraft({ sciencePriorities: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
            </div>
          )}

          {dossierStep === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Mobility &amp; slope constraints (calibration limit: {filters.slopeMaxDeg}°)
                </label>
                <textarea
                  rows={3}
                  value={dossierDraft.mobilityConstraint}
                  onChange={(e) => updateDossierDraft({ mobilityConstraint: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Terrain &amp; environmental hazard assessment
                </label>
                <textarea
                  rows={5}
                  value={dossierDraft.terrainHazardAssessment}
                  onChange={(e) => updateDossierDraft({ terrainHazardAssessment: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
            </div>
          )}

          {dossierStep === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Field logistics, staging &amp; communications plan
                </label>
                <textarea
                  rows={5}
                  value={dossierDraft.logisticsNotes}
                  onChange={(e) => updateDossierDraft({ logisticsNotes: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
              <div className="rounded-xl bg-[#161920] p-4 text-[14px] text-[#E2E6ED] space-y-1.5">
                <div>
                  Analog site coordinates: {analogCoords} ({analog.country ?? 'Earth'})
                </div>
                <div>
                  Mean elevation:{' '}
                  {analog.features ? `${analog.features.meanElevM} m` : 'unavailable'} · Thermal span:{' '}
                  {analog.climate?.tempMinC ?? 'N/A'}°C to {analog.climate?.tempMaxC ?? 'N/A'}°C
                </div>
                <div>
                  DEM source: {analogDemSource} (
                  {analog.features?.provenance.resolutionMPerPx ?? analog.demGrid?.resolutionMPerPx ?? '?'} m/px)
                </div>
              </div>
            </div>
          )}

          {dossierStep === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Instrument &amp; payload verification plan
                </label>
                <textarea
                  rows={6}
                  value={dossierDraft.instrumentTestPlan}
                  onChange={(e) => updateDossierDraft({ instrumentTestPlan: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#9AA3B2] mb-1.5">
                  Operational recommendation
                </label>
                <textarea
                  rows={3}
                  value={dossierDraft.operationalRecommendation}
                  onChange={(e) => updateDossierDraft({ operationalRecommendation: e.target.value })}
                  className="w-full rounded-lg bg-[#161920] border border-white/10 px-3.5 py-2.5 text-[14px] text-[#F2F4F8] focus:outline-none focus:border-white/35"
                />
              </div>
            </div>
          )}

          {dossierStep === 5 && (
            <div className="space-y-5 rounded-xl bg-white text-[#0F172A] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#0F172A] pb-4">
                <div>
                  <div className="text-[13px] font-medium text-[#475569]">
                    Terra-Analog GIS · Technical Field Suitability Memorandum
                  </div>
                  <h3 className="text-[20px] font-bold text-[#0F172A] mt-1">
                    {dossierDraft.missionTitle}
                  </h3>
                  <div className="text-[14px] text-[#334155] mt-1">
                    Lead: {dossierDraft.leadScientist} · Window: {dossierDraft.campaignWindow}
                  </div>
                </div>
                <div className="text-right font-mono text-[13px] text-[#334155]">
                  <div>
                    Doc ID: TA-{target.id.toUpperCase()}-{(analog.isoCode ?? 'EARTH').toUpperCase()}-2026
                  </div>
                  <div>Date: {new Date().toISOString().slice(0, 10)} UTC</div>
                  <div>
                    Similarity: {scoreText} ({match.availableCount}/{match.totalCount} · {match.confidence})
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px] rounded-lg p-4 bg-[#F8FAFC]">
                <div className="space-y-1">
                  <div className="font-bold text-[#0F172A]">Planetary target</div>
                  <div>{targetDisplay}</div>
                  <div>
                    {targetCoords} · {targetDemSource}
                  </div>
                  <div>
                    Slope{' '}
                    {target.features ? `${target.features.slopeMeanDeg.toFixed(1)}°` : 'N/A'} mean /{' '}
                    {target.features ? `${target.features.slopeMaxDeg.toFixed(1)}°` : 'N/A'} max
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="font-bold text-[#0F172A]">Terrestrial analog</div>
                  <div>{analogDisplay}</div>
                  <div>
                    {analogCoords} · {analogDemSource}
                  </div>
                  <div>
                    Slope{' '}
                    {analog.features ? `${analog.features.slopeMeanDeg.toFixed(1)}°` : 'N/A'} mean /{' '}
                    {analog.features ? `${analog.features.slopeMaxDeg.toFixed(1)}°` : 'N/A'} max
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-[14px] font-bold text-[#334155] mb-1.5">
                  1. Executive summary
                </h4>
                <p className="text-[14px] leading-relaxed">{dossierDraft.executiveSummary}</p>
              </div>

              <div>
                <h4 className="text-[14px] font-bold text-[#334155] mb-1.5">
                  2. Geological &amp; mineralogical correlation rationale
                </h4>
                <p className="text-[14px] leading-relaxed">{dossierDraft.siteRationale}</p>
              </div>

              <div className="rounded-lg bg-[#F8FAFC] p-4">
                <div className="flex flex-wrap justify-between gap-2 text-[13px] font-bold text-[#334155] mb-2">
                  <span>3. Transect A–A&apos; normalized profile ({transect.lengthKm} km)</span>
                  <span className="font-mono">
                    RMSE: {transect.rmseM !== null ? `${transect.rmseM} m` : 'N/A'} ·{' '}
                    {transect.pearsonR !== null ? `r = ${transect.pearsonR.toFixed(3)}` : 'r = N/A'}
                  </span>
                </div>
                {transect.targetAvailable || transect.analogAvailable ? (
                  <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-24 bg-white">
                    {transect.targetAvailable && (
                      <polyline
                        fill="none"
                        stroke="#C8553D"
                        strokeWidth="2.2"
                        points={toPts('targetRelM')}
                      />
                    )}
                    {transect.analogAvailable && (
                      <polyline
                        fill="none"
                        stroke="#5F7A58"
                        strokeWidth="2"
                        strokeDasharray="5 3"
                        points={toPts('analogRelM')}
                      />
                    )}
                  </svg>
                ) : (
                  <div className="py-4 text-[13px] text-[#64748B]">
                    DEM transect profile unavailable for both sites.
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-[14px] font-bold text-[#334155] mb-1.5">
                  4. Terrain hazard &amp; risk mitigation matrix
                </h4>
                <table className="w-full border-collapse text-[13px] border border-[#E2E8F0]">
                  <thead>
                    <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0]">
                      <th className="p-2.5 text-left">Hazard</th>
                      <th className="p-2.5 text-left">Likelihood</th>
                      <th className="p-2.5 text-left">Severity</th>
                      <th className="p-2.5 text-left">Mitigation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dossierDraft.riskMitigationMatrix.map((row, idx) => (
                      <tr key={idx} className="border-b border-[#E2E8F0]">
                        <td className="p-2.5">{row.hazard}</td>
                        <td className="p-2.5">{row.likelihood}</td>
                        <td className="p-2.5">{row.severity}</td>
                        <td className="p-2.5">{row.mitigation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="text-[14px] font-bold text-[#334155] mb-1.5">
                  5. Operational recommendation
                </h4>
                <p className="text-[14px] font-medium">{dossierDraft.operationalRecommendation}</p>
              </div>
            </div>
          )}
        </div>

        <div className="no-print flex items-center justify-between px-6 py-4 border-t border-white/8">
          <button
            type="button"
            disabled={dossierStep === 0}
            onClick={() => setDossierStep(dossierStep - 1)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[#E2E6ED] hover:bg-white/10 disabled:opacity-40 text-[13px] font-medium cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          <div className="flex items-center gap-3">
            {dossierStep < 5 ? (
              <button
                type="button"
                onClick={() => setDossierStep(dossierStep + 1)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F2F4F8] hover:bg-white text-[#0B0D10] text-[13px] font-semibold cursor-pointer"
              >
                Next step
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F2F4F8] hover:bg-white text-[#0B0D10] text-[13px] font-semibold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Print / Export PDF
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
