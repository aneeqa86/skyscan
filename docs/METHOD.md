# How SKYSCAN works

This page explains, in plain language, how SKYSCAN turns raw LiDAR into building
footprints with heights, how it checks itself, and where it is weak. The code
lives in `backend/apps/lidar/pipeline/` (processing) and `backend/apps/detection/`
(jobs, validation).

## 1. Measure: from points to buildings

**Area and survey.** You draw an area of up to 1 km² (0.5 km² for Change).
SKYSCAN picks the newest LiDAR survey that covers it, preferring surveys that
cover the whole area. It works in the local UTM zone so every distance and area
is in metres.

**Fetching points.** Points are streamed from USGS 3DEP Entwine Point Tiles with
PDAL, cropped to the area plus a 15 m margin (so buildings on the edge are
measured whole). Nothing is downloaded in full. Surveys denser than
20 points/m² are read at a coarser octree level (about 15 points/m²), which is
still several points per raster cell.

**Cleaning.** Points the survey marks as noise (classes 7 and 18) are dropped,
then a statistical outlier filter removes isolated points such as birds and
multipath returns.

**Ground.** If the survey classified ground (class 2), that is used. Otherwise
PDAL's SMRF filter finds it. Ground points become a terrain model (DTM) on a
2 m grid, with gaps under buildings filled by linear interpolation, resampled to
the working grid.

**Surfaces.** The highest point in each cell gives the surface model (DSM).
Small gaps take the nearest value; large gaps (water) fall back to the terrain.
Height above ground (nDSM) is DSM minus DTM. The cell size is 0.5 m, or 1 m for
surveys averaging under 6 points/m², so each cell still holds a few points.

**Buildings versus trees.** Most 3DEP surveys have no building class, so
SKYSCAN finds buildings itself. Every cell at least 2.5 m above ground is a
candidate. Three cues tell roofs from trees:

| Cue | Roof | Tree |
|---|---|---|
| Multi-return share: part of each laser pulse passing through | almost always a single return | many pulses return several times |
| Height spread of points inside the cell | points lie on one surface | points spread through the crown |
| Roughness: deviation from a local plane | flat or evenly pitched | bumpy |

Each cue is scaled to 0..1 and combined into a vegetation score. Some EPT
projects store every point as "return 1 of 1"; SKYSCAN detects that and scores
with the two geometric cues alone. Cells scoring under 0.42 are kept, small
specks are removed, holes are filled, and whole regions that are on average
tree-like are dropped.

Roof edges look tree-like (eaves and wall points raise the spread), so each
building then regrows up to 2 cells into neighbouring tall cells that are not
strongly tree-like. Each building grows on its own and a one-cell gap is kept
where two meet, so neighbouring houses are not merged.

If a survey labels at least 60% of its tall cells as buildings (class 6), that
classification is used instead.

**Separating touching buildings.** In dense cities, buildings share walls and
form one connected block. SKYSCAN finds roof-height jumps of more than 4 m,
seeds one region per roof, and grows the seeds back over the block with a
watershed. Pieces are then merged back when the height step along their shared
edge is small (a roof cut apart by water tanks or plant rooms), when one piece
is mostly surrounded by another (a tower on its podium), or when a piece is
smaller than the minimum building size. Buildings of the same height that share
a wall stay joined: nothing in the LiDAR separates them.

**Footprints and attributes.** Each region is traced into a polygon, regions
under 25 m² are dropped, outlines are simplified (0.3 m) and near-right angles
are squared to the building's main axis. For each building:

- **Height** is the 90th percentile of the height above ground in its cells,
  which ignores antennas and chimneys. The maximum is reported separately.
- **Floors** are estimated as height / 3 m, at least 1.
- **Volume** is the sum of cell heights times cell area.
- **Confidence** (0..1) rises with point density, a clean (non-tree) signal,
  size and a compact outline, and drops by 40% when a building touches the edge
  of the processed area.

A sample of up to 300,000 points is also stored for the 3D point cloud view.

