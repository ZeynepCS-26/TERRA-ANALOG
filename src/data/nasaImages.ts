export interface NasaImageRecord {
  id: string;
  name: string;
  url: string;
  sourceLabel: string;
}

export const NASA_FALLBACK_IMAGES: Record<string, NasaImageRecord> = {
  jezero: {
    id: 'jezero',
    name: 'Jezero Crater, Mars',
    url: 'https://images-assets.nasa.gov/image/PIA24538/PIA24538~orig.jpg',
    sourceLabel: 'Image: NASA/JPL-Caltech/MSSS/University of Arizona',
  },
  valles_marineris: {
    id: 'valles_marineris',
    name: 'Valles Marineris, Mars',
    url: 'https://images-assets.nasa.gov/image/PIA00422/PIA00422~orig.jpg',
    sourceLabel: 'Image: NASA/JPL-Caltech/USGS',
  },
  shackleton: {
    id: 'shackleton',
    name: 'Shackleton Crater, Moon',
    url: 'https://images-assets.nasa.gov/image/PIA22226/PIA22226~orig.jpg',
    sourceLabel: 'Image: NASA/GSFC/LROC',
  },
  taurus_littrow: {
    id: 'taurus_littrow',
    name: 'Taurus-Littrow, Moon',
    url: 'https://images-assets.nasa.gov/image/as17-147-22469/as17-147-22469~orig.jpg',
    sourceLabel: 'Image: NASA/JSC Apollo 17 Archive',
  },
  tycho: {
    id: 'tycho',
    name: 'Tycho Crater, Moon',
    url: 'https://images-assets.nasa.gov/image/PIA00133/PIA00133~orig.jpg',
    sourceLabel: 'Image: NASA/Lunar Orbiter 4',
  },
};
