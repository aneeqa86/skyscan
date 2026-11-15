/**
 * LiDAR sources shown on the Datasets page.
 *
 * Facts checked on 2026-11-15 (see docs/DATA_SOURCES.md for sources):
 * - USGS 3DEP and AHN: values from SKYSCAN's own index and measured tiles.
 * - swissSURFACE3D: swisstopo, 2017-2023 campaign, mean 15-20 pts/m².
 * - IGN LiDAR HD: IGN programme flown since April 2021, target 10 pts/m² mean,
 *   Licence Ouverte 2.0.
 * - England: Environment Agency National LIDAR Programme Phase 1, 302 blocks
 *   flown Jan 2017 - Feb 2023, at least 1 pt/m² for the 1 m product, OGL v3.
 * - Denmark: national campaign 2014-2015, about 4-5 pts/m² per the EEA
 *   catalogue (secondary source), Klimadatastyrelsen / Dataforsyningen.
 *
 * inExplorer: SKYSCAN has an adapter and can process areas from this source.
 *
 * @typedef {{
 *   id: string, name: string, agency: string, region: 'USA'|'Europe', country: string,
 *   acquisition: string, density: string, license: string, coverage: string,
 *   format: string, inExplorer: boolean, explorer?: string, url: string,
 *   shape: string[]
 * }} LidarDataset
 */

/** @type {LidarDataset[]} */
export const DATASETS = [
  {
    id: 'usgs-3dep',
    name: 'USGS 3DEP',
    agency: 'U.S. Geological Survey · 3D Elevation Program',
    region: 'USA',
    country: 'USA',
    acquisition: '2002–2024',
    density: '≈9 pts/m² avg',
    license: 'Public domain',
    coverage: '2,284 projects',
    format: 'EPT · LAZ',
    inExplorer: true,
    explorer: '/explorer?mode=measure&city=midtown-manhattan',
    url: 'https://www.usgs.gov/3d-elevation-program',
    shape: [
      '14,22 40,18 78,22 100,20 130,24 150,22 172,30 180,44 170,56 176,66 158,76 150,90 138,98 124,82 100,84 80,92 60,86 44,70 26,64 18,46',
      '10,96 30,92 40,104 20,108',
    ],
  },
  {
    id: 'ahn',
    name: 'AHN2–AHN5',
    agency: 'Actueel Hoogtebestand Nederland · Rijkswaterstaat',
    region: 'Europe',
    country: 'NL',
    acquisition: '2007–2025',
    density: '11–42 pts/m²',
    license: 'CC0 1.0',
    coverage: 'National, AHN5 partial',
    format: 'LAZ tiles',
    inExplorer: true,
    explorer: '/explorer?mode=measure&lon=4.8790&lat=52.3378&zoom=15',
    url: 'https://www.ahn.nl/',
    shape: ['88,18 112,14 126,26 130,46 122,62 130,78 116,98 96,96 84,84 74,70 66,54 72,38 80,26'],
  },
  {
    id: 'swisssurface3d',
    name: 'swissSURFACE3D',
    agency: 'swisstopo · Federal Office of Topography',
    region: 'Europe',
    country: 'CH',
    acquisition: '2017–2023',
    density: '15–20 pts/m²',
    license: 'Open Government Data',
    coverage: 'National',
    format: 'LAZ',
    inExplorer: false,
    url: 'https://www.swisstopo.admin.ch/en/height-model-swisssurface3d',
    shape: ['40,56 58,40 84,38 104,30 132,34 158,42 172,58 160,72 134,80 108,86 80,84 56,76'],
  },
  {
    id: 'ign-lidar-hd',
    name: 'IGN LiDAR HD',
    agency: 'IGN · Institut national de l’information géographique',
    region: 'Europe',
    country: 'FR',
    acquisition: '2021–ongoing',
    density: '10 pts/m² avg',
    license: 'Licence Ouverte 2.0',
    coverage: 'National, in progress',
    format: 'LAZ (COPC)',
    inExplorer: false,
    url: 'https://geoservices.ign.fr/lidarhd',
    shape: ['92,10 120,18 142,34 150,58 140,84 116,104 86,108 62,96 50,74 56,48 70,26'],
  },
  {
    id: 'england-nlp',
    name: 'National LIDAR Programme',
    agency: 'Environment Agency · England',
    region: 'Europe',
    country: 'UK',
    acquisition: '2017–2023',
    density: '≥1 pt/m²',
    license: 'Open Government Licence',
    coverage: '≈99% of England',
    format: 'LAZ',
    inExplorer: false,
    url: 'https://environment.data.gov.uk/survey',
    shape: ['94,8 110,16 116,34 128,52 140,70 150,90 128,104 100,108 76,100 64,84 80,66 84,44 86,24'],
  },
  {
    id: 'danish-dhm',
    name: 'Danish Elevation Model',
    agency: 'Klimadatastyrelsen · Dataforsyningen',
    region: 'Europe',
    country: 'DK',
    acquisition: '2014–2015',
    density: '≈4–5 pts/m²',
    license: 'Free data, see portal',
    coverage: 'National',
    format: 'LAZ',
    inExplorer: false,
    url: 'https://dataforsyningen.dk/',
    shape: ['70,20 96,12 108,30 102,54 112,74 96,96 76,92 66,72 74,50 64,34', '122,62 140,56 150,72 136,82 120,78'],
  },
]
