import type { BodyType, GeoBounds, IngestMethod, SiteRecord } from '../types/site';

export interface CandidateSeed {
  id: string;
  name: string;
  country: string;
  isoCode: string;
  lat: number;
  lon: number;
  radiusKm: number;
  fieldNote: string;
}

export interface TargetSeed {
  id: string;
  name: string;
  body: Extract<BodyType, 'MARS' | 'MOON'>;
  lat: number;
  lon: number;
  radiusKm: number;
  missionProgram: string;
  fieldNote: string;
}

export function computeBoundsFromCenter(
  lat: number,
  lon: number,
  radiusKm: number,
  body: BodyType
): { bounds: GeoBounds; spanDeg: number } {
  const planetRadiusKm = body === 'MOON' ? 1737.4 : body === 'MARS' ? 3389.5 : 6371.0;
  const latDegPerKm = 180 / (Math.PI * planetRadiusKm);
  const halfLat = Math.max(0.03, Math.min(8, radiusKm * latDegPerKm));
  const cosLat = Math.max(0.18, Math.cos((lat * Math.PI) / 180));
  const halfLon = Math.max(0.03, Math.min(18, halfLat / cosLat));
  return {
    bounds: {
      minLat: Math.max(-89.95, lat - halfLat),
      maxLat: Math.min(89.95, lat + halfLat),
      minLon: lon - halfLon,
      maxLon: lon + halfLon,
    },
    spanDeg: Number((halfLat * 2).toFixed(4)),
  };
}

export function buildEmptySiteRecord(params: {
  id: string;
  name: string;
  body: BodyType;
  lat: number;
  lon: number;
  radiusKm: number;
  ingestMethod: IngestMethod;
  country?: string;
  isoCode?: string;
  summary?: string;
  missionProgram?: string;
  notes?: string;
  bounds?: GeoBounds;
}): SiteRecord {
  const computed = computeBoundsFromCenter(params.lat, params.lon, params.radiusKm, params.body);
  const bounds = params.bounds ?? computed.bounds;
  const spanDeg = params.bounds
    ? Number(Math.abs(params.bounds.maxLat - params.bounds.minLat).toFixed(4))
    : computed.spanDeg;
  const now = new Date().toISOString();

  return {
    id: params.id,
    name: params.name,
    body: params.body,
    lat: Number(params.lat.toFixed(4)),
    lon: Number(params.lon.toFixed(4)),
    radiusKm: Number(params.radiusKm.toFixed(2)),
    spanDeg,
    bounds,
    country: params.country,
    isoCode: params.isoCode,
    summary: params.summary,
    missionProgram: params.missionProgram,
    ingestMethod: params.ingestMethod,
    notes: params.notes ?? params.summary ?? '',
    createdAtIso: now,
    updatedAtIso: now,
    demStatus: 'idle',
    demError: null,
    demGrid: null,
    features: null,
    climate: null,
    geology: null,
    geminiEstimate: null,
    crewOverrides: null,
  };
}

/**
 * Default planetary target coordinates only — all terrain, climate, and geology
 * values are acquired at runtime from NASA Trek DEMs, USGS Astrogeology, and Diviner/MCD tables.
 */
export const INITIAL_TARGET_SEEDS: TargetSeed[] = [
  {
    id: 'jezero',
    name: 'Jezero Crater, Mars',
    body: 'MARS',
    lat: 18.38,
    lon: 77.58,
    radiusKm: 12,
    missionProgram: 'Mars 2020 / Perseverance',
    fieldNote: 'Noachian-Hesperian lacustrine delta basin in Syrtis Major quadrangle.',
  },
  {
    id: 'shackleton',
    name: 'Shackleton Crater, Moon',
    body: 'MOON',
    lat: -89.65,
    lon: 0.0,
    radiusKm: 14,
    missionProgram: 'Artemis III / VIPER',
    fieldNote: 'Lunar south pole rim-to-floor cold-trap crater near Connecting Ridge.',
  },
  {
    id: 'valles_marineris',
    name: 'Valles Marineris, Mars',
    body: 'MARS',
    lat: -13.8,
    lon: -59.2,
    radiusKm: 18,
    missionProgram: 'Coprates Chasma Canyon Recon',
    fieldNote: 'Deep tectonic graben trough with layered basalt escarpments and sulfate aprons.',
  },
];

