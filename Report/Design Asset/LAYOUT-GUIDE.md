# TrailPeak Report: Canvas + Layout Guide

Design assets for the two report pages. Canvas PNGs are rendered at EXACT page size, so with Image fit = Fit every landmark below maps 1:1 to visual coordinates.

## Design tokens

| Token | Value |
|---|---|
| Brand green (primary) | rgb(45,106,79) / dark rgb(14,48,35) |
| Accent amber | rgb(217,119,6) |
| Page background | rgb(244,247,245) |
| Card surface | white, radius 14, border rgb(226,232,240), soft shadow |
| Text | rgb(15,23,42); muted rgb(100,116,139); faint rgb(148,163,184) |
| Favorable / unfavorable | rgb(21,128,61) on rgb(220,242,229) / rgb(185,28,28) on rgb(250,226,226) |
| Font | Segoe UI |

## Apply the canvas backgrounds

Per page: Format page > **Canvas background** > Browse > pick the PNG > **Image fit = Fit** > **Transparency = 0%** (default is 100%, the classic gotcha). Wallpaper stays untouched (it is excluded from PDF export).

- Page "P&L" (1280 x 1200): `canvas-pnl.png`
- Page "Pareto" (1280 x 1000): `canvas-pareto.png`

To regenerate after editing the HTML sources: headless Edge screenshot at exact page size with `--hide-scrollbars` (see the command in the repo history, or ask the agent).

## Page "P&L" (1280 x 1200): visual placement

| Visual | x | y | w | h | Notes |
|---|---|---|---|---|---|
| KPI Revenue Card (table hosting SVG measure) | 40 | 122 | 264 | 116 | see KPI hosting below |
| KPI Gross Margin Card | 352 | 122 | 264 | 116 | |
| KPI EBITDA Card | 664 | 122 | 264 | 116 | |
| KPI Operating Profit Card | 976 | 122 | 264 | 116 | amber-accented container |
| Slicer: Period | 44 | 330 | 280 | 48 | dim_date[YearMonthLabel], style Dropdown |
| Slicer: Region | 344 | 330 | 280 | 48 | dim_store[Region], style Dropdown |
| Slicer: Store | 644 | 330 | 280 | 48 | dim_store[StoreName], style Dropdown |
| Card: Data status | 944 | 330 | 292 | 48 | new card with [Data Through Label] |
| HTML P&L Statement (existing visual) | 26 | 426 | 1228 | 754 | snap it to sit inside the main container |

## Page "Pareto" (1280 x 1000): visual placement

| Visual | x | y | w | h | Notes |
|---|---|---|---|---|---|
| KPI Product Revenue Card | 40 | 122 | 264 | 116 | |
| KPI Units Sold Card | 352 | 122 | 264 | 116 | |
| KPI Vital Few Card | 664 | 122 | 264 | 116 | amber-accented container |
| KPI Top Product Card | 976 | 122 | 264 | 116 | amber-accented container |
| Slicer: Period | 44 | 316 | 280 | 48 | dim_date[YearMonthLabel], Dropdown |
| Slicer: Region | 344 | 316 | 280 | 48 | dim_store[Region], Dropdown |
| Slicer: Category | 644 | 316 | 280 | 48 | dim_product[Category], Dropdown |
| Card: Data status | 944 | 316 | 292 | 48 | new card with [Data Through Label] |
| HTML Pareto Analysis (existing visual) | 26 | 414 | 1228 | 562 | snap into the main container |

## KPI card hosting (the chrome layer)

The 8 SVG tile measures are in `POC/prototypes/kpi_card_measures.dax`. For each:

1. Paste the measure into `_Measures` (Desktop must be open on the model; or ask the agent to inject them into TMDL while Desktop is closed).
2. Select the measure > Measure tools > **Data category = Image URL**. Without this it renders as text.
3. Add a **Table** visual, put ONLY the measure in it, then format: Style presets None, header off, totals off, gridlines off, visual Background off, padding minimal, **Image size: height ~110**.
4. Size and position per the tables above. The white card and accent bar behind it come from the canvas, so the tile floats on the drawn container.

The delta chips compare vs budget (P&L page) and vs last year (Pareto page); the Vital Few and Top Product cards are Pareto-specific.

## Native slicer styling (so they sit inside the drawn slots)

- Style: **Dropdown**, single select OFF (Period can be single select ON if you prefer a hard month anchor).
- Visual **Background OFF**, no border, no shadow, no title (captions PERIOD/REGION/STORE/CATEGORY are drawn on the canvas).
- Values font 11-12, color rgb(15,23,42).
- Selection controls: "Select all" ON for Region/Store/Category.
- Edit interactions: slicers should filter everything on the page (default). The HTML visuals recompute automatically because their measures read filter context.

## Layer discipline (from the blog architecture)

- Backdrop (canvas PNG): zones, captions, branding. Never data.
- Props (SVG measures in native visuals): KPI tiles, data-status card.
- Actors (interactive visuals): slicers now, Deneb rebuilds of the statement and Pareto next (Step 4).
