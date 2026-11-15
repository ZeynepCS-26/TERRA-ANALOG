import React, { useMemo, useRef, useState } from 'react';
import {
  Database,
  Download,
  Link2,
  Link2Off,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { evaluateColormapRGB, type ScientificColormap } from '../../lib/elevation/colormaps';
import { formatCoordLabel, formatSiteFullName, formatSpecStatus } from '../../lib/formatSite';
import { evaluateSiteSimilarity, similarityScoreToColor } from '../../lib/similarity/similarityEngine';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { CountryFlag } from '../ui/CountryFlag';

export const RightDrawer: React.FC = () => {
  const rightDrawer = useWorkspaceStore((s) => s.rightDrawer);
  const setRightDrawer = useWorkspaceStore((s) => s.setRightDrawer);
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const activeLabTab = useWorkspaceStore((s) => s.activeLabTab);
  const filters = useWorkspaceStore((s) => s.filters);
  const weights = useWorkspaceStore((s) => s.weights);
  const hillshadeEnabled = useWorkspaceStore((s) => s.hillshadeEnabled);
  const hillshadeZFactor = useWorkspaceStore((s) => s.hillshadeZFactor);
  const elevationOverlayEnabled = useWorkspaceStore((s) => s.elevationOverlayEnabled);
  const elevationOverlayOpacity = useWorkspaceStore((s) => s.elevationOverlayOpacity);
  const sunAzimuthDeg = useWorkspaceStore((s) => s.sunAzimuthDeg);
  const link3dCameras = useWorkspaceStore((s) => s.link3dCameras);
  const show3dWireframe = useWorkspaceStore((s) => s.show3dWireframe);
  const colormap = useWorkspaceStore((s) => s.colormap);
  const syncViews = useWorkspaceStore((s) => s.syncViews);
  const swipeMode = useWorkspaceStore((s) => s.swipeMode);
  const overlayFlags = useWorkspaceStore((s) => s.overlayFlags);
  const verticalExaggeration = useWorkspaceStore((s) => s.verticalExaggeration);
  const sourceHealth = useWorkspaceStore((s) => s.sourceHealth);
  const isOffline = useWorkspaceStore((s) => s.isOffline);

  const updateFilter = useWorkspaceStore((s) => s.updateFilter);
  const resetFilters = useWorkspaceStore((s) => s.resetFilters);
  const updateWeight = useWorkspaceStore((s) => s.updateWeight);
  const resetWeights = useWorkspaceStore((s) => s.resetWeights);
  const setHillshadeEnabled = useWorkspaceStore((s) => s.setHillshadeEnabled);
  const setHillshadeZFactor = useWorkspaceStore((s) => s.setHillshadeZFactor);
  const setElevationOverlayEnabled = useWorkspaceStore((s) => s.setElevationOverlayEnabled);
  const setElevationOverlayOpacity = useWorkspaceStore((s) => s.setElevationOverlayOpacity);
  const setSunAzimuthDeg = useWorkspaceStore((s) => s.setSunAzimuthDeg);
  const setLink3dCameras = useWorkspaceStore((s) => s.setLink3dCameras);
  const setShow3dWireframe = useWorkspaceStore((s) => s.setShow3dWireframe);
  const setColormap = useWorkspaceStore((s) => s.setColormap);
  const setSyncViews = useWorkspaceStore((s) => s.setSyncViews);
  const setSwipeMode = useWorkspaceStore((s) => s.setSwipeMode);
  const toggleOverlayFlag = useWorkspaceStore((s) => s.toggleOverlayFlag);
  const setVerticalExaggeration = useWorkspaceStore((s) => s.setVerticalExaggeration);
  const updateSiteNotes = useWorkspaceStore((s) => s.updateSiteNotes);
  const updateCrewOverrides = useWorkspaceStore((s) => s.updateCrewOverrides);
  const setHasUnsavedEdits = useWorkspaceStore((s) => s.setHasUnsavedEdits);
  const deleteSiteById = useWorkspaceStore((s) => s.deleteSiteById);
  const exportProjectJson = useWorkspaceStore((s) => s.exportProjectJson);
  const importProjectJson = useWorkspaceStore((s) => s.importProjectJson);
  const enrichSiteById = useWorkspaceStore((s) => s.enrichSiteById);

  const [provenancePopover, setProvenancePopover] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const [crewEditorOpen, setCrewEditorOpen] = useState(false);
  const [crewTempMin, setCrewTempMin] = useState('');
  const [crewTempMax, setCrewTempMax] = useState('');
  const [crewSlope, setCrewSlope] = useState('');
  const [crewLith, setCrewLith] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const target =
    sites.find((t) => t.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH') ?? sites[0];
  const analog =
    sites.find((a) => a.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH') ?? sites[0];

  const match = useMemo(() => {
    if (!target || !analog) return null;
    return evaluateSiteSimilarity(target, analog, weights, filters);
  }, [target, analog, weights, filters]);

  if (!rightDrawer || !target || !analog || !match) return null;

  const titleByMode: Record<Exclude<typeof rightDrawer, null>, string> = {
    analog: formatSiteFullName(analog),
    layers: 'Map & terrain layers',
    calibration: 'Calibration & weights',
    info: 'Data sources & team sync',
  };

  const totalWeight =
    weights.slope +
    weights.relief +
    weights.roughness +
    weights.morphology +
    weights.thermal +
    weights.lithology +
    weights.aridity;

  const legendStops = Array.from({ length: 12 }, (_, i) => {
    const [r, g, b] = evaluateColormapRGB(colormap, i / 11);
    return `rgb(${r},${g},${b})`;
  }).join(', ');

  const scoreColor = similarityScoreToColor(match.scorePct);
  const statusDotColor =
    match.specStatus === 'IN-SPEC'
      ? '#8FA886'
      : match.specStatus === 'MARGINAL'
        ? '#D9A441'
        : match.specStatus === 'OUT-OF-SPEC'
          ? '#B5483A'
          : '#9AA3B2';

  const surfaceClass =
    activeLabTab === 'terrain3d'
      ? 'bg-[#101217]/96'
      : 'bg-[#101217]/90 backdrop-blur-xl';

  const handleOpenCrewEditor = () => {
    setCrewTempMin(
      analog.crewOverrides?.tempMinC !== undefined && analog.crewOverrides?.tempMinC !== null
        ? String(analog.crewOverrides.tempMinC)
        : ''
    );
    setCrewTempMax(
      analog.crewOverrides?.tempMaxC !== undefined && analog.crewOverrides?.tempMaxC !== null
        ? String(analog.crewOverrides.tempMaxC)
        : ''
    );
    setCrewSlope(
      analog.crewOverrides?.meanSlopeDeg !== undefined && analog.crewOverrides?.meanSlopeDeg !== null
        ? String(analog.crewOverrides.meanSlopeDeg)
        : ''
    );
    setCrewLith(analog.crewOverrides?.lithology ?? '');
    if (crewEditorOpen) setHasUnsavedEdits(false);
    setCrewEditorOpen((v) => !v);
  };

  const handleSaveCrewOverrides = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasAny =
      crewTempMin.trim() !== '' ||
      crewTempMax.trim() !== '' ||
      crewSlope.trim() !== '' ||
      crewLith.trim() !== '';
    await updateCrewOverrides(
      analog.id,
      hasAny
        ? {
            tempMinC: crewTempMin.trim() !== '' ? Number(crewTempMin) : null,
            tempMaxC: crewTempMax.trim() !== '' ? Number(crewTempMax) : null,
            meanSlopeDeg: crewSlope.trim() !== '' ? Number(crewSlope) : null,
            lithology: crewLith.trim() !== '' ? crewLith.trim() : null,
            updatedAtIso: new Date().toISOString(),
          }
        : null
    );
    setHasUnsavedEdits(false);
    setCrewEditorOpen(false);
  };

  const handleDownloadJson = () => {
    const json = exportProjectJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terra-analog-project-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (file: File) => {
    try {
      const text = await file.text();
      const res = await importProjectJson(text);
      setImportStatus(`Imported ${res.count} sites from ${file.name}`);
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Import failed');
    }
  };

  return (
    <aside
      role="dialog"
      aria-label={titleByMode[rightDrawer]}
      data-testid="right-slide-drawer"
      className={`no-print fixed top-[72px] right-4 bottom-5 z-[950] w-[calc(100vw-32px)] sm:w-[400px] rounded-2xl ${surfaceClass} border border-white/10 flex flex-col overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.65)] font-mono animate-[drawerLeft_250ms_cubic-bezier(0.16,1,0.3,1)]`}
    >
      <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {rightDrawer === 'analog' && analog.isoCode && (
            <CountryFlag isoCode={analog.isoCode as 'TR' | 'CL' | 'IS' | 'CA' | 'US' | 'ES' | 'ET' | 'NO'} />
          )}
          <h2 className="text-[16px] font-bold text-[#F2F4F8] truncate">
            {titleByMode[rightDrawer]}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setRightDrawer(null)}
          aria-label="Close drawer"
          className="p-2 rounded-lg text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/10 cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="h-px bg-white/8 mx-6" />

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {rightDrawer === 'analog' && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setProvenancePopover({
                    title: 'Similarity confidence',
                    detail: `${match.availableCount} of ${match.totalCount} parameters available · Confidence: ${match.confidence} · Target DEM: ${
                      target.features?.provenance.source ?? 'unavailable'
                    } · Analog DEM: ${analog.features?.provenance.source ?? 'unavailable'}`,
                  })
                }
                className="text-left cursor-pointer"
                title="Click for provenance"
              >
                <div
                  className={`font-bold tabular-nums leading-none ${
                    match.scorePct !== null ? 'text-[30px]' : 'text-[20px]'
                  }`}
                  style={{ color: scoreColor }}
                >
                  {match.scorePct !== null
                    ? `${match.scorePct.toFixed(1)}%`
                    : match.specStatus === 'INSUFFICIENT-DATA'
                      ? 'Insufficient data'
                      : 'N/A'}
                </div>
                <div className="text-[13px] text-[#9AA3B2] mt-1">
                  {match.availableCount} of {match.totalCount} parameters · {match.confidence} conf.
                </div>
              </button>

              <span className="inline-flex items-center gap-2 text-[13px] text-[#F2F4F8] shrink-0">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusDotColor }} />
                {formatSpecStatus(match.specStatus)}
              </span>
            </div>

            {match.specStatus === 'INSUFFICIENT-DATA' && (
              <div className="rounded-lg bg-[#2A1414]/90 border border-[#C8553D]/45 p-3 text-[13px] text-[#E08A5B]">
                {match.specReason}
              </div>
            )}

            {provenancePopover && (
              <div className="rounded-lg bg-[#161920] border border-white/15 p-3 text-[13px] space-y-1">
                <div className="flex justify-between items-center font-bold text-[#F2F4F8]">
                  <span>{provenancePopover.title}</span>
                  <button
                    type="button"
                    onClick={() => setProvenancePopover(null)}
                    className="text-[#9AA3B2] hover:text-white cursor-pointer"
                  >
                    Close
                  </button>
                </div>
                <div className="text-[#9AA3B2] leading-snug">{provenancePopover.detail}</div>
              </div>
            )}

            {(isOffline || analog.features?.provenance.tag === 'cached') && (
              <div className="text-[13px] text-[#D9A441]">cached data</div>
            )}

            {analog.geminiEstimate && (
              <div className="rounded-lg bg-[#161920] p-3 text-[13px] text-[#D9A441]">
                estimated from image ({analog.geminiEstimate.confidencePct}% conf.) ·{' '}
                {analog.geminiEstimate.morphology}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <button
                type="button"
                onClick={() =>
                  setProvenancePopover({
                    title: 'Coordinates & span',
                    detail: `${formatCoordLabel(analog.lat, analog.lon)} · Radius ${analog.radiusKm} km · Ingested via ${analog.ingestMethod}`,
                  })
                }
                className="text-left p-2.5 rounded-lg bg-[#161920] hover:bg-white/8 cursor-pointer"
              >
                <div className="text-[#9AA3B2]">Coordinates</div>
                <div className="text-[#F2F4F8] tabular-nums mt-0.5">
                  {formatCoordLabel(analog.lat, analog.lon)}
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setProvenancePopover({
                    title: 'Elevation datum provenance',
                    detail: analog.features
                      ? `${analog.features.provenance.source} · ${
                          analog.features.provenance.resolutionMPerPx ?? '?'
                        } m/px · ${analog.features.provenance.tag} · ${
                          analog.features.provenance.fetchedAtIso?.slice(0, 16) ?? ''
                        }`
                      : `DEM status: ${analog.demStatus}`,
                  })
                }
                className="text-left p-2.5 rounded-lg bg-[#161920] hover:bg-white/8 cursor-pointer"
              >
                <div className="text-[#9AA3B2]">Mean elevation</div>
                <div className="text-[#F2F4F8] tabular-nums mt-0.5">
                  {analog.features ? `${analog.features.meanElevM} m` : 'unavailable'}
                </div>
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-[#F2F4F8]">
                  Parameter breakdown
                </span>
                {analog.demStatus === 'unavailable' && (
                  <button
                    type="button"
                    onClick={() => void enrichSiteById(analog.id, true)}
                    className="text-[13px] text-[#E08A5B] underline cursor-pointer"
                  >
                    Retry fetch
                  </button>
                )}
              </div>

              {match.parameters.map((param) => (
                <button
                  key={param.key}
                  type="button"
                  onClick={() =>
                    setProvenancePopover({
                      title: `${param.label} (${param.tag})`,
                      detail: `Target: ${param.targetValueLabel} [${param.targetSource}] · Analog: ${param.analogValueLabel} [${param.analogSource}] · Effective weight: ${param.effectiveWeightPct}%`,
                    })
                  }
                  className="w-full text-left space-y-1 cursor-pointer hover:opacity-90"
                >
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#9AA3B2]">
                      {param.label}{' '}
                      {param.tag === 'estimated' && (
                        <span className="text-[#D9A441]">(est.)</span>
                      )}
                      {param.tag === 'crew-reported' && (
                        <span className="text-[#A8C09B]">(crew)</span>
                      )}
                    </span>
                    <span className="text-[#F2F4F8] font-medium tabular-nums">
                      {param.available && param.scorePct !== null
                        ? `${Math.round(param.scorePct)}%`
                        : 'unavailable'}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    {param.available && param.scorePct !== null && (
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${param.scorePct}%`,
                          backgroundColor: similarityScoreToColor(param.scorePct),
                        }}
                      />
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="h-px bg-white/8" />

            {/* Editable Notes & Timestamp */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[13px]">
                <span className="font-bold text-[#F2F4F8]">Field notes</span>
                <span className="text-[#9AA3B2]">
                  Updated {analog.updatedAtIso.slice(0, 10)}
                </span>
              </div>
              <textarea
                rows={3}
                value={analog.notes}
                onChange={(e) => void updateSiteNotes(analog.id, e.target.value)}
                placeholder="Add field team observations…"
                className="w-full rounded-lg bg-[#161920] border border-white/10 px-3 py-2 text-[13px] text-[#F2F4F8]"
              />
            </div>

            {/* Crew-reported manual telemetry override */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleOpenCrewEditor}
                className="w-full px-3 py-2 rounded-lg bg-[#161920] hover:bg-white/10 text-[13px] font-bold text-[#F2F4F8] text-left cursor-pointer flex justify-between"
              >
                <span>Crew field telemetry override</span>
                <span className="text-[#9AA3B2]">{crewEditorOpen ? 'Close' : 'Edit'}</span>
              </button>

              {crewEditorOpen && (
                <form onSubmit={handleSaveCrewOverrides} className="rounded-lg bg-[#161920] p-3 space-y-2.5 text-[13px]">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="text-[#9AA3B2]">Min °C</span>
                      <input
                        type="number"
                        value={crewTempMin}
                        onChange={(e) => {
                          setCrewTempMin(e.target.value);
                          setHasUnsavedEdits(true);
                        }}
                        className="mt-1 w-full rounded bg-[#0D0F13] border border-white/12 px-2 py-1.5 text-[#F2F4F8]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[#9AA3B2]">Max °C</span>
                      <input
                        type="number"
                        value={crewTempMax}
                        onChange={(e) => {
                          setCrewTempMax(e.target.value);
                          setHasUnsavedEdits(true);
                        }}
                        className="mt-1 w-full rounded bg-[#0D0F13] border border-white/12 px-2 py-1.5 text-[#F2F4F8]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[#9AA3B2]">Slope °</span>
                      <input
                        type="number"
                        step="0.1"
                        value={crewSlope}
                        onChange={(e) => {
                          setCrewSlope(e.target.value);
                          setHasUnsavedEdits(true);
                        }}
                        className="mt-1 w-full rounded bg-[#0D0F13] border border-white/12 px-2 py-1.5 text-[#F2F4F8]"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-[#9AA3B2]">Measured rock / regolith</span>
                    <input
                      type="text"
                      value={crewLith}
                      onChange={(e) => {
                        setCrewLith(e.target.value);
                        setHasUnsavedEdits(true);
                      }}
                      className="mt-1 w-full rounded bg-[#0D0F13] border border-white/12 px-2 py-1.5 text-[#F2F4F8]"
                    />
                  </label>
                  <button
                    type="submit"
                    className="w-full py-2 rounded-lg bg-[#F2F4F8] text-[#0B0D10] font-bold cursor-pointer"
                  >
                    Apply crew-reported telemetry
                  </button>
                </form>
              )}
            </div>

            {sites.filter((s) => s.body === 'EARTH').length > 1 && (
              <button
                type="button"
                onClick={() => {
                  void deleteSiteById(analog.id);
                  setRightDrawer(null);
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#C8553D]/40 text-[#E08A5B] hover:bg-[#2A1414] text-[13px] cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Delete site from catalog
              </button>
            )}
          </>
        )}

        {rightDrawer === 'calibration' && (
          <>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-[#F2F4F8]">Terrain limits</span>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 text-[13px] text-[#9AA3B2] hover:text-[#F2F4F8] cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </div>

              <label className="block space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9AA3B2]">Max slope</span>
                  <span className="text-[#F2F4F8] tabular-nums">{filters.slopeMaxDeg}°</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={45}
                  step={1}
                  value={filters.slopeMaxDeg}
                  onChange={(e) => updateFilter('slopeMaxDeg', Number(e.target.value))}
                  className="sci-slider"
                />
              </label>

              <label className="block space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9AA3B2]">Contour interval</span>
                  <span className="text-[#F2F4F8] tabular-nums">{filters.contourIntervalM} m</span>
                </div>
                <input
                  type="range"
                  min={25}
                  max={250}
                  step={25}
                  value={filters.contourIntervalM}
                  onChange={(e) => updateFilter('contourIntervalM', Number(e.target.value))}
                  className="sci-slider"
                />
              </label>

              <label className="block space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9AA3B2]">Min mineral index</span>
                  <span className="text-[#F2F4F8] tabular-nums">{filters.mineralIndexMinPct}%</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={90}
                  step={1}
                  value={filters.mineralIndexMinPct}
                  onChange={(e) => updateFilter('mineralIndexMinPct', Number(e.target.value))}
                  className="sci-slider"
                />
              </label>

              <label className="block space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9AA3B2]">Min temperature</span>
                  <span className="text-[#F2F4F8] tabular-nums">{filters.tempMinThresholdC}°C</span>
                </div>
                <input
                  type="range"
                  min={-190}
                  max={10}
                  step={5}
                  value={filters.tempMinThresholdC}
                  onChange={(e) => updateFilter('tempMinThresholdC', Number(e.target.value))}
                  className="sci-slider"
                />
              </label>
            </div>

            <div className="h-px bg-white/8" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-[#F2F4F8]">
                  Similarity weights ({totalWeight}%)
                </span>
                <button
                  type="button"
                  onClick={resetWeights}
                  className="text-[13px] text-[#9AA3B2] hover:text-[#F2F4F8] cursor-pointer"
                >
                  Defaults
                </button>
              </div>

              {(
                [
                  ['slope', 'Slope distribution'],
                  ['relief', 'Elevation relief'],
                  ['roughness', 'Surface roughness (TRI)'],
                  ['morphology', 'Basin & aspect'],
                  ['thermal', 'Thermal envelope'],
                  ['lithology', 'Lithology parity'],
                  ['aridity', 'Aridity & moisture'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block space-y-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#9AA3B2]">{label}</span>
                    <span className="text-[#F2F4F8] tabular-nums">{weights[key]}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={5}
                    value={weights[key]}
                    onChange={(e) => updateWeight(key, Number(e.target.value))}
                    className="sci-slider"
                  />
                </label>
              ))}
            </div>
          </>
        )}

        {rightDrawer === 'layers' && (
          <>
            <div className="space-y-3">
              <div className="text-[14px] font-bold text-[#F2F4F8]">Base &amp; hillshade</div>
              <button
                type="button"
                onClick={() => setHillshadeEnabled(!hillshadeEnabled)}
                aria-pressed={hillshadeEnabled}
                data-testid="toggle-hillshade"
                className={`w-full px-3 py-2 rounded-lg text-left text-[14px] cursor-pointer ${
                  hillshadeEnabled
                    ? 'bg-white/15 text-[#F2F4F8] font-bold'
                    : 'bg-white/5 text-[#9AA3B2] hover:text-[#F2F4F8]'
                }`}
              >
                {hillshadeEnabled ? '✓ ' : '+ '}Hillshade (multiply 55%)
              </button>

              {hillshadeEnabled && (
                <label className="block space-y-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#9AA3B2]">Relief contrast (Z)</span>
                    <span className="text-[#F2F4F8] tabular-nums">{hillshadeZFactor.toFixed(1)}×</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={3.0}
                    step={0.1}
                    value={hillshadeZFactor}
                    onChange={(e) => setHillshadeZFactor(Number(e.target.value))}
                    className="sci-slider"
                  />
                </label>
              )}
            </div>

            <div className="h-px bg-white/8" />

            <div className="space-y-3">
              <div className="text-[14px] font-bold text-[#F2F4F8]">Elevation overlay</div>
              <button
                type="button"
                onClick={() => setElevationOverlayEnabled(!elevationOverlayEnabled)}
                aria-pressed={elevationOverlayEnabled}
                data-testid="toggle-elevation-overlay"
                className={`w-full px-3 py-2 rounded-lg text-left text-[14px] cursor-pointer ${
                  elevationOverlayEnabled
                    ? 'bg-white/15 text-[#F2F4F8] font-bold'
                    : 'bg-white/5 text-[#9AA3B2] hover:text-[#F2F4F8]'
                }`}
              >
                {elevationOverlayEnabled ? '✓ ' : '+ '}Elevation color (p2–p98)
              </button>

              {elevationOverlayEnabled && (
                <>
                  <label className="block space-y-1.5">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-[#9AA3B2]">Soft-light opacity</span>
                      <span className="text-[#F2F4F8] tabular-nums">
                        {Math.round(elevationOverlayOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={0.35}
                      step={0.05}
                      value={elevationOverlayOpacity}
                      onChange={(e) => setElevationOverlayOpacity(Number(e.target.value))}
                      className="sci-slider"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    {(['cividis', 'viridis'] as ScientificColormap[]).map((cm) => (
                      <button
                        key={cm}
                        type="button"
                        onClick={() => setColormap(cm)}
                        className={`px-3 py-2 rounded-lg text-[13px] capitalize cursor-pointer ${
                          colormap === cm
                            ? 'bg-white/15 text-[#F2F4F8] font-bold'
                            : 'bg-white/5 text-[#9AA3B2] hover:text-[#F2F4F8]'
                        }`}
                      >
                        {cm}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="h-px bg-white/8" />

            <div className="space-y-3">
              <div className="text-[14px] font-bold text-[#F2F4F8]">Lighting &amp; 3D terrain</div>
              <label className="block space-y-1.5">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9AA3B2]">Sun azimuth</span>
                  <span className="text-[#F2F4F8] tabular-nums">{sunAzimuthDeg}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={5}
                  value={sunAzimuthDeg}
                  onChange={(e) => setSunAzimuthDeg(Number(e.target.value))}
                  className="sci-slider"
                />
              </label>

              <label className="block space-y-1.5">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#9AA3B2]">3D vertical exaggeration</span>
                  <span className="text-[#F2F4F8] tabular-nums">{verticalExaggeration.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={2.4}
                  step={0.1}
                  value={verticalExaggeration}
                  onChange={(e) => setVerticalExaggeration(Number(e.target.value))}
                  className="sci-slider"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLink3dCameras(!link3dCameras)}
                  aria-pressed={link3dCameras}
                  className={`px-3 py-2 rounded-lg text-[13px] cursor-pointer ${
                    link3dCameras
                      ? 'bg-white/15 text-[#F2F4F8] font-bold'
                      : 'bg-white/5 text-[#9AA3B2] hover:text-[#F2F4F8]'
                  }`}
                >
                  {link3dCameras ? '✓ ' : '+ '}Link 3D
                </button>
                <button
                  type="button"
                  onClick={() => setShow3dWireframe(!show3dWireframe)}
                  aria-pressed={show3dWireframe}
                  className={`px-3 py-2 rounded-lg text-[13px] cursor-pointer ${
                    show3dWireframe
                      ? 'bg-white/15 text-[#F2F4F8] font-bold'
                      : 'bg-white/5 text-[#9AA3B2] hover:text-[#F2F4F8]'
                  }`}
                >
                  {show3dWireframe ? '✓ ' : '+ '}Wireframe
                </button>
              </div>
            </div>

            <div className="h-px bg-white/8" />

            <div className="space-y-2">
              <div className="text-[14px] font-bold text-[#F2F4F8]">Dual map comparison</div>
              <button
                type="button"
                onClick={() => setSyncViews(!syncViews)}
                aria-pressed={syncViews}
                className={`w-full inline-flex items-center gap-2.5 px-3 py-2 rounded-lg text-[14px] cursor-pointer ${
                  syncViews
                    ? 'bg-white/15 text-[#F2F4F8] font-bold'
                    : 'text-[#9AA3B2] hover:bg-white/6 hover:text-[#F2F4F8]'
                }`}
              >
                {syncViews ? <Link2 className="w-4 h-4" /> : <Link2Off className="w-4 h-4" />}
                Link pan &amp; zoom
              </button>
              <button
                type="button"
                onClick={() => setSwipeMode(!swipeMode)}
                aria-pressed={swipeMode}
                className={`w-full inline-flex items-center gap-2.5 px-3 py-2 rounded-lg text-[14px] cursor-pointer ${
                  swipeMode
                    ? 'bg-white/15 text-[#F2F4F8] font-bold'
                    : 'text-[#9AA3B2] hover:bg-white/6 hover:text-[#F2F4F8]'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Swipe split view
              </button>
              <button
                type="button"
                onClick={() => toggleOverlayFlag('graticule')}
                aria-pressed={overlayFlags.graticule}
                className={`w-full px-3 py-2 rounded-lg text-left text-[14px] cursor-pointer ${
                  overlayFlags.graticule
                    ? 'bg-white/12 text-[#F2F4F8]'
                    : 'text-[#9AA3B2] hover:bg-white/6'
                }`}
              >
                {overlayFlags.graticule ? '✓ ' : '+ '}Coordinate grid
              </button>
            </div>

            {target.features && (
              <>
                <div className="h-px bg-white/8" />
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[13px] text-[#9AA3B2] tabular-nums">
                    <span>{target.features.minElevM} m</span>
                    <span>{target.features.maxElevM} m</span>
                  </div>
                  <div
                    className="w-full h-2.5 rounded-full"
                    style={{ background: `linear-gradient(to right, ${legendStops})` }}
                  />
                </div>
              </>
            )}
          </>
        )}

        {rightDrawer === 'info' && (
          <>
            <div className="space-y-2.5">
              <div className="text-[14px] font-bold text-[#F2F4F8]">Team sharing (JSON)</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#161920] hover:bg-white/10 text-[13px] text-[#F2F4F8] cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#161920] hover:bg-white/10 text-[13px] text-[#F2F4F8] cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  Import JSON
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleImportJson(f);
                  }}
                />
              </div>
              {importStatus && <div className="text-[13px] text-[#8FA886]">{importStatus}</div>}
            </div>

            <div className="h-px bg-white/8" />

            <div className="space-y-2.5">
              <div className="text-[14px] font-bold text-[#F2F4F8]">Retrieved pair provenance</div>
              <div className="rounded-lg bg-[#161920] p-3 space-y-1.5 text-[13px]">
                <div className="text-[#F2F4F8] font-bold">{formatSiteFullName(target)}</div>
                <div className="text-[#9AA3B2]">
                  DEM: {target.features?.provenance.source ?? target.demStatus}
                </div>
                <div className="text-[#9AA3B2]">
                  Geology: {target.geology?.lithology ?? 'unavailable'} (
                  {target.geology?.provenance.source ?? 'unavailable'})
                </div>
                <div className="text-[#9AA3B2]">
                  Climate: {target.climate?.provenance.source ?? 'unavailable'}
                </div>
              </div>
              <div className="rounded-lg bg-[#161920] p-3 space-y-1.5 text-[13px]">
                <div className="text-[#F2F4F8] font-bold">{formatSiteFullName(analog)}</div>
                <div className="text-[#9AA3B2]">
                  DEM: {analog.features?.provenance.source ?? analog.demStatus}
                </div>
                <div className="text-[#9AA3B2]">
                  Geology: {analog.geology?.lithology ?? 'unavailable'} (
                  {analog.geology?.provenance.source ?? 'unavailable'})
                </div>
                <div className="text-[#9AA3B2]">
                  Climate: {analog.climate?.provenance.source ?? 'unavailable'}
                </div>
              </div>
            </div>

            <div className="h-px bg-white/8" />

            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-[14px] font-bold text-[#F2F4F8]">
                <Database className="w-4 h-4 text-[#9AA3B2]" />
                Live data source status
              </div>
              {sourceHealth.length === 0 ? (
                <div className="text-[13px] text-[#9AA3B2]">Probing endpoints…</div>
              ) : (
                <div className="space-y-1.5">
                  {sourceHealth.map((src) => {
                    const dot =
                      src.status === 'available'
                        ? '#8FA886'
                        : src.status === 'proxied'
                          ? '#D9A441'
                          : '#B5483A';
                    return (
                      <div
                        key={src.id}
                        className="flex items-center justify-between gap-2 text-[13px] py-1"
                      >
                        <span className="text-[#E2E6ED] truncate">{src.label}</span>
                        <span className="inline-flex items-center gap-1.5 text-[#9AA3B2] shrink-0">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dot }} />
                          {src.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