/**
 * Catalog of 48 real-world terrestrial analog sites (coordinates + field notes only).
 * Terrain features, climate, and geology are computed lazily from AWS Terrain Tiles,
 * NASA POWER / Open-Meteo, and Macrostrat and cached in IndexedDB.
 */
export const EARTH_ANALOG_CATALOG: CandidateSeed[] = [
  {
    id: 'salda_lake',
    name: 'Salda Lake, Turkey',
    country: 'Turkey',
    isoCode: 'TR',
    lat: 37.55,
    lon: 29.68,
    radiusKm: 10,
    fieldNote: 'Hydromagnesite carbonate shoreline & ultramafic alluvial fan delta.',
  },
  {
    id: 'atacama',
    name: 'Atacama Desert (Yungay), Chile',
    country: 'Chile',
    isoCode: 'CL',
    lat: -24.1,
    lon: -69.95,
    radiusKm: 10,
    fieldNote: 'Hyper-arid nitrate-sulfate crust & oxidized volcanic alluvial fans.',
  },
  {
    id: 'askja_caldera',
    name: 'Askja Caldera, Iceland',
    country: 'Iceland',
    isoCode: 'IS',
    lat: 65.03,
    lon: -16.75,
    radiusKm: 11,
    fieldNote: 'Unweathered tholeiitic basalt lava fields & steep caldera scoria rims.',
  },
  {
    id: 'devon_island',
    name: 'Devon Island / Haughton Crater, Canada',
    country: 'Canada',
    isoCode: 'CA',
    lat: 75.37,
    lon: -89.68,
    radiusKm: 11,
    fieldNote: 'High-Arctic polymict impact breccia structure & permafrost terrain.',
  },
  {
    id: 'mauna_kea',
    name: 'Mauna Kea Summit, Hawaii',
    country: 'USA',
    isoCode: 'US',
    lat: 19.82,
    lon: -155.47,
    radiusKm: 10,
    fieldNote: 'High-altitude basaltic tephra & cinder cones used in ISRU rover trials.',
  },
  {
    id: 'rio_tinto',
    name: 'Rio Tinto, Spain',
    country: 'Spain',
    isoCode: 'ES',
    lat: 37.7,
    lon: -6.55,
    radiusKm: 10,
    fieldNote: 'Acidic iron-sulfate gossan terraces & jarosite-hematite mineral beds.',
  },
  {
    id: 'danakil',
    name: 'Danakil Depression, Ethiopia',
    country: 'Ethiopia',
    isoCode: 'ET',
    lat: 14.24,
    lon: 40.3,
    radiusKm: 10,
    fieldNote: 'Extreme evaporite salt pans, hydrothermal sulfur crusts & rift volcanics.',
  },
  {
    id: 'death_valley',
    name: 'Death Valley (Ubehebe), USA',
    country: 'USA',
    isoCode: 'US',
    lat: 37.01,
    lon: -117.45,
    radiusKm: 10,
    fieldNote: 'Maar crater tephra, desert pavement & arid alluvial bajada slopes.',
  },
  {
    id: 'svalbard',
    name: 'Svalbard (Bockfjorden), Norway',
    country: 'Norway',
    isoCode: 'NO',
    lat: 79.45,
    lon: 13.3,
    radiusKm: 10,
    fieldNote: 'Arctic permafrost carbonate-bearing basalts tested for ExoMars/AMASE.',
  },
  {
    id: 'iceland_highlands',
    name: 'Iceland Highlands (Vatnajokull North), Iceland',
    country: 'Iceland',
    isoCode: 'IS',
    lat: 64.82,
    lon: -16.58,
    radiusKm: 10,
    fieldNote: 'Subglacial hyaloclastite ridges, basaltic sandur & fluvial outwash plains.',
  },
  {
    id: 'lanzarote',
    name: 'Lanzarote (Timanfaya), Spain',
    country: 'Spain',
    isoCode: 'ES',
    lat: 29.0,
    lon: -13.75,
    radiusKm: 9,
    fieldNote: 'ESA PANGAEA basaltic lava tubes, pyroclastic cones & lunar-like regolith.',
  },
  {
    id: 'mojave_amboy',
    name: 'Mojave / Amboy Crater, USA',
    country: 'USA',
    isoCode: 'US',
    lat: 34.54,
    lon: -115.79,
    radiusKm: 10,
    fieldNote: 'Basalt cinder cone, pahoehoe apron & dry playa aeolian dust basin.',
  },
  {
    id: 'dry_valleys',
    name: 'McMurdo Dry Valleys (Beacon Valley), Antarctica',
    country: 'Antarctica',
    isoCode: 'AQ',
    lat: -77.83,
    lon: 160.65,
    radiusKm: 10,
    fieldNote: 'Hyper-arid polar desert with buried glacier ice and sublimation polygons.',
  },
  {
    id: 'kilauea',
    name: 'Kilauea (Kau Desert), Hawaii',
    country: 'USA',
    isoCode: 'US',
    lat: 19.34,
    lon: -155.34,
    radiusKm: 10,
    fieldNote: 'Acid-altered basalt tephra dunes & fresh volcanic rift fractures.',
  },
  {
    id: 'wadi_rum',
    name: 'Wadi Rum, Jordan',
    country: 'Jordan',
    isoCode: 'JO',
    lat: 29.57,
    lon: 35.42,
    radiusKm: 10,
    fieldNote: 'Arid iron-stained sandstone buttes, red dunes & pediment valley floors.',
  },
  {
    id: 'hanksville',
    name: 'Utah Hanksville (MDRS), USA',
    country: 'USA',
    isoCode: 'US',
    lat: 38.41,
    lon: -110.79,
    radiusKm: 10,
    fieldNote: 'Morrison Formation inverted paleochannels, phyllosilicate mudstones & mesas.',
  },
  {
    id: 'namib',
    name: 'Namib Sand Sea (Gobabeb), Namibia',
    country: 'Namibia',
    isoCode: 'NA',
    lat: -23.56,
    lon: 15.04,
    radiusKm: 10,
    fieldNote: 'Linear & barchan aeolian dunes adjacent to gravel desert plains.',
  },
  {
    id: 'craters_of_the_moon',
    name: 'Craters of the Moon, Idaho',
    country: 'USA',
    isoCode: 'US',
    lat: 43.42,
    lon: -113.56,
    radiusKm: 10,
    fieldNote: 'Rift-zone basaltic aa/pahoehoe flows used for Apollo & NASA FINESSE.',
  },
  {
    id: 'meteor_crater',
    name: 'Barringer Meteor Crater, Arizona',
    country: 'USA',
    isoCode: 'US',
    lat: 35.03,
    lon: -111.02,
    radiusKm: 8,
    fieldNote: 'Well-preserved simple impact crater with overturned ejecta blanket.',
  },
  {
    id: 'kilbourne_hole',
    name: 'Kilbourne Hole, New Mexico',
    country: 'USA',
    isoCode: 'US',
    lat: 31.97,
    lon: -106.97,
    radiusKm: 9,
    fieldNote: 'Volcanic maar crater used in Artemis lunar EVA geology training.',
  },
  {
    id: 'pavilion_lake',
    name: 'Pavilion Lake, British Columbia',
    country: 'Canada',
    isoCode: 'CA',
    lat: 50.87,
    lon: -121.74,
    radiusKm: 9,
    fieldNote: 'Lacustrine microbialite carbonate structures analogous to ancient lakes.',
  },
  {
    id: 'axel_heiberg',
    name: 'Axel Heiberg Island, Canada',
    country: 'Canada',
    isoCode: 'CA',
    lat: 79.42,
    lon: -90.75,
    radiusKm: 10,
    fieldNote: 'Cold hypersaline permafrost springs & evaporite diapirs.',
  },
  {
    id: 'painted_desert',
    name: 'Painted Desert (Chinle), Arizona',
    country: 'USA',
    isoCode: 'US',
    lat: 35.08,
    lon: -109.78,
    radiusKm: 10,
    fieldNote: 'Smectite clay badlands & iron-oxide layered sedimentary scarps.',
  },
  {
    id: 'salar_uyuni',
    name: 'Salar de Uyuni Margin, Bolivia',
    country: 'Bolivia',
    isoCode: 'BO',
    lat: -20.13,
    lon: -67.49,
    radiusKm: 10,
    fieldNote: 'High-altitude polygonal halite-sulfate crust & volcanic lake terraces.',
  },
  {
    id: 'chajnantor',
    name: 'Chajnantor Plateau, Chile',
    country: 'Chile',
    isoCode: 'CL',
    lat: -23.02,
    lon: -67.75,
    radiusKm: 10,
    fieldNote: '5000 m high-UV ignimbrite & andesitic volcanic plateau.',
  },
  {
    id: 'krafla',
    name: 'Krafla Caldera, Iceland',
    country: 'Iceland',
    isoCode: 'IS',
    lat: 65.72,
    lon: -16.78,
    radiusKm: 10,
    fieldNote: 'Fissure-fed basaltic lava flows, explosion craters & hydrothermal mudpots.',
  },
  {
    id: 'teide',
    name: 'Las Canadas Caldera (Teide), Tenerife',
    country: 'Spain',
    isoCode: 'ES',
    lat: 28.25,
    lon: -16.62,
    radiusKm: 10,
    fieldNote: 'High-elevation volcanic caldera with ESA ExoMars rover testbeds.',
  },
  {
    id: 'tabernas',
    name: 'Tabernas Badlands, Spain',
    country: 'Spain',
    isoCode: 'ES',
    lat: 37.01,
    lon: -2.45,
    radiusKm: 9,
    fieldNote: 'Arid dendritic gully networks & gypsum-rich marl escarpments.',
  },
  {
    id: 'qaidam_basin',
    name: 'Qaidam Basin (Mangnai), China',
    country: 'China',
    isoCode: 'CN',
    lat: 38.25,
    lon: 90.85,
    radiusKm: 11,
    fieldNote: 'Cold hyper-arid yardangs, magnesium sulfate playas & wind-eroded ridges.',
  },
  {
    id: 'pilbara',
    name: 'Pilbara (Marble Bar), Australia',
    country: 'Australia',
    isoCode: 'AU',
    lat: -21.17,
    lon: 119.75,
    radiusKm: 10,
    fieldNote: '3.5 Ga Archean basalt-chert units with early Earth stromatolite habitats.',
  },
  {
    id: 'lake_tyrrell',
    name: 'Lake Tyrrell, Victoria, Australia',
    country: 'Australia',
    isoCode: 'AU',
    lat: -35.33,
    lon: 142.84,
    radiusKm: 10,
    fieldNote: 'Acidic hypersaline gypsum-iron-oxide playa lake system.',
  },
  {
    id: 'flinders_ranges',
    name: 'Flinders Ranges (Arkaroola), Australia',
    country: 'Australia',
    isoCode: 'AU',
    lat: -30.31,
    lon: 139.34,
    radiusKm: 10,
    fieldNote: 'Arid ridge-and-valley terrain & carbonate-silicate strata.',
  },
  {
    id: 'negev_ramon',
    name: 'Makhtesh Ramon, Israel',
    country: 'Israel',
    isoCode: 'IL',
    lat: 30.59,
    lon: 34.81,
    radiusKm: 10,
    fieldNote: 'Erosional cirque with basaltic intrusions & AMADEE Mars field trials.',
  },
  {
    id: 'aorounga',
    name: 'Aorounga Impact Structure, Chad',
    country: 'Chad',
    isoCode: 'TD',
    lat: 19.1,
    lon: 19.24,
    radiusKm: 11,
    fieldNote: 'Wind-scoured concentric impact crater ring & Sahara yardangs.',
  },
  {
    id: 'erta_ale',
    name: 'Erta Ale Basalt Shield, Ethiopia',
    country: 'Ethiopia',
    isoCode: 'ET',
    lat: 13.6,
    lon: 40.67,
    radiusKm: 10,
    fieldNote: 'Low-viscosity basaltic shield lava & rift graben escarpments.',
  },
  {
    id: 'tolbachik',
    name: 'Tolbachik Volcanic Field, Kamchatka',
    country: 'Russia',
    isoCode: 'RU',
    lat: 55.76,
    lon: 160.31,
    radiusKm: 10,
    fieldNote: 'Scoria cones & basaltic ash plains used for Soviet Lunokhod rover tests.',
  },
  {
    id: 'sudbury',
    name: 'Sudbury Basin North Rim, Canada',
    country: 'Canada',
    isoCode: 'CA',
    lat: 46.65,
    lon: -81.15,
    radiusKm: 11,
    fieldNote: 'Paleoproterozoic impact melt sheet & shatter-cone breccia units.',
  },
  {
    id: 'ries_crater',
    name: 'Nördlinger Ries Crater, Germany',
    country: 'Germany',
    isoCode: 'DE',
    lat: 48.88,
    lon: 10.56,
    radiusKm: 11,
    fieldNote: 'Suevite impact breccia crater used for Apollo 14/17 astronaut training.',
  },
  {
    id: 'lonar_crater',
    name: 'Lonar Crater, Maharashtra, India',
    country: 'India',
    isoCode: 'IN',
    lat: 19.98,
    lon: 76.51,
    radiusKm: 8,
    fieldNote: 'Hypervelocity impact crater excavated directly into Deccan flood basalts.',
  },
  {
    id: 'bardenas_reales',
    name: 'Bardenas Reales, Spain',
    country: 'Spain',
    isoCode: 'ES',
    lat: 42.19,
    lon: -1.49,
    radiusKm: 9,
    fieldNote: 'Semi-arid claystone mesas, gullies & gypsum badlands.',
  },
  {
    id: 'tenere_desert',
    name: 'Ténéré Desert, Niger',
    country: 'Niger',
    isoCode: 'NE',
    lat: 18.85,
    lon: 11.4,
    radiusKm: 11,
    fieldNote: 'Hyper-arid erg dunes & wind-planed bedrock reg.',
  },
  {
    id: 'white_sands',
    name: 'White Sands Alkali Flat, New Mexico',
    country: 'USA',
    isoCode: 'US',
    lat: 32.84,
    lon: -106.32,
    radiusKm: 10,
    fieldNote: 'Aeolian gypsum dune field analogous to Olympia Undae north polar dunes.',
  },
  {
    id: 'san_francisco_vf',
    name: 'San Francisco Volcanic Field, Arizona',
    country: 'USA',
    isoCode: 'US',
    lat: 35.58,
    lon: -111.55,
    radiusKm: 10,
    fieldNote: 'SP Mountain cinder cone & basalt flow used in NASA Desert RATS tests.',
  },
  {
    id: 'spitsbergen_adventdalen',
    name: 'Adventdalen Pingos, Svalbard',
    country: 'Norway',
    isoCode: 'NO',
    lat: 78.18,
    lon: 15.92,
    radiusKm: 9,
    fieldNote: 'Permafrost frost mounds, patterned ground & cold valley alluvium.',
  },
  {
    id: 'san_rafael_swell',
    name: 'San Rafael Swell, Utah',
    country: 'USA',
    isoCode: 'US',
    lat: 38.86,
    lon: -110.65,
    radiusKm: 10,
    fieldNote: 'Gypsum-bearing Jurassic canyons, hematite concretions & mesa scarps.',
  },
  {
    id: 'dhofar_oman',
    name: 'Dhofar Desert (Al-Hashman), Oman',
    country: 'Oman',
    isoCode: 'OM',
    lat: 18.2,
    lon: 53.75,
    radiusKm: 10,
    fieldNote: 'AMADEE-18 limestone-desert plateau & high-temperature autonomous ops zone.',
  },
  {
    id: 'kerguelen',
    name: 'Kerguelen Basalt Plateau',
    country: 'French Southern Territories',
    isoCode: 'TF',
    lat: -49.25,
    lon: 69.18,
    radiusKm: 10,
    fieldNote: 'Sub-Antarctic flood basalt plateau, glacial cirques & cold winds.',
  },
  {
    id: 'mono_basin',
    name: 'Mono Basin & Panum Crater, California',
    country: 'USA',
    isoCode: 'US',
    lat: 37.93,
    lon: -119.04,
    radiusKm: 10,
    fieldNote: 'Alkaline paleolake tufa shorelines & pumice tephra ring.',
  },
];
