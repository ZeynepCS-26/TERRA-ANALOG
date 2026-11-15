import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileUp,
  Image as ImageIcon,
  MapPin,
  Search,
  X,
} from 'lucide-react';
import { buildEmptySiteRecord, computeBoundsFromCenter } from '../../data/candidates';
import { parseGeoTiffBuffer } from '../../lib/sources/geotiffClient';
import {
  analyzeSiteImageWithGemini,
  searchNomenclature,
  type NomenclatureSearchResult,
} from '../../lib/sources/externalDataPipeline';
import { runTerrainExtractionWorker } from '../../lib/terrain/terrainWorkerClient';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import type { BodyType, CrewOverrides, DemGridData, GeminiImageEstimate, IngestMethod } from '../../types/site';

type WizardEntryMode = 'coords' | 'nomenclature' | 'map_pick' | 'image_upload' | 'geotiff_upload';

const ENTRY_METHODS: Array<{
  id: WizardEntryMode;
  title: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'coords',
    title: 'Coordinates',
    desc: 'Enter latitude, longitude, radius (km), and body.',
    Icon: Compass,
  },
  {
    id: 'nomenclature',
    title: 'Name search',
    desc: 'Autocomplete craters, valleys & sites via USGS Gazetteer / GeoNames.',
    Icon: Search,
  },
  {
    id: 'map_pick',
    title: 'Pick from map',
    desc: 'Click a point or drag a box directly on Mars, Moon, or Earth.',
    Icon: MapPin,
  },
  {
    id: 'image_upload',
    title: 'Surface image (PNG/JPG)',
    desc: 'Analyze morphology, texture & geology with Gemini multimodal.',
    Icon: ImageIcon,
  },
  {
    id: 'geotiff_upload',
    title: 'GeoTIFF DEM raster',
    desc: 'Load an orbital or drone elevation GeoTIFF directly in browser.',
    Icon: FileUp,
  },
];

