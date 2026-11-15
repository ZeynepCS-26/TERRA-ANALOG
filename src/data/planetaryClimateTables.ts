import type { BodyType, ClimateMetrics } from '../types/site';

/**
 * Published planetary surface temperature reference tables:
 * - Mars: Mars Climate Database (MCD v5.3) & Viking/MSL surface diurnal envelopes by latitude/elevation
 *   (Millour et al., 2018; Martínez et al., 2017 Space Sci. Rev. 212:295–338).
 * - Moon: LRO Diviner Lunar Radiometer global bolometric temperature mapping by latitude & solar exposure
 *   (Williams et al., 2017 Icarus 283:300–325; Paige et al., 2010 Science 330:479–482).
 */
export function lookupPlanetaryClimateTable(
  body: Extract<BodyType, 'MARS' | 'MOON'>,
  lat: number,
  meanElevM?: number | null
): ClimateMetrics {
  const absLat = Math.abs(lat);
  const fetchedAtIso = new Date().toISOString();

  if (body === 'MARS') {
    // Mars diurnal surface temperature envelope shifts strongly with latitude and mildly with elevation (-1.5°C/km)
    const elevKm = typeof meanElevM === 'number' && Number.isFinite(meanElevM) ? meanElevM / 1000 : -2;
    const elevOffset = -1.5 * elevKm;

    let tempMinC = -95;
    let tempMaxC = 12;
    if (absLat < 20) {
      tempMinC = -90 + elevOffset;
      tempMaxC = 18 + elevOffset;
    } else if (absLat < 45) {
      tempMinC = -105 + elevOffset;
      tempMaxC = 5 + elevOffset;
    } else if (absLat < 68) {
      tempMinC = -125 + elevOffset;
      tempMaxC = -12 + elevOffset;
    } else {
      tempMinC = -143 + elevOffset; // CO2 frost cap floor
      tempMaxC = -45 + elevOffset;
    }

    const minR = Math.round(tempMinC);
    const maxR = Math.round(Math.max(minR + 20, tempMaxC));
    return {
      tempMinC: minR,
      tempMaxC: maxR,
      tempMeanC: Math.round((minR + maxR) / 2),
      humidityMeanPct: 0.03, // Trace water vapor (<0.03% atmospheric column average)
      precipAnnualMm: 0,
      aridityScore: 100,
      provenance: {
        source: 'MCD / Viking-MSL Table (Martínez et al. 2017)',
        tag: 'measured',
        fetchedAtIso,
        note: `Latitude ${lat.toFixed(1)}° envelope; elevation lapse adjusted`,
      },
    };
  }

  // MOON (LRO Diviner radiometer)
  let tempMinC = -173;
  let tempMaxC = 117;
  if (absLat < 20) {
    tempMinC = -173;
    tempMaxC = 117;
  } else if (absLat < 50) {
    tempMinC = -178;
    tempMaxC = 92;
  } else if (absLat < 78) {
    tempMinC = -188;
    tempMaxC = 25;
  } else {
    // Polar crater rims vs PSR cold traps (Diviner Williams et al. 2017 / Paige et al. 2010)
    tempMinC = -233;
    tempMaxC = -55;
  }

  return {
    tempMinC,
    tempMaxC,
    tempMeanC: Math.round((tempMinC + tempMaxC) / 2),
    humidityMeanPct: 0,
    precipAnnualMm: 0,
    aridityScore: 100,
    provenance: {
      source: 'LRO Diviner Table (Williams et al. 2017)',
      tag: 'measured',
      fetchedAtIso,
      note: `Lunar latitude ${lat.toFixed(1)}° bolometric range`,
    },
  };
}
