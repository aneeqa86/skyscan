# Data sources

SKYSCAN reads raw LiDAR point clouds and compares its results against open building footprints.
Each source below was checked on 2026-11-15. "Live" means the endpoint answered at that date.
Licenses change: check the provider's page before redistributing anything.

## Primary: USGS 3D Elevation Program (live, adapter built)

| | |
|---|---|
| What | Airborne LiDAR for most of the United States, one project per collection |
| Access | Entwine Point Tiles (EPT) in the AWS Open Data bucket `usgs-lidar-public`, one `ept.json` per project, e.g. `https://s3-us-west-2.amazonaws.com/usgs-lidar-public/NY_NewYorkCity/ept.json` |
| Index | `boundaries/resources.geojson` in the [hobuinc/usgs-lidar](https://github.com/hobuinc/usgs-lidar) repository: name, point count, EPT URL and boundary for each project |
| CRS | EPT is stored in Web Mercator (EPSG:3857); SKYSCAN reprojects each AOI to its local UTM zone |
| License | Public domain (U.S. Government work) |
| Attribution | "USGS 3D Elevation Program (3DEP)" |
| Adapter | `apps/lidar/sources/usgs.py` (`UsgsEptSource`, reads with PDAL `readers.ept`, cropped to the AOI, streaming) |
| Loader | `python manage.py load_3dep_index` creates or refreshes one `Dataset` row per project |

Notes from checking the index (2026-11-15):

- 2,284 projects. The index is about 8.8 MB of GeoJSON in EPSG:4326.
- The acquisition year is parsed from the project name. 2,049 names carry a four-digit year
  (`CA_LosAngeles_2016`) and 231 carry a work-unit suffix (`NY_Hudson_1_D22` means 2022).
  767 names end in the year the LAS files were delivered, not flown
  (`USGS_LPC_IL_4County_Cook_2017_LAS_2019` was flown in 2017), so that suffix is ignored.
- Six projects have no usable year and are left out of Change mode: the statewide mosaics
  `IA_FullState`, `KY_FullState` and `MN_FullState`, and three Illinois projects whose names
  carry only a delivery year.
- `NY_NewYorkCity` has no year in its name. Points sampled in Midtown have a median GPS time
  of 2014-03-27 (the post-Hurricane Sandy collection), so it is recorded as 2014. Its average
  density is about 4 points/m² and it has no building class. It is the only 3DEP project
  covering Manhattan.
- Some projects store every point as return 1 of 1 (for example the Cook County 2017
  project), and some label only part of their roofs as buildings (class 6). The pipeline
  checks both and adapts (see [METHOD.md](METHOD.md)).
- Point density in the `Dataset` table is the project's point count divided by its geodesic
  boundary area. It is an average: real density varies within a project (overlap areas, water).
- Most projects have no reliable building class (class 6), which is why the nDSM building
  detector is the core of the measure pipeline (see [METHOD.md](METHOD.md)).
- Overlapping projects from different years are what make Change mode possible in the US.

## Second adapter: Netherlands AHN (live, adapter built)

| | |
|---|---|
| What | National height model with repeat surveys: AHN2 (2007-2012), AHN3 (2014-2019), AHN4 (2020-2022), AHN5 (2023-2025, still being rolled out) |
| Access | LAZ point clouds from the [GeoTiles](https://geotiles.citg.tudelft.nl/) mirror (TU Delft), cut into 1 x 1.25 km sub-tiles in RD New (EPSG:28992) with 25 m overlap, e.g. `https://geotiles.citg.tudelft.nl/AHN4_T/25BZ1_01.LAZ` |
| Index | The GeoTiles sub-unit sheet index from [fwrite.org/kaartbladen](https://fwrite.org/kaartbladen/) (`AHN_subunits_GeoTiles.zip`, 76,200 sub-tiles, AHN1-AHN4 availability flags) |
| License | CC0 (public domain). Attribution: "Actueel Hoogtebestand Nederland (AHN)" |
| Adapter | `apps/lidar/sources/ahn.py` (`AhnTileSource`): downloads the sub-tiles an area needs into `SKYSCAN_CACHE_DIR/ahn/` (atomic, locked, reused by later jobs) and crops each to its own core cell so overlap points are not read twice |
| Loader | `python manage.py load_ahn_index` builds the tile index and one `Dataset` row per edition |

Notes from checking (2026-11-15):

- **PDOK changed.** The PDOK Atom service now lives at
  `service.pdok.nl/rws/actueel-hoogtebestand-nederland/atom/index.xml` and offers only the
  0.5 m DSM and DTM rasters, not point clouds. The point clouds come from GeoTiles instead.
- **Tiles are large.** One sub-tile of Amsterdam (25BZ1_01) is 53 MB (AHN2), 167 MB (AHN3),
  517 MB (AHN4) and 295 MB (AHN5). Plain LAZ cannot be range-read over HTTP, so whole tiles are
  downloaded once (about 4 MB/s from the test machine) and cached.
- **Densities** measured on that tile: AHN2 11, AHN3 19, AHN4 42, AHN5 29 points/m². Surveys over
  20 points/m² are thinned to about 15 points/m² when read.
- **AHN5 is partial.** The sub-tile index (January 2023) predates AHN5, so the loader probes one
  sub-tile per map sheet: AHN5 was available on 814 of 1,356 sheets with AHN4 data.
- **Years.** `acquisition_year` is a nominal mid-point of each national campaign (AHN2 2010,
  AHN3 2017, AHN4 2021, AHN5 2024). The actual flight year varies by region within the window,
  so two consecutive editions can be less than 3 years apart in places.
- **Classes.** AHN classifies ground well, but in AHN4 only about 0.4% of points are class 6
  (building) on the test tile, so the nDSM method does the building detection here too.

## Reference footprints (used for validation)

| Source | Status | Access | License |
|---|---|---|---|
| [Overture Maps](https://overturemaps.org/) buildings theme | Live. Latest release `2026-10-21.0`. In the Netherlands its footprints largely come from OSM, which imports the national BAG register | GeoParquet in `s3://overturemaps-us-west-2/release/<release>/theme=buildings/` | ODbL (contains OpenStreetMap data) |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Live | Overpass API (fallback when Overture has no buildings in the AOI) | ODbL. "© OpenStreetMap contributors" |
| [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | Live | Quadkey-partitioned GeoJSON | ODbL. Listed for reference; already folded into Overture |

Overture is tried first because it merges OSM, Microsoft and Esri footprints and carries OSM
heights where they exist. When a reference has heights, SKYSCAN also reports height error.

## Aerial imagery (corroboration, vegetation check, map layer)

| Source | Status | Access | License |
|---|---|---|---|
| [USDA NAIP](https://www.fsa.usda.gov/programs-and-services/aerial-photography/imagery-programs/naip-imagery/) (United States) | Live. Each state is flown every 2-3 years; 1 m pixels until about 2017, then 0.6 m and recently 0.3 m. Usually 4 bands (red, green, blue, near-infrared) | [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/naip): free STAC search API (`/api/stac/v1/search`, collection `naip`) and cloud-optimised GeoTIFFs signed with a free anonymous token (`/api/sas/v1/token/naip`). No account or key. Only the area's pixels are read | Public domain |
| [PDOK luchtfoto](https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open-) (Netherlands) | Live. Yearly national orthophotos from 2016: RGB (`luchtfotorgb`, 25 cm and 8 cm) and colour-infrared (`luchtfotocir`) | WMS 1.3.0 in EPSG:3857, up to 2500 px per request. No key | CC BY 4.0, Beeldmateriaal Nederland |

Checked on 2026-11-21: Denver Union Station has NAIP for 2011, 2013, 2015, 2017,
2019, 2021 and 2023, all 4-band. PDOK lists RGB layers for 2016-2026 and CIR for
2016-2025 except 2021.

AWS also hosts NAIP (`naip-analytic`, `naip-visualization`), but those buckets are
"requester pays", so downloads would be billed; SKYSCAN does not use them.

## Listed for reference (no adapter)

### United States

| Source | Status | Notes |
|---|---|---|
| [NOAA Digital Coast](https://coast.noaa.gov/digitalcoast/) | Live | Coastal and topobathy LiDAR; mostly public domain |
| City and state portals | n/a | Many cities publish their own surveys (often newer or denser than 3DEP) |

### Europe

| Country | Source | Status | License |
|---|---|---|---|
| England | [Environment Agency, via Defra Data Services](https://environment.data.gov.uk/survey) | Live | Open Government Licence v3.0 |
| Scotland | [Scottish Remote Sensing Portal](https://remotesensingdata.gov.scot/) | Live | Open Government Licence v3.0 |
| Switzerland | [swisstopo swissSURFACE3D](https://www.swisstopo.admin.ch/en/height-model-swisssurface3d) | Live | Free geodata (OGD), attribution "© swisstopo" |
| France | [IGN LiDAR HD](https://geoservices.ign.fr/lidarhd) | Live | Licence Ouverte / Etalab 2.0 |
| Denmark | [Dataforsyningen](https://dataforsyningen.dk/) | Live | Free data, terms on the portal |
| Finland | [National Land Survey (NLS)](https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces/product-descriptions/laser-scanning-data) | Live | CC BY 4.0 |
| Estonia | [Maa-amet geoportal](https://geoportaal.maaamet.ee/) | Live | Maa-amet open data licence |
| Poland | GUGiK: [gov.pl/web/gugik](https://www.gov.pl/web/gugik) and geoportal.gov.pl | Live (gov.pl). geoportal.gov.pl did not resolve from the test machine's DNS but resolves through public DNS | Free of charge under Polish geodetic law |
| Spain | [PNOA-LiDAR](https://pnoa.ign.es/pnoa-lidar) | Live | CC BY 4.0 (scne.es) |
| Germany, NRW | [OpenGeodata.NRW 3D point clouds](https://www.opengeodata.nrw.de/produkte/geobasis/hm/3dm_l_las/) | Live | Datenlizenz Deutschland Zero 2.0 |
| Germany, Berlin | [GDI Berlin](https://gdi.berlin.de/) | Live | Datenlizenz Deutschland (check per dataset) |
| Germany, Hamburg | Hamburg Transparency Portal | n/a | Datenlizenz Deutschland Namensnennung 2.0 |

### Discovery services

| Source | Status | Notes |
|---|---|---|
| [OpenTopography](https://opentopography.org/) | Live | Hosts and indexes many surveys. API access needs a free key, and the license is set per dataset: check before using |
| [Equator Studios](https://equatorstudios.com/) | Live | Viewer and catalogue of open LiDAR |
| [Flai Open LiDAR Hub](https://www.flai.ai/products/open-lidar-hub) | Live (moved: the old `/open-lidar-data-hub` path now returns 404; the hub itself is at hub.flai.ai) | Catalogue of open LiDAR datasets |

## Attribution shown in the app

The map footer and the About page credit every source a result was built from: USGS 3DEP for
point clouds, Overture Maps and "© OpenStreetMap contributors" for reference footprints, USDA
NAIP or Beeldmateriaal Nederland (PDOK) for aerial imagery, and Mapbox for the basemap. Exports
name the imagery source when a job used it.
