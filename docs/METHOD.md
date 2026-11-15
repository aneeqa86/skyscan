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
| Depth of points below the local top surface | points lie on the roof, flat or pitched | points spread down through the crown |
| Roughness: deviation from a local plane | flat or evenly pitched | bumpy |

Each cue is scaled to 0..1 and combined into a vegetation score. Where a cell
holds fewer than about 3 points (sparse surveys), the point cues are pooled
over a 3x3 or 5x5 neighbourhood so they have points to work with. Some EPT
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
2026-10-21.0, then checked on a fourth (Los Angeles). These are the numbers with the shipped defaults, as computed by the
validation code on 2026-11-15:

| Area | Survey | Points/m² | Detected / reference | Precision | Recall | F1 | Mean IoU | Height MAE (n) |
|---|---|---|---|---|---|---|---|---|
| Seattle, Capitol Hill: detached houses, mature trees | WA_KingCo_1_2021 | 12 | 324 / 327 | 0.75 | 0.74 | **0.74** | 0.78 | 2.2 m (241) |
| Chicago, Lincoln Park: row houses, alley garages, park | Cook County 2017 | 27 (read at ~15) | 233 / 325 | 0.49 | 0.35 | **0.41** | 0.69 | 1.4 m (114) |
| New York, Midtown: towers, setbacks, shared walls | NY_NewYorkCity (2014) | 4 | 294 / 127 | 0.16 | 0.36 | **0.22** | 0.68 | 10.0 m (46) |
| Los Angeles, South Park: towers, dense street trees | LA County 2023 | 19 (read at ~15) | 549 / 80 | 0.07 | 0.48 | **0.12** | 0.76 | 14.0 m (33) |

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

- **Street trees and cluttered roofs (Los Angeles).** Dense evergreen street
  trees look like roofs to every cue, large roofs break into fragments, and
  Overture maps this area as 80 large parcels, so precision is very low.

The fairest single measure of height quality is the residential cases, where
matching is unambiguous: SKYSCAN's heights are within about 1.4-2.2 m of the
reference on average.

## 3. Change: comparing two surveys

**Which surveys.** Change mode needs two surveys that each cover the whole
area and were flown at least 3 years apart. The app lists the years available
wherever you click. By default it compares the newest survey with the most
recent one at least 3 years older; you can pick others.

**Same grid.** Both surveys are measured exactly as in section 1, on one shared
grid (same origin, cell size and UTM zone), so every cell lines up. The cell
size follows the sparser survey.

**Vertical alignment.** Two surveys can sit a few centimetres to decimetres
apart vertically. SKYSCAN finds cells that are bare ground in both surveys and
well away from buildings and trees, takes the median height difference there,
and shifts the later survey by it. The spread of the remaining differences
(robust standard deviation) is reported as the vertical noise; it lowers
confidence when large.

**What counts as change.** The height above ground in the later survey minus
the earlier one gives a difference map. A cell is a change candidate when the
difference is at least 2.5 m (about one floor) and a building stands there in
at least one of the two surveys. Cells where the survey without a building has
a tree are skipped: a crown growing over a roof, or leaf-on against leaf-off, is
not construction. Strips narrower than about 2 m are removed (roof edges that
fall half a cell apart), and regions under 20 m² are dropped. Regions that sit
where the other survey has something tall that is not a building are dropped
too: that is a tree classified differently in the two surveys.

**What kind of change.**

| Type | Rule |
|---|---|
| New | building after, none before, and the building did not exist before |
| Demolished | building before, none after, and nothing of that building remains |
| Raised / lowered | building in both, height changed by at least 2.5 m |
| Extended | new building area attached to a building that already stood (at least 25% of it existed before) |
| Reduced | building area removed from a building that still partly stands |