export const AddSiteWizardModal: React.FC = () => {
  const addWizardOpen = useWorkspaceStore((s) => s.addWizardOpen);
  const mapPick = useWorkspaceStore((s) => s.mapPick);
  const setAddWizardOpen = useWorkspaceStore((s) => s.setAddWizardOpen);
  const startMapPickMode = useWorkspaceStore((s) => s.startMapPickMode);
  const addOrUpdateSite = useWorkspaceStore((s) => s.addOrUpdateSite);
  const setHasUnsavedEdits = useWorkspaceStore((s) => s.setHasUnsavedEdits);

  const [step, setStep] = useState<0 | 1>(0);
  const [mode, setMode] = useState<WizardEntryMode>('coords');
  const [body, setBody] = useState<BodyType>('MARS');
  const [name, setName] = useState('');
  const [latStr, setLatStr] = useState('-5.4');
  const [lonStr, setLonStr] = useState('137.8');
  const [radiusStr, setRadiusStr] = useState('12');
  const [notes, setNotes] = useState('');

  // Nomenclature search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NomenclatureSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Image upload + Gemini estimate state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [geminiEstimate, setGeminiEstimate] = useState<GeminiImageEstimate | null>(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);

  // GeoTIFF upload state
  const [uploadedDem, setUploadedDem] = useState<DemGridData | null>(null);
  const [parsingTiff, setParsingTiff] = useState(false);

  // Optional crew-reported field overrides
  const [showCrewFields, setShowCrewFields] = useState(false);
  const [crewTempMin, setCrewTempMin] = useState('');
  const [crewTempMax, setCrewTempMax] = useState('');
  const [crewSlope, setCrewSlope] = useState('');
  const [crewLithology, setCrewLithology] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync picked map coordinates back into wizard step 1
  useEffect(() => {
    if (mapPick.pickedLat !== null && mapPick.pickedLon !== null) {
      setMode('map_pick');
      setBody(mapPick.body);
      setLatStr(String(mapPick.pickedLat));
      setLonStr(String(mapPick.pickedLon));
      if (mapPick.pickedRadiusKm !== null) {
        setRadiusStr(String(mapPick.pickedRadiusKm));
      }
      if (!name.trim()) {
        setName(
          `${mapPick.body === 'EARTH' ? 'Field Sector' : 'Target ROI'} (${mapPick.pickedLat.toFixed(
            2
          )}°, ${mapPick.pickedLon.toFixed(2)}°)`
        );
      }
      setStep(1);
    }
  }, [mapPick.pickedLat, mapPick.pickedLon, mapPick.pickedRadiusKm, mapPick.body, name]);

  if (!addWizardOpen) return null;

  const handleClose = () => {
    setErrorMsg(null);
    setHasUnsavedEdits(false);
    setAddWizardOpen(false);
  };

  const handleSearchNomenclature = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setErrorMsg(null);
    try {
      const hits = await searchNomenclature(searchQuery, body);
      setSearchResults(hits);
      if (hits.length === 0) {
        setErrorMsg('No matching features returned from planetary nomenclature / geocoder.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleImageFile = async (file: File) => {
    setErrorMsg(null);
    setAnalyzingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
      setImagePreview(dataUrl);
      setImageMime(file.type || 'image/jpeg');
      if (!name.trim()) {
        setName(file.name.replace(/\.[^.]+$/, ''));
      }
      const estimate = await analyzeSiteImageWithGemini(dataUrl, file.type || 'image/jpeg', body);
      setGeminiEstimate({ ...estimate, imagePreviewDataUrl: dataUrl });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gemini image analysis failed.');
    } finally {
      setAnalyzingImage(false);
    }
  };

  const handleGeoTiffFile = async (file: File) => {
    setErrorMsg(null);
    setParsingTiff(true);
    try {
      const buf = await file.arrayBuffer();
      const lat = Number(latStr) || 0;
      const lon = Number(lonStr) || 0;
      const rad = Math.max(1, Number(radiusStr) || 10);
      const { bounds } = computeBoundsFromCenter(lat, lon, rad, body);
      const dem = await parseGeoTiffBuffer(buf, body, `Uploaded GeoTIFF (${file.name})`, bounds, 80);
      setUploadedDem(dem);
      setLatStr(String(Number(((dem.bounds.minLat + dem.bounds.maxLat) / 2).toFixed(4))));
      setLonStr(String(Number(((dem.bounds.minLon + dem.bounds.maxLon) / 2).toFixed(4))));
      if (!name.trim()) {
        setName(file.name.replace(/\.[^.]+$/, ''));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid or unreadable GeoTIFF DEM file.');
    } finally {
      setParsingTiff(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const lat = Number(latStr);
    const lon = Number(lonStr);
    const radiusKm = Number(radiusStr);

    if (!name.trim()) {
      setErrorMsg('Enter a site name.');
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setErrorMsg('Latitude must be between -90 and 90.');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 360) {
      setErrorMsg('Longitude must be between -180 and 360.');
      return;
    }
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 250) {
      setErrorMsg('Radius must be between 1 and 250 km.');
      return;
    }
    if (mode === 'geotiff_upload' && !uploadedDem) {
      setErrorMsg('Upload a GeoTIFF (.tif/.tiff) elevation file first.');
      return;
    }
    if (mode === 'image_upload' && !geminiEstimate) {
      setErrorMsg('Upload and analyze a PNG/JPG image first.');
      return;
    }

    const normalizedLon = lon > 180 ? lon - 360 : lon;
    const id = `${body.toLowerCase()}_${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 28)}_${Date.now().toString(36)}`;

    const ingestMethod: IngestMethod = mode;
    const site = buildEmptySiteRecord({
      id,
      name: name.trim(),
      body,
      lat,
      lon: normalizedLon,
      radiusKm,
      ingestMethod,
      notes: notes.trim(),
      bounds: uploadedDem?.bounds,
    });

    if (geminiEstimate) {
      site.geminiEstimate = geminiEstimate;
      if (!site.summary) {
        site.summary = `Image estimate: ${geminiEstimate.morphology} · ${geminiEstimate.probableGeology}`;
      }
    }

    const hasCrewData =
      crewTempMin.trim() !== '' ||
      crewTempMax.trim() !== '' ||
      crewSlope.trim() !== '' ||
      crewLithology.trim() !== '';

    if (hasCrewData) {
      const overrides: CrewOverrides = {
        tempMinC: crewTempMin.trim() !== '' ? Number(crewTempMin) : null,
        tempMaxC: crewTempMax.trim() !== '' ? Number(crewTempMax) : null,
        meanSlopeDeg: crewSlope.trim() !== '' ? Number(crewSlope) : null,
        lithology: crewLithology.trim() !== '' ? crewLithology.trim() : null,
        updatedAtIso: new Date().toISOString(),
      };
      site.crewOverrides = overrides;
    }

    setSubmitting(true);
    try {
      if (uploadedDem) {
        site.demGrid = uploadedDem;
        site.demStatus = 'ready';
        site.features = await runTerrainExtractionWorker(uploadedDem);
      }
      await addOrUpdateSite(site, !uploadedDem);
      setHasUnsavedEdits(false);
      setStep(0);
      setName('');
      setNotes('');
      setUploadedDem(null);
      setGeminiEstimate(null);
      setImagePreview(null);
      setAddWizardOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save site.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add site wizard"
      data-testid="add-site-wizard"
      className="fixed inset-0 z-[1350] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl max-h-[90vh] rounded-2xl bg-[#101217] border border-white/10 flex flex-col overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.8)] font-mono">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div>
            <div className="text-[13px] text-[#9AA3B2]">
              Step {step + 1} of 2 · Site ingestion wizard
            </div>
            <h2 className="text-[18px] font-bold text-[#F2F4F8]">
              {step === 0 ? 'Choose input method' : 'Configure site & telemetry'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close add site wizard"
            className="p-2 rounded-lg text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="rounded-lg bg-[#2A1414] border border-[#C8553D]/50 px-4 py-3 text-[13px] text-[#E08A5B]">
              {errorMsg}
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <div className="text-[13px] text-[#9AA3B2] mb-2">Target planetary body</div>
                <div className="grid grid-cols-3 gap-2">
                  {(['MARS', 'MOON', 'EARTH'] as BodyType[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBody(b)}
                      className={`px-3 py-2.5 rounded-lg text-[13px] font-bold cursor-pointer transition-colors ${
                        body === b
                          ? 'bg-white/15 text-[#F2F4F8] ring-1 ring-white/40'
                          : 'bg-white/5 text-[#9AA3B2] hover:text-[#F2F4F8]'
                      }`}
                    >
                      {b === 'MARS' ? 'Mars' : b === 'MOON' ? 'Moon' : 'Earth'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ENTRY_METHODS.map(({ id, title, desc, Icon }) => {
                  const active = mode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={`wizard-method-${id}`}
                      onClick={() => {
                        setMode(id);
                        setErrorMsg(null);
                        if (id === 'map_pick') {
                          startMapPickMode(body);
                        } else {
                          setStep(1);
                        }
                      }}
                      className={`p-4 rounded-xl text-left transition-colors cursor-pointer flex items-start gap-3 ${
                        active
                          ? 'bg-white/12 ring-1 ring-white/40 text-[#F2F4F8]'
                          : 'bg-[#161920] hover:bg-white/8 text-[#F2F4F8]'
                      }`}
                    >
                      <Icon className="w-4 h-4 mt-1 text-[#9AA3B2] shrink-0" />
                      <div>
                        <div className="text-[14px] font-bold">{title}</div>
                        <div className="text-[13px] text-[#9AA3B2] mt-1 leading-snug">{desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <form id="add-site-form" onSubmit={handleSubmit} className="space-y-4">
              {mode === 'nomenclature' && (
                <div className="rounded-xl bg-[#161920] p-4 space-y-3">
                  <label className="block text-[13px] text-[#9AA3B2]">
                    Search planetary feature or Earth locality ({body})
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleSearchNomenclature();
                        }
                      }}
                      placeholder={body === 'EARTH' ? 'e.g. Atacama, Iceland' : 'e.g. Gale, Tycho'}
                      className="flex-1 rounded-lg bg-[#0D0F13] border border-white/12 px-3 py-2 text-[14px] text-[#F2F4F8]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSearchNomenclature()}
                      disabled={searching}
                      className="px-4 py-2 rounded-lg bg-[#F2F4F8] text-[#0B0D10] text-[13px] font-bold cursor-pointer disabled:opacity-60"
                    >
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1 pt-1">
                      {searchResults.map((hit) => (
                        <button
                          key={hit.id}
                          type="button"
                          onClick={() => {
                            setBody(hit.body);
                            setName(`${hit.name} (${hit.body})`);
                            setLatStr(String(Number(hit.lat.toFixed(4))));
                            setLonStr(String(Number(hit.lon.toFixed(4))));
                            setNotes(`${hit.featureType} · ${hit.source}`);
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-[#0D0F13] hover:bg-white/10 text-left flex items-center justify-between text-[13px] cursor-pointer"
                        >
                          <span className="text-[#F2F4F8] font-medium">
                            {hit.name}{' '}
                            <span className="text-[#9AA3B2]">· {hit.featureType}</span>
                          </span>
                          <span className="text-[#9AA3B2] tabular-nums">
                            {hit.lat.toFixed(2)}°, {hit.lon.toFixed(2)}°
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {mode === 'image_upload' && (
                <div className="rounded-xl bg-[#161920] p-4 space-y-3">
                  <label className="block text-[13px] text-[#9AA3B2]">
                    Upload terrain photo or orbital frame (PNG/JPG)
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleImageFile(f);
                    }}
                    className="block w-full text-[13px] text-[#E2E6ED] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-white/15 file:text-[#F2F4F8] file:cursor-pointer"
                  />
                  {analyzingImage && (
                    <div className="text-[13px] text-[#D9A441]">
                      Analyzing surface morphology with Gemini ({imageMime})…
                    </div>
                  )}
                  {imagePreview && (
                    <div className="flex gap-3 items-start pt-2">
                      <img
                        src={imagePreview}
                        alt="Uploaded terrain preview"
                        className="w-24 h-24 object-cover rounded-lg border border-white/10"
                      />
                      {geminiEstimate && (
                        <div className="text-[13px] space-y-1 text-[#E2E6ED]">
                          <div className="text-[#D9A441] font-bold">
                            estimated from image · {geminiEstimate.confidencePct}% confidence
                          </div>
                          <div>Morphology: {geminiEstimate.morphology}</div>
                          <div>Texture: {geminiEstimate.surfaceTexture}</div>
                          <div>Geology: {geminiEstimate.probableGeology}</div>
                          <div>
                            Slope ~{geminiEstimate.estimatedMeanSlopeDeg ?? 'N/A'}° · Relief ~
                            {geminiEstimate.estimatedReliefM ?? 'N/A'} m
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {mode === 'geotiff_upload' && (
                <div className="rounded-xl bg-[#161920] p-4 space-y-3">
                  <label className="block text-[13px] text-[#9AA3B2]">
                    Upload GeoTIFF elevation DEM (.tif / .tiff)
                  </label>
                  <input
                    type="file"
                    accept=".tif,.tiff,image/tiff"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleGeoTiffFile(f);
                    }}
                    className="block w-full text-[13px] text-[#E2E6ED] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-white/15 file:text-[#F2F4F8] file:cursor-pointer"
                  />
                  {parsingTiff && (
                    <div className="text-[13px] text-[#9AA3B2]">Parsing GeoTIFF raster bands…</div>
                  )}
                  {uploadedDem && (
                    <div className="text-[13px] text-[#8FA886]">
                      Parsed {uploadedDem.width}×{uploadedDem.height} grid (~
                      {uploadedDem.resolutionMPerPx} m/px) · {uploadedDem.source}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[13px] text-[#9AA3B2] mb-1">Site name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setHasUnsavedEdits(true);
                    }}
                    placeholder="e.g. Gale Crater, Mars"
                    className="w-full rounded-lg bg-[#161920] border border-white/12 px-3 py-2 text-[14px] text-[#F2F4F8]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] text-[#9AA3B2] mb-1">Body</label>
                  <select
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value as BodyType);
                      setHasUnsavedEdits(true);
                    }}
                    className="w-full rounded-lg bg-[#161920] border border-white/12 px-3 py-2 text-[14px] text-[#F2F4F8]"
                  >
                    <option value="MARS">Mars</option>
                    <option value="MOON">Moon</option>
                    <option value="EARTH">Earth</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] text-[#9AA3B2] mb-1">Radius (km)</label>
                  <input
                    type="number"
                    min={1}
                    max={250}
                    step="0.5"
                    required
                    value={radiusStr}
                    onChange={(e) => {
                      setRadiusStr(e.target.value);
                      setHasUnsavedEdits(true);
                    }}
                    className="w-full rounded-lg bg-[#161920] border border-white/12 px-3 py-2 text-[14px] text-[#F2F4F8]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] text-[#9AA3B2] mb-1">Latitude (°)</label>
                  <input
                    type="number"
                    step="0.0001"
                    min={-90}
                    max={90}
                    required
                    value={latStr}
                    onChange={(e) => {
                      setLatStr(e.target.value);
                      setHasUnsavedEdits(true);
                    }}
                    className="w-full rounded-lg bg-[#161920] border border-white/12 px-3 py-2 text-[14px] text-[#F2F4F8]"
                  />
                </div>
                <div>
                  <label className="block text-[13px] text-[#9AA3B2] mb-1">Longitude (°)</label>
                  <input
                    type="number"
                    step="0.0001"
                    min={-180}
                    max={360}
                    required
                    value={lonStr}
                    onChange={(e) => {
                      setLonStr(e.target.value);
                      setHasUnsavedEdits(true);
                    }}
                    className="w-full rounded-lg bg-[#161920] border border-white/12 px-3 py-2 text-[14px] text-[#F2F4F8]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[13px] text-[#9AA3B2] mb-1">Field notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setHasUnsavedEdits(true);
                    }}
                    placeholder="Site context, landing constraints, or regolith observations…"
                    className="w-full rounded-lg bg-[#161920] border border-white/12 px-3 py-2 text-[14px] text-[#F2F4F8]"
                  />
                </div>
              </div>

              {/* Optional Crew-Reported Field Override Section */}
              <div className="rounded-xl bg-[#161920] p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowCrewFields((v) => !v)}
                  className="text-[13px] font-bold text-[#F2F4F8] flex items-center justify-between w-full cursor-pointer"
                >
                  <span>Manual crew-reported telemetry (optional override)</span>
                  <span className="text-[#9AA3B2]">{showCrewFields ? 'Hide' : 'Expand'}</span>
                </button>
                {showCrewFields && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <label className="block text-[13px] text-[#9AA3B2] mb-1">Min temp (°C)</label>
                      <input
                        type="number"
                        value={crewTempMin}
                        onChange={(e) => setCrewTempMin(e.target.value)}
                        placeholder="-25"
                        className="w-full rounded-lg bg-[#0D0F13] border border-white/12 px-3 py-2 text-[13px] text-[#F2F4F8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] text-[#9AA3B2] mb-1">Max temp (°C)</label>
                      <input
                        type="number"
                        value={crewTempMax}
                        onChange={(e) => setCrewTempMax(e.target.value)}
                        placeholder="18"
                        className="w-full rounded-lg bg-[#0D0F13] border border-white/12 px-3 py-2 text-[13px] text-[#F2F4F8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] text-[#9AA3B2] mb-1">Mean slope (°)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={crewSlope}
                        onChange={(e) => setCrewSlope(e.target.value)}
                        placeholder="14.5"
                        className="w-full rounded-lg bg-[#0D0F13] border border-white/12 px-3 py-2 text-[13px] text-[#F2F4F8]"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[13px] text-[#9AA3B2] mb-1">
                        Rock type / regolith description
                      </label>
                      <input
                        type="text"
                        value={crewLithology}
                        onChange={(e) => setCrewLithology(e.target.value)}
                        placeholder="e.g. Vesicular basalt cobbles over compacted dust"
                        className="w-full rounded-lg bg-[#0D0F13] border border-white/12 px-3 py-2 text-[13px] text-[#F2F4F8]"
                      />
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/8">
          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(0)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] text-[#E2E6ED] hover:bg-white/10 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              Methods
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startMapPickMode(body)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] text-[#9AA3B2] hover:text-[#F2F4F8] hover:bg-white/10 cursor-pointer"
            >
              <MapPin className="w-4 h-4" />
              Pick on map
            </button>
          )}

          {step === 0 ? (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#F2F4F8] hover:bg-white text-[#0B0D10] text-[13px] font-bold cursor-pointer"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="submit"
              form="add-site-form"
              disabled={submitting || analyzingImage || parsingTiff}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#F2F4F8] hover:bg-white text-[#0B0D10] text-[13px] font-bold cursor-pointer disabled:opacity-60"
            >
              <Check className="w-4 h-4" />
              {submitting ? 'Acquiring terrain data…' : 'Save & analyze'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