## 2. Validation: checking against other maps

After every Measure job SKYSCAN downloads independent footprints for the same
area, from Overture Maps (which merges OpenStreetMap, Microsoft and Esri
footprints) or, if that fails, from OpenStreetMap. It then compares:

- A detected building **matches** a reference building when their overlap is at
  least half of their combined area (IoU ≥ 0.5). Each building matches at most
  one other.
- **Precision**: the share of detected buildings that match a reference building.
- **Recall**: the share of reference buildings that were found.
- **F1**: the balance of the two. **Mean IoU**: how well matched outlines overlap.
- **Height error**: where the reference has a height, the mean absolute
  difference from SKYSCAN's height, and how many buildings were compared.

Only buildings whose centre lies inside the drawn area are counted on both
sides. If no reference is available the app says so and shows no numbers.

### Tuning results

The parameters above were tuned on three contrasting urban areas of about
0.2 km² each, using `python manage.py tune_measure`, against Overture release
2026-10-21.0. These are the numbers with the shipped defaults, as computed by the
validation code on 2026-11-15:

| Area | Survey | Points/m² | Detected / reference | Precision | Recall | F1 | Mean IoU | Height MAE (n) |
|---|---|---|---|---|---|---|---|---|
| Seattle, Capitol Hill: detached houses, mature trees | WA_KingCo_1_2021 | 12 | 326 / 327 | 0.75 | 0.75 | **0.75** | 0.78 | 2.2 m (243) |
| Chicago, Lincoln Park: row houses, alley garages, park | Cook County 2017 | 27 (read at ~15) | 236 / 325 | 0.50 | 0.37 | **0.42** | 0.70 | 1.5 m (119) |
| New York, Midtown: towers, setbacks, shared walls | NY_NewYorkCity (2014) | 4 | 293 / 127 | 0.16 | 0.36 | **0.22** | 0.67 | 9.8 m (46) |

What changed the numbers during tuning:

F1 before and after each change (same area, other settings fixed):

- Splitting blocks at height jumps and merging the pieces back: Midtown 0.08 to
  0.26, Seattle 0.61 to 0.72, Chicago 0.12 to 0.22 (then still on its class 6).
- Fixing the noise filter, scoring without the multi-return cue when a survey
  has no return information, and using the nDSM method instead of Chicago's
  partial class 6: Chicago 0.22 to 0.33.
- Turning off morphological closing, which joined houses across 1-2 m gaps:
  Seattle 0.75 to 0.76.
- Regrowing each building's edges separately: Chicago 0.33 to 0.42, Midtown
  0.18 to 0.20; Seattle outlines fit better (IoU 0.72 to 0.78) for an F1 cost of
  0.01.

### Why the scores differ so much

- **Shared walls (Midtown, Chicago).** Reference maps split city blocks into one
  building per lot. Where neighbours share a wall and a roof height, the LiDAR
  shows one roof, so SKYSCAN reports one building and the match fails. In
  Midtown the opposite also happens: towers with several setbacks become several
  pieces. Footprint scores in dense cores mostly measure this disagreement about
  what "a building" is.
- **Survey age.** Midtown's only survey is from 2014; the reference describes the
  city today. Buildings built or demolished since then count as errors, and they
  inflate the height error.
- **Small structures under trees (Chicago).** Alley garages of 20-40 m² are
  often partly hidden by tree crowns and fall below the minimum size.
- **Sparse points.** At 4 points/m² edges are blurred by a 1 m cell.

The fairest single measure of height quality is the residential cases, where
matching is unambiguous: SKYSCAN's heights are within about 1.5-2.2 m of the
reference on average.

## 3. Limits

- Heights are relative to the ground model. On steep slopes the downhill side
  of a building looks taller.
- Glass roofs and water on roofs can return few points and be under-detected.
- Dense evergreen trees next to a flat roof can be merged into it.
- Floor counts assume 3 m per floor; offices, warehouses and churches differ.
- Footprints include overhanging eaves, which cadastral outlines do not.
