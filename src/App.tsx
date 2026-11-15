import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Box,
  ChevronDown,
  Compass,
  Grid3X3,
  Info,
  Layers,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Sliders,
  WifiOff,
} from 'lucide-react';
import { useAnimatedNumber } from './hooks/useAnimatedNumber';
import {
  formatConsistentScorePct,
  formatCoordLabel,
  formatSiteCleanFullName,
  formatSiteFullName,
  formatSiteShortName,
} from './lib/formatSite';
import {
  classifyScoreConfidence,
  summarizeMatchDrivers,
} from './lib/geo/dualMapMath';
import {
  evaluateSiteSimilarity,
  rankAnalogsForTarget,
  similarityScoreToColor,
} from './lib/similarity/similarityEngine';
import { parseScreenFromLocation } from './lib/routing/hashRoute';
import { useWorkspaceStore, type LabTabId } from './store/useWorkspaceStore';
import { DualMapPanel } from './components/map/DualMapPanel';
import { RadarComparisonChart } from './components/charts/RadarComparisonChart';
import { TerrainHistograms } from './components/charts/TerrainHistograms';
import { SpectralSignatureChart } from './components/charts/SpectralSignatureChart';
import { SimilarityMatrix } from './components/charts/SimilarityMatrix';
import { Terrain3DPreview } from './components/charts/Terrain3DPreview';
import { RightDrawer } from './components/panels/RightDrawer';
import { DossierStepperModal } from './components/panels/DossierStepperModal';
import { AddSiteWizardModal } from './components/panels/AddSiteWizardModal';
import { CountryFlag } from './components/ui/CountryFlag';
import { LandingScreen } from './components/screens/LandingScreen';
import { AnalogSelectMap } from './components/screens/AnalogSelectMap';

const RAIL_VIEWS: Array<{ id: LabTabId; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'map', label: 'Dual map', Icon: MapIcon },
  { id: 'terrain3d', label: '3D terrain', Icon: Box },
  { id: 'spectral', label: 'Geomorph & radar', Icon: Activity },
  { id: 'matrix', label: 'Similarity matrix', Icon: Grid3X3 },
];

