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

## Second adapter: Netherlands AHN (live, planned)

| | |
|---|---|
| What | National height model with repeat surveys: AHN2 (2007-2012), AHN3 (2014-2019), AHN4 (2020-2022), AHN5 (2023-2025) |
| Access | Tile downloads through PDOK. Atom index: `https://service.pdok.nl/rws/ahn/atom/index.xml` |
| License | CC0 (public domain) |
| Attribution | "Actueel Hoogtebestand Nederland (AHN)" |
| Status | Built only after everything else works (phase 12). Uses tile downloads with a local cache. |

## Reference footprints (used for validation)

| Source | Status | Access | License |
|---|---|---|---|
| [Overture Maps](https://overturemaps.org/) buildings theme | Live. Latest release `2026-10-21.0` | GeoParquet in `s3://overturemaps-us-west-2/release/<release>/theme=buildings/` | ODbL (contains OpenStreetMap data) |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Live | Overpass API (fallback when Overture has no buildings in the AOI) | ODbL. "© OpenStreetMap contributors" |
| [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints) | Live | Quadkey-partitioned GeoJSON | ODbL. Listed for reference; already folded into Overture |

Overture is tried first because it merges OSM, Microsoft and Esri footprints and carries OSM
heights where they exist. When a reference has heights, SKYSCAN also reports height error.

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
point clouds, Overture Maps and "© OpenStreetMap contributors" for reference footprints, and
Mapbox for the basemap.
