export type FallbackSurfaceKind =
  | 'mars_jezero'
  | 'mars_valles'
  | 'moon_south_pole'
  | 'mars_globe'
  | 'moon_globe';

export interface LandingSlideAsset {
  id: string;
  nasaId: string;
  title: string;
  body: 'MARS' | 'MOON';
  imageUrl: string;
  fallbackKind: FallbackSurfaceKind;
}

/**
 * NASA Image and Video Library public-domain imagery for the Landing backdrop.
 * Replace or reorder items here to customize the landing slideshow.
 */
export const LANDING_HOLD_DURATION_MS = 5500;

export const LANDING_MEDIA_SLIDES: LandingSlideAsset[] = [
  {
    id: 'lunar-south-pole',
    nasaId: 'PIA13523',
    title: 'Shackleton Region, Lunar South Pole',
    body: 'MOON',
    imageUrl: 'https://images-assets.nasa.gov/image/PIA13523/PIA13523~medium.jpg',
    fallbackKind: 'moon_south_pole',
  },
  {
    id: 'valles-marineris',
    nasaId: 'PIA13077',
    title: 'Valles Marineris, Mars',
    body: 'MARS',
    imageUrl: 'https://images-assets.nasa.gov/image/PIA13077/PIA13077~large.jpg',
    fallbackKind: 'mars_valles',
  },
  {
    id: 'mars-globe',
    nasaId: 'PIA02992',
    title: 'Mars Global Mosaic',
    body: 'MARS',
    imageUrl: 'https://images-assets.nasa.gov/image/PIA02992/PIA02992~large.jpg',
    fallbackKind: 'mars_globe',
  },
  {
    id: 'moon-globe',
    nasaId: 'GSFC_20171208_Archive_e001861',
    title: 'Lunar Global Mosaic',
    body: 'MOON',
    imageUrl:
      'https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e001861/GSFC_20171208_Archive_e001861~large.jpg',
    fallbackKind: 'moon_globe',
  },
];