export default function App() {
  const screen = useWorkspaceStore((s) => s.screen);
  const mapFocusAnalogOnOpen = useWorkspaceStore((s) => s.mapFocusAnalogOnOpen);
  const hasUnsavedEdits = useWorkspaceStore((s) => s.hasUnsavedEdits);
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const weights = useWorkspaceStore((s) => s.weights);
  const filters = useWorkspaceStore((s) => s.filters);
  const activeLabTab = useWorkspaceStore((s) => s.activeLabTab);
  const rightDrawer = useWorkspaceStore((s) => s.rightDrawer);
  const acquiringCount = useWorkspaceStore((s) => s.acquiringCount);
  const acquiringLabel = useWorkspaceStore((s) => s.acquiringLabel);
  const isOffline = useWorkspaceStore((s) => s.isOffline);
  const mapPickActive = useWorkspaceStore((s) => s.mapPick.active);
  const cursorTelemetry = useWorkspaceStore((s) => s.cursorTelemetry);

  const initStoreFromDb = useWorkspaceStore((s) => s.initStoreFromDb);
  const setOfflineStatus = useWorkspaceStore((s) => s.setOfflineStatus);
  const setScreen = useWorkspaceStore((s) => s.setScreen);
  const setHasUnsavedEdits = useWorkspaceStore((s) => s.setHasUnsavedEdits);
  const enterWorkspaceFromAnalog = useWorkspaceStore((s) => s.enterWorkspaceFromAnalog);
  const setActiveLabTab = useWorkspaceStore((s) => s.setActiveLabTab);
  const setRightDrawer = useWorkspaceStore((s) => s.setRightDrawer);
  const toggleRightDrawer = useWorkspaceStore((s) => s.toggleRightDrawer);
  const setDossierOpen = useWorkspaceStore((s) => s.setDossierOpen);
  const setAddWizardOpen = useWorkspaceStore((s) => s.setAddWizardOpen);
  const selectTarget = useWorkspaceStore((s) => s.selectTarget);
  const selectAnalog = useWorkspaceStore((s) => s.selectAnalog);
  const setElevationOverlayEnabled = useWorkspaceStore((s) => s.setElevationOverlayEnabled);
  const setTransectEndpoints = useWorkspaceStore((s) => s.setTransectEndpoints);
  const enrichTopAnalogsBatch = useWorkspaceStore((s) => s.enrichTopAnalogsBatch);
  const triggerRecenter = useWorkspaceStore((s) => s.triggerRecenter);
  const triggerMapZoom = useWorkspaceStore((s) => s.triggerMapZoom);
  const toggleDevDebugMode = useWorkspaceStore((s) => s.toggleDevDebugMode);

  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [exitingLanding, setExitingLanding] = useState(false);
  const [workspaceVeil, setWorkspaceVeil] = useState(false);
  const [returningToMap, setReturningToMap] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [landingSessionKey, setLandingSessionKey] = useState(0);
  const targetMenuRef = useRef<HTMLDivElement | null>(null);
  const activeChipRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeChipRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [activeAnalogId, screen, acquiringCount]);

  useEffect(() => {
    void initStoreFromDb();
  }, [initStoreFromDb]);

  useEffect(() => {
    const onOnline = () => setOfflineStatus(false);
    const onOffline = () => setOfflineStatus(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [setOfflineStatus]);

  // Initial URL hash & query sync + browser Back/Forward hashchange listener
  useEffect(() => {
    const initial = parseScreenFromLocation(window.location.hash, window.location.search);
    setScreen(initial, { replaceHash: true });

    const params = new URLSearchParams(window.location.search);
    const targetParam = params.get('target');
    const pageParam = params.get('page');
    if (targetParam) selectTarget(targetParam);
    if (pageParam === 'dossier') setDossierOpen(true);

    const onHashChange = () => {
      const next = parseScreenFromLocation(window.location.hash, window.location.search);
      setExitingLanding(false);
      setReturningToMap(false);
      setLeaveConfirmOpen(false);
      setScreen(next, { skipHash: true, focusAnalog: next === 'map' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [selectTarget, setDossierOpen, setScreen]);

  useEffect(() => {
    if (screen === 'workspace') {
      void enrichTopAnalogsBatch(6);
    }
  }, [screen, enrichTopAnalogsBatch]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (targetMenuRef.current && !targetMenuRef.current.contains(e.target as Node)) {
        setTargetMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const targets = useMemo(() => sites.filter((s) => s.body !== 'EARTH'), [sites]);
  const analogs = useMemo(() => sites.filter((s) => s.body === 'EARTH'), [sites]);

  const handleBackToMap = React.useCallback(() => {
    if (returningToMap) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setScreen('map', { focusAnalog: true });
      return;
    }
    setReturningToMap(true);
    window.setTimeout(() => {
      setReturningToMap(false);
      setScreen('map', { focusAnalog: true });
    }, 640);
  }, [returningToMap, setScreen]);

  const handleGoToLanding = React.useCallback(() => {
    if (hasUnsavedEdits) {
      setLeaveConfirmOpen(true);
      return;
    }
    setExitingLanding(false);
    setDossierOpen(false);
    setAddWizardOpen(false);
    setRightDrawer(null);
    setLandingSessionKey((k) => k + 1);
    setScreen('landing');
  }, [hasUnsavedEdits, setAddWizardOpen, setDossierOpen, setRightDrawer, setScreen]);

  const confirmLeaveToLanding = () => {
    setLeaveConfirmOpen(false);
    setHasUnsavedEdits(false);
    setExitingLanding(false);
    setDossierOpen(false);
    setAddWizardOpen(false);
    setRightDrawer(null);
    setLandingSessionKey((k) => k + 1);
    setScreen('landing');
  };

  useEffect(() => {
    if (screen !== 'workspace') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTargetMenuOpen(false);
        if (leaveConfirmOpen) {
          setLeaveConfirmOpen(false);
        } else if (useWorkspaceStore.getState().addWizardOpen) {
          setAddWizardOpen(false);
        } else if (useWorkspaceStore.getState().dossierOpen) {
          setDossierOpen(false);
        } else if (useWorkspaceStore.getState().rightDrawer) {
          setRightDrawer(null);
        } else {
          handleBackToMap();
        }
        return;
      }

      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        toggleDevDebugMode();
        return;
      }
      if (e.key === '1' && targets[0]) selectTarget(targets[0].id);
      else if (e.key === '2' && targets[1]) selectTarget(targets[1].id);
      else if (e.key === '3' && targets[2]) selectTarget(targets[2].id);
      else if (e.key === 'm' || e.key === 'M') {
        setElevationOverlayEnabled(!useWorkspaceStore.getState().elevationOverlayEnabled);
      } else if (e.key === 't' || e.key === 'T') {
        setActiveLabTab('map');
        setTransectEndpoints({ u: 0.16, v: 0.48 }, { u: 0.84, v: 0.52 });
      } else if (e.key === 'd' || e.key === 'D') {
        setDossierOpen(!useWorkspaceStore.getState().dossierOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    screen,
    leaveConfirmOpen,
    targets,
    selectTarget,
    setElevationOverlayEnabled,
    setActiveLabTab,
    setTransectEndpoints,
    setDossierOpen,
    setRightDrawer,
    setAddWizardOpen,
    handleBackToMap,
    toggleDevDebugMode,
  ]);

  const target = targets.find((t) => t.id === activeTargetId) ?? targets[0];
  const analog = analogs.find((a) => a.id === activeAnalogId) ?? analogs[0];

  const match = useMemo(() => {
    if (!target || !analog) return null;
    return evaluateSiteSimilarity(target, analog, weights, filters);
  }, [target, analog, weights, filters]);

  const rankedAnalogs = useMemo(() => {
    if (!target) return [];
    return rankAnalogsForTarget(target, analogs, weights, filters);
  }, [target, analogs, weights, filters]);

  const animatedScore = useAnimatedNumber(match?.scorePct ?? 0, 320);
  const scoreColor = similarityScoreToColor(match?.scorePct ?? null);
  const confidenceBadge = useMemo(
    () =>
      classifyScoreConfidence(
        match?.scorePct ?? null,
        match?.availableCount ?? 0,
        match?.totalCount ?? 7,
        match?.specStatus
      ),
    [match?.scorePct, match?.availableCount, match?.totalCount, match?.specStatus]
  );
  const matchDrivers = useMemo(
    () => summarizeMatchDrivers(match?.parameters ?? []),
    [match?.parameters]
  );

  const useBlur = activeLabTab !== 'terrain3d';
  const floatSurface = useBlur ? 'bg-[#101217]/84 backdrop-blur-md' : 'bg-[#101217]/92';

  if (screen === 'landing') {
    return (
      <div className="relative w-screen h-[100dvh] overflow-hidden bg-[#0B0D10]">
        {exitingLanding && (
          <AnalogSelectMap
            onBack={() => {
              setExitingLanding(false);
              setScreen('landing');
            }}
            onContinue={(analogId, bestTargetId) => {
              setWorkspaceVeil(true);
              enterWorkspaceFromAnalog(analogId, bestTargetId);
            }}
          />
        )}
        <LandingScreen
          key={landingSessionKey}
          isExiting={exitingLanding}
          onGetStarted={() => setExitingLanding(true)}
          onExitComplete={() => {
            setExitingLanding(false);
            setScreen('map', { focusAnalog: false });
          }}
        />
      </div>
    );
  }

  if (screen === 'map') {
    return (
      <AnalogSelectMap
        initialSelectedId={activeAnalogId}
        zoomToInitial={mapFocusAnalogOnOpen}
        onBack={() => {
          setExitingLanding(false);
          setLandingSessionKey((k) => k + 1);
          setScreen('landing');
        }}
        onContinue={(analogId, bestTargetId) => {
          setWorkspaceVeil(true);
          enterWorkspaceFromAnalog(analogId, bestTargetId);
        }}
      />
    );
  }

  const pairingTooltip =
    target && analog ? `${formatSiteFullName(target)} ≈ ${formatSiteFullName(analog)}` : undefined;

  const renderPairingCapsule = (compact = false) => {
    if (!target || !analog) return null;
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-2xl ${floatSurface} border border-white/10 px-4 py-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.45)] ${
          compact ? 'max-w-full' : 'max-w-[min(640px,100%)]'
        }`}
      >
        <div
          title={pairingTooltip}
          className="min-w-0 flex items-center gap-2 text-[14px] xl:text-[15px] whitespace-nowrap"
        >
          <button
            type="button"
            onClick={() => setTargetMenuOpen((o) => !o)}
            aria-label="Select target site"
            aria-expanded={targetMenuOpen}
            data-testid={compact ? 'target-dropdown-trigger-mobile' : 'target-dropdown-trigger'}
            className="inline-flex items-center gap-1 font-semibold text-[#F2F4F8] hover:text-white cursor-pointer min-w-0"
          >
            <span className="truncate max-w-[170px] xl:max-w-[210px]">
              {formatSiteCleanFullName(target)}
            </span>
            <ChevronDown className="w-4 h-4 text-[#9AA3B2] shrink-0" aria-hidden="true" />
          </button>

          <span className="text-[#9AA3B2] shrink-0" aria-hidden="true">
            ≈
          </span>

          <button
            type="button"
            onClick={() => toggleRightDrawer('analog')}
            title={formatSiteFullName(analog)}
            className="font-medium text-[#E2E6ED] hover:text-white cursor-pointer truncate max-w-[165px] xl:max-w-[210px]"
          >
            {formatSiteCleanFullName(analog)}
          </button>
        </div>

        <button
          type="button"
          onClick={() => toggleRightDrawer('analog')}
          aria-label="Inspect active analog breakdown"
          data-testid={compact ? 'hero-similarity-score-mobile' : 'hero-similarity-score'}
          className="shrink-0 flex items-center gap-2.5 pl-3 border-l border-white/12 cursor-pointer transition-opacity duration-150 hover:opacity-85 text-left"
        >
          <span
            className={`font-mono font-bold leading-none tabular-nums ${
              match?.scorePct !== null && match?.scorePct !== undefined
                ? 'text-[26px] xl:text-[32px]'
                : 'text-[15px] xl:text-[17px]'
            }`}
            style={{ color: scoreColor }}
          >
            {match?.scorePct !== null && match?.scorePct !== undefined
              ? `${animatedScore.toFixed(1)}%`
              : match?.specStatus === 'INSUFFICIENT-DATA'
                ? 'Insufficient data'
                : 'N/A'}
          </span>

          <span className="hidden sm:flex flex-col leading-tight">
            <span
              data-testid={compact ? 'score-confidence-label-mobile' : 'score-confidence-label'}
              className={`text-[13px] font-semibold whitespace-nowrap ${
                confidenceBadge.isLow ? 'text-[#D9A441]' : ''
              }`}
              style={!confidenceBadge.isLow ? { color: confidenceBadge.toneColor } : undefined}
            >
              {confidenceBadge.label}
            </span>
            <span className="text-[13px] text-[#9AA3B2] whitespace-nowrap">
              {confidenceBadge.paramSummary}
            </span>
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="relative w-screen h-[100dvh] flex flex-col overflow-hidden bg-[#181B20] text-[#F2F4F8]">
      {/* Full-bleed primary visualization stage — DualMapPanel stays mounted so state/tiles persist across tabs */}
      <main className="no-print relative flex-1 min-h-0 w-full">
        <div
          aria-hidden={activeLabTab !== 'map'}
          className={
            activeLabTab === 'map'
              ? 'absolute inset-0 visible pointer-events-auto'
              : 'absolute inset-0 invisible pointer-events-none'
          }
        >
          <DualMapPanel visible={activeLabTab === 'map'} />
        </div>

        {activeLabTab === 'terrain3d' && (
          <div className="relative z-10 w-full h-full">
            <Terrain3DPreview />
          </div>
        )}

        {activeLabTab === 'spectral' && (
          <div className="relative z-10 w-full h-full bg-[#0B0D10] overflow-y-auto pt-28 pb-24 pl-20 pr-6 sm:pr-10">
            <div className="max-w-[1280px] mx-auto space-y-5">
              <SpectralSignatureChart />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <RadarComparisonChart />
                <TerrainHistograms />
              </div>
            </div>
          </div>
        )}

        {activeLabTab === 'matrix' && (
          <div className="relative z-10 w-full h-full bg-[#0B0D10] overflow-y-auto pt-28 pb-24 pl-20 pr-6 sm:pr-10 flex items-start justify-center">
            <div className="w-full max-w-[1160px] mt-4">
              <SimilarityMatrix />
            </div>
          </div>
        )}
      </main>

      {/* Top HUD Bar: non-overlapping flexbox across desktop (1366/1920) & portrait tablet (768) */}
      <header
        ref={targetMenuRef}
        className="no-print pointer-events-none fixed top-3 inset-x-4 z-[720] flex flex-col items-center gap-1.5"
      >
        <div className="w-full flex items-center justify-between gap-6">
          {/* Top-left brand + back + sync status */}
          <div className="pointer-events-auto flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleGoToLanding}
              data-testid="nav-logo-landing"
              className="px-1.5 py-1 font-mono text-[15px] font-bold text-[#F2F4F8] opacity-85 hover:opacity-100 cursor-pointer transition-opacity duration-150 whitespace-nowrap"
            >
              Terra-Analog
            </button>

            <button
              type="button"
              onClick={handleBackToMap}
              data-testid="nav-back-to-map"
              className="px-2 py-1 font-mono text-[13px] text-[#9AA3B2] hover:text-[#F2F4F8] cursor-pointer transition-colors duration-150 whitespace-nowrap"
            >
              ‹ Back to map
            </button>

            {isOffline && (
              <div
                role="status"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#2A1F14]/90 border border-[#D9A441]/30 text-[13px] text-[#D9A441] shadow-lg whitespace-nowrap"
              >
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Offline</span>
              </div>
            )}

            {!isOffline && acquiringCount > 0 && !mapPickActive && (
              <div
                role="status"
                aria-live="polite"
                className={`hidden xl:block px-3 py-1 rounded-xl ${floatSurface} border border-white/10 text-[13px] text-[#9AA3B2] shadow-lg whitespace-nowrap max-w-[220px] truncate`}
                title={acquiringLabel ?? undefined}
              >
                {acquiringLabel ?? 'Acquiring terrain data…'}
              </div>
            )}
          </div>

          {/* Desktop Center Pairing + Score + Confidence (>= 24px gap guaranteed) */}
          <div className="hidden lg:flex pointer-events-auto min-w-0 flex-1 justify-center">
            {renderPairingCapsule(false)}
          </div>

          {/* Top-right actions */}
          <div className="pointer-events-auto flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setAddWizardOpen(true)}
              data-testid="add-site-button"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/25 ${floatSurface} text-[#F2F4F8] hover:border-white/60 hover:bg-white/10 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-150 shadow-lg`}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Add site</span>
            </button>

            <button
              type="button"
              onClick={() => setDossierOpen(true)}
              className={`px-3.5 py-1.5 rounded-xl border border-white/75 ${floatSurface} text-[#F2F4F8] hover:bg-white hover:text-[#0B0D10] text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-150 shadow-lg`}
            >
              Generate dossier
            </button>

            <div className={`flex items-center gap-1 rounded-xl ${floatSurface} border border-white/10 p-1 shadow-lg`}>
              <button
                type="button"
                onClick={() => toggleRightDrawer('layers')}
                aria-label="Open layers drawer"
                aria-pressed={rightDrawer === 'layers'}
                title="Layers"
                className={`p-1.5 rounded-lg cursor-pointer transition-colors duration-150 ${
                  rightDrawer === 'layers'
                    ? 'bg-white/18 text-white'
                    : 'text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/8'
                }`}
              >
                <Layers className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => toggleRightDrawer('calibration')}
                aria-label="Open calibration drawer"
                aria-pressed={rightDrawer === 'calibration'}
                title="Calibration"
                className={`p-1.5 rounded-lg cursor-pointer transition-colors duration-150 ${
                  rightDrawer === 'calibration'
                    ? 'bg-white/18 text-white'
                    : 'text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/8'
                }`}
              >
                <Sliders className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => toggleRightDrawer('info')}
                aria-label="Open mission info drawer"
                aria-pressed={rightDrawer === 'info'}
                title="Mission info"
                className={`p-1.5 rounded-lg cursor-pointer transition-colors duration-150 ${
                  rightDrawer === 'info'
                    ? 'bg-white/18 text-white'
                    : 'text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/8'
                }`}
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tablet/mobile dedicated second row so header never collides with brand or actions */}
        <div className="lg:hidden pointer-events-auto w-full flex justify-center">
          {renderPairingCapsule(true)}
        </div>

        {/* Single-line "Why this match" summary strip — click opens detailed parameter breakdown */}
        {target && analog && (
          <button
            type="button"
            onClick={() => toggleRightDrawer('analog')}
            data-testid="why-this-match-strip"
            title="Click to inspect full 7-parameter breakdown"
            className={`pointer-events-auto inline-flex items-center gap-2 px-3.5 py-1 rounded-full ${floatSurface} border border-white/10 text-[13px] text-[#C7CEDB] hover:text-white hover:border-white/25 cursor-pointer shadow-md max-w-[min(560px,calc(100vw-32px))] truncate transition-colors duration-150`}
          >
            <span className="truncate">
              {match?.specStatus === 'INSUFFICIENT-DATA' || match?.scorePct === null || match?.scorePct === undefined
                ? `Terrain comparison unavailable: ${target?.body || 'Planetary'} DEM not loaded`
                : matchDrivers.line}
            </span>
          </button>
        )}

        {/* Target switcher dropdown */}
        {targetMenuOpen && target && (
          <div
            role="menu"
            aria-label="Planetary target sites"
            className={`pointer-events-auto mt-1 w-80 max-h-72 overflow-y-auto rounded-xl ${floatSurface} border border-white/12 p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.6)] animate-[panelReveal_180ms_ease-out]`}
          >
            {targets.map((item) => {
              const selected = item.id === target.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    selectTarget(item.id);
                    setTargetMenuOpen(false);
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-lg text-left flex items-center justify-between gap-3 text-[14px] cursor-pointer transition-colors duration-150 ${
                    selected
                      ? 'bg-white/15 text-[#F2F4F8] font-semibold'
                      : 'text-[#E2E6ED] hover:bg-white/8'
                  }`}
                >
                  <span className="truncate">{formatSiteFullName(item)}</span>
                  <span className="font-mono text-[13px] text-[#9AA3B2] shrink-0">
                    {item.body === 'MOON' ? 'Moon' : 'Mars'}
                  </span>
                </button>
              );
            })}
            <div className="border-t border-white/10 mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setTargetMenuOpen(false);
                  setAddWizardOpen(true);
                }}
                className="w-full px-3.5 py-2 rounded-lg text-left flex items-center gap-2 text-[13px] font-medium text-[#A8C09B] hover:bg-white/8 cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add new planetary or Earth site</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Unified Left Vertical Control Rail (Views + Zoom +/- + Recenter ROI) */}
      <nav
        aria-label="Analytical views and map controls"
        className={`no-print fixed left-4 top-1/2 -translate-y-1/2 z-[700] flex flex-col gap-1.5 rounded-2xl ${floatSurface} border border-white/10 p-1.5 shadow-lg`}
      >
        {RAIL_VIEWS.map(({ id, label, Icon }) => {
          const active = activeLabTab === id;
          return (
            <div key={id} className="relative group">
              <button
                type="button"
                onClick={() => setActiveLabTab(id)}
                aria-label={label}
                aria-pressed={active}
                className={`p-2.5 rounded-xl cursor-pointer transition-colors duration-150 ${
                  active
                    ? 'bg-white/18 text-white'
                    : 'text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/8'
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1 rounded-lg bg-[#101217]/95 text-[13px] text-[#F2F4F8] whitespace-nowrap shadow-lg"
              >
                {label}
              </span>
            </div>
          );
        })}

        {activeLabTab === 'map' && (
          <>
            <div className="h-px bg-white/10 my-0.5" />
            <div className="relative group">
              <button
                type="button"
                onClick={() => triggerMapZoom(1)}
                aria-label="Zoom in"
                data-testid="map-zoom-in"
                className="p-2.5 rounded-xl text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/8 cursor-pointer transition-colors duration-150"
              >
                <Plus className="w-4 h-4" />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1 rounded-lg bg-[#101217]/95 text-[13px] text-[#F2F4F8] whitespace-nowrap shadow-lg"
              >
                Zoom in
              </span>
            </div>

            <div className="relative group">
              <button
                type="button"
                onClick={() => triggerMapZoom(-1)}
                aria-label="Zoom out"
                data-testid="map-zoom-out"
                className="p-2.5 rounded-xl text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/8 cursor-pointer transition-colors duration-150"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1 rounded-lg bg-[#101217]/95 text-[13px] text-[#F2F4F8] whitespace-nowrap shadow-lg"
              >
                Zoom out
              </span>
            </div>

            <div className="relative group">
              <button
                type="button"
                onClick={triggerRecenter}
                aria-label="Recenter on 20x20 km ROI"
                data-testid="map-recenter-roi"
                className="p-2.5 rounded-xl text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/8 cursor-pointer transition-colors duration-150"
              >
                <LocateFixed className="w-4 h-4" />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-full top-1/2 -translate-y-1/2 ml-2.5 px-2.5 py-1 rounded-lg bg-[#101217]/95 text-[13px] text-[#F2F4F8] whitespace-nowrap shadow-lg"
              >
                Recenter ROI
              </span>
            </div>
          </>
        )}
      </nav>

      {/* Bottom Footer Row: coordinate telemetry left + analog chip scroller right (never overlaps!) */}
      <footer
        className={`no-print pointer-events-none fixed bottom-3 inset-x-4 z-[700] flex items-center gap-4 transition-[padding] duration-250 ease-out ${
          rightDrawer ? 'lg:pr-[416px]' : ''
        }`}
      >
        {activeLabTab === 'map' && target && (
          <div
            data-testid="map-scale-coords"
            className="pointer-events-auto shrink-0 max-w-[300px] sm:max-w-[330px] truncate flex items-center gap-2 rounded-lg bg-[#101217]/88 border border-white/10 backdrop-blur-md px-3 py-1.5 font-mono text-[13px] text-[#E2E6ED] tabular-nums shadow-lg"
          >
            <span className="inline-flex items-center gap-1 text-[#9AA3B2] shrink-0">
              <Compass className="w-3.5 h-3.5" aria-hidden="true" />N
            </span>
            <span className="truncate">
              {cursorTelemetry
                ? `${cursorTelemetry.lat.toFixed(3)}°, ${cursorTelemetry.lon.toFixed(3)}° · ${
                    cursorTelemetry.elevM !== null ? `${cursorTelemetry.elevM} m` : 'no data'
                  } · ${cursorTelemetry.slopeDeg !== null ? `${cursorTelemetry.slopeDeg}°` : 'no data'}`
                : formatCoordLabel(target.lat, target.lon)}
            </span>
          </div>
        )}

        <div
          aria-label="Earth analog selector"
          className="pointer-events-auto flex-1 min-w-0 no-scrollbar overflow-x-auto flex items-center gap-1.5 px-2 py-0.5 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-16px),transparent)]"
        >
          {rankedAnalogs.map((item) => {
            const isSelected = item.analog.id === activeAnalogId;
            return (
              <button
                key={item.analog.id}
                ref={isSelected ? activeChipRef : undefined}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    toggleRightDrawer('analog');
                  } else {
                    selectAnalog(item.analog.id);
                    setRightDrawer('analog');
                  }
                }}
                aria-pressed={isSelected}
                data-testid={`analog-chip-${item.analog.id}`}
                className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] cursor-pointer transition-all duration-150 shadow-md whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#222630]/95 text-[#F2F4F8] font-semibold ring-1 ring-white/40'
                    : `${floatSurface} text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-[#191D24]/90`
                }`}
              >
                <CountryFlag isoCode={item.analog.isoCode} />
                <span>{formatSiteShortName(item.analog)}</span>
                <span className="font-mono tabular-nums text-[#E2E6ED]">
                  {formatConsistentScorePct(item.result.scorePct)}
                </span>
              </button>
            );
          })}
        </div>
      </footer>

      <RightDrawer />
      <DossierStepperModal />
      <AddSiteWizardModal />

      {leaveConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-workspace-title"
          data-testid="leave-workspace-dialog"
          className="fixed inset-0 z-[1400] bg-black/75 flex items-center justify-center p-4 font-mono"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#101217] border border-white/12 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.85)] space-y-4">
            <h2 id="leave-workspace-title" className="text-[18px] font-bold text-[#F2F4F8]">
              Leave workspace?
            </h2>
            <p className="text-[14px] text-[#C7CEDB] leading-relaxed">
              Your sites are saved, unsaved form edits will be lost.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setLeaveConfirmOpen(false)}
                data-testid="leave-workspace-stay"
                className="px-4 py-2 rounded-lg bg-[#161920] hover:bg-white/10 text-[#F2F4F8] text-[14px] font-medium cursor-pointer"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={confirmLeaveToLanding}
                data-testid="leave-workspace-confirm"
                className="px-4 py-2 rounded-lg bg-[#F2F4F8] hover:bg-white text-[#0B0D10] text-[14px] font-bold cursor-pointer"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {returningToMap && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[1250] pointer-events-none overflow-hidden"
        >
          <div
            style={{
              left: '50%',
              top: '50%',
              width: '260vmax',
              height: '260vmax',
              animation: 'bubbleShrinkExit 650ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
            }}
            className="absolute rounded-full bg-[#8FA886]"
          />
        </div>
      )}

      {workspaceVeil && (
        <div
          aria-hidden="true"
          onAnimationEnd={() => setWorkspaceVeil(false)}
          style={{ animation: 'workspaceRevealFade 420ms ease-out forwards' }}
          className="fixed inset-0 z-[1200] pointer-events-none bg-[#8FA886]"
        />
      )}
    </div>
  );
}