Each change gets heights before and after (90th percentile), the height
difference, area, volume change (sum of height differences times cell area)
and a confidence. Confidence is higher for larger regions and clear height
changes, and lower when the two surveys differ a lot in point density or the
vertical alignment is noisy. Totals report counts per type, net volume and net
footprint change, the vertical offset applied, and both surveys' years and
densities.

### Results

Two areas were checked by eye against the known history of each place
(2026-11-15):

- **Denver, Union Station** (2013 vs 2020, 4.9 and 4.5 points/m², 0.33 km²).
  The Railyards district north-west of the station shows 40 new buildings
  and 15 raised ones, while the historic core and the station itself show
  no change, as expected. Vertical offset −0.045 m, noise 0.044 m. A few thin
  "demolished" slivers along the rail lines are most likely trains standing
  in one survey. This is the Change showcase.
- **Los Angeles, South Park** (2016 vs 2023, 6.5 and 18.8 points/m²). Real
  changes are found (a new tower, a large construction site), but street trees
  are detected as buildings in both surveys there, so removed or grown trees
  show up as small new or demolished features. The measure scores for this
  area are low for the same reason (precision 0.10 and 0.07 against Overture,
  which also maps this area as large parcels).

Change detection has no independent reference in this version, so no accuracy
numbers are reported for it.

## 3b. The Netherlands (AHN)

The same pipeline runs on the Dutch national height model (AHN2-AHN5), read
from cached LAZ tiles instead of streamed EPT (see
[DATA_SOURCES.md](DATA_SOURCES.md)). Results computed on 2026-11-15 in
Amsterdam, validated against Overture Maps:

| Area | Survey | Detected / reference | Precision | Recall | F1 | Mean IoU | Height MAE (n) |
|---|---|---|---|---|---|---|---|
| Buitenveldert: post-war flats and row houses | AHN5 | 103 / 129 | 0.34 | 0.27 | 0.30 | 0.82 | 2.2 m (32) |
| Zuidas: office towers and complexes | AHN5 | 141 / 30 | 0.07 | 0.33 | 0.12 | 0.75 | 2.4 m (10) |

Matched outlines fit closely and heights are within about 2 m, but footprint
counts disagree for the same reason as in dense US cores: the Dutch reference
(largely from the national BAG register) maps every row house and every wing
of an office complex separately, while LiDAR sees one continuous roof.

Change, Zuidas, AHN3 (about 2017) against AHN5 (about 2024): 72 changes, 42 new
and 26 demolished, after aligning the surveys by 0.002 m (ground noise 0.14 m).
New residential blocks and a demolished complex replaced next door stand out.
The result also contains long, thin "new" strips along the motorway and railway
corridor and a cluster of irregular, tree-like shapes; these are most likely
vehicles, noise barriers or trees rather than buildings, and were not verified.

Each AHN job decompresses whole 1 x 1.25 km tiles (30-50 million points) to
crop them, so a cached 0.3 km² job takes about 3-4 minutes; the first job on
new tiles adds the download (about 1-2 minutes per tile).

## 4. Limits

- Heights are relative to the ground model. On steep slopes the downhill side
  of a building looks taller.
- Glass roofs and water on roofs can return few points and be under-detected.
- Dense evergreen trees next to a flat roof can be merged into it.
- Floor counts assume 3 m per floor; offices, warehouses and churches differ.
- Footprints include overhanging eaves, which cadastral outlines do not.
- Dense evergreen street trees (seen in downtown Los Angeles) can look like
  roofs to every cue SKYSCAN uses and be reported as small buildings.
- Change mode compares surveys of different density and season. Sparse
  surveys blur edges, and leaf-on versus leaf-off can change how trees look.
  The density ratio and vertical noise are reported so you can judge this.
- Vertical accuracy: 3DEP quality levels specify roughly 10 cm vertical error
  for good surveys; the measured noise between surveys is shown with each
  change job. A 2.5 m threshold is far above it, so single-floor changes are
  found but changes of less than a floor are not.
- Parked vehicles, trains and cranes can appear as small changes.
