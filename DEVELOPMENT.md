# Developing Planetarium

Planetarium shows an Obsidian vault as a universe: each top-level folder is a
sun (about 1 in 12 a black hole), each note a procedurally drawn planet on a
realistic orbit. Clicking a planet opens its note.

These notes cover how the code is laid out, the rules the look follows, how
to test, and what is planned. Read them before changing anything.

It was called "Solar System Graph" until 0.5.0. Code names like
`SolarSystemView` and the `solar-` CSS prefix are left over from that.

## How we work

- Explain changes in plain words.
- Agree on a new direction before building it.
- Show previews of visual changes: before/after images, preview sheets,
  GIFs, with random examples as well as basic ones.
- Report problems as soon as they come up.
- Commit and push after every finished step, straight to `main`.

## The look

- **Realism first.** Nothing geometric, low-detail or artificial next to the
  smooth painted spheres. That is why satellites, space stations, orbital
  rings and the "core breach" were removed, and why machine worlds are city
  planets seen from orbit, not grids or circuit boards. Hard shapes (perfect
  circles, straight lines, stripes, polka dots, bullseyes) get broken up with
  noise so they read as natural.
- **Exception: the faceted crystal worlds** (facets, shards, geodes, prism)
  are low-poly on purpose. Keep them looking like cut gems: crisp bevels,
  depth inside each face, inclusions.
- **No blur glows** around far-away planets.
- **No pixel specks.** Tiny flat dots around or on planets look like noise
  (old debris, asteroid belts, lightning). Use shaded rocks and soft patches.
- **Dark is fine for ominous worlds** (dead, destroyed, lava, scorched), as
  long as they stay readable.
- **Real planets and fiction-inspired worlds are fixed**: no random moons,
  features, debris or storm levels. They keep only what makes them
  themselves (Saturn's rings, Jupiter's red spot).
- Fiction-inspired worlds get our own names, never names from films or books.
- Strong storms should feel drastic; a hurricane brings a cloudy region.
- City lights show only at night, as clustered points of light.

## Code map

- `src/main.ts`: plugin entry, settings, commands.
- `src/view.ts`: the view: camera, drawing every frame, intro animation,
  search, filter, history, hover card, dev tools, adaptive quality, FPS.
- `src/universe.ts`: turns notes and links into systems, planets, moons and
  rogue planets; lays systems out; sizes per type.
- `src/planets/types.ts`: the catalogue of traits (types, patterns, details,
  palettes, atmospheres, features, rings, moons, storm levels, real and
  inspired planets) and `countPlanetCombinations`.
- `src/planets/planet.ts`: rolls a planet from a seed (`generatePlanet`),
  draws it in layers (`paintSphere`), rings, moons, debris; rarity
  (`planetRarity`, `rarityTier`).
- `src/planets/surface.ts`: per-type surface painters and features.
- `src/planets/pixels.ts`: pure pixel work (runs in a web worker): day layer,
  glow layer, night-only lights layer, clouds, shadow and night masks.
- `src/planets/star.ts`: suns and black holes. `src/planets/orbit.ts`: Kepler
  orbits. `src/planets/noise.ts`: value noise, fbm, cellular noise.
- `src/worker.ts` + `src/workers.ts`: background painting (bundled into
  main.js by `esbuild.config.mjs`).
- `src/space.ts`, `src/nebula.ts`: far-view backdrop (stars, nebula styles,
  glows).
- Lighting: a planet's surface image never turns; a shadow mask is rotated to
  face the sun exactly (this fixed the old "snap back" bug).
- Live births: notes created while the view is open pop in (`bornAt`). New
  notes take the outermost orbit because each system's members are sorted
  by creation date.

## Testing and previews

- `npm run build`: type-check and build `main.js`.
- `node tools/test/build.mjs`, then (with Playwright installed globally,
  prefix with `NODE_PATH=$(npm root -g)`):
  - `node tools/test/features.cjs`: clicks through every feature on a sample
    vault, including live births (`window.addNote` in `tools/test/vault.ts`);
    must end with `errors: []`.
  - `node tools/test/stress.cjs [quality]`: frame rates on a 3,300-note vault.
  - `node tools/test/profile.cjs [far|zoom]`: CPU profile.
  - `node tools/test/nebulas.cjs`: a screenshot of every nebula style.
- `npm run preview` builds `preview/*.html`; `node preview/capture.cjs
  "mode=bodies&type=ice" out.png 1` renders a sheet and runs the automatic
  checks (too dark, low contrast, blurry, blown out). `catalog.html?part=
  planets|extras|stars` shows every trait. Saved previews live in
  `preview/sheets/`.

## Web demo and README media

- `node demo/build.mjs` builds the web demo (the real view on a plain page,
  `view.demo = true`, random universes, Obsidian stand-in in
  `demo/obsidian-shim.ts`) into one file, `demo/dist/index.html`.
  `node tools/test/demo.cjs` checks it at desktop and phone sizes.
- `.github/workflows/demo.yml` publishes it to GitHub Pages at
  https://unscathering.github.io/Planetarium/. It is skipped while the repo
  is private. Once public: Settings > Pages > Source: GitHub Actions.
- README pictures live in `docs/media/`. Gallery: `npx esbuild
  tools/media/gallery.ts --bundle --outfile=tools/media/gallery.js`, then
  `node tools/media/shoot-gallery.cjs docs/media` (picks are in
  `DEFAULT_PICKS`; `... tools/test/out pick` shows candidates). Clips:
  `node tools/media/record.cjs <out> [universe flyin closeup cards]`
  (fake clock, frame by frame, makes .mp4 and .gif). Only the three GIFs
  (universe, closeup, cards) are kept in the repo; videos are uploaded
  through GitHub's editor, since only uploaded videos play in a README.
- README voice: short and plain, pictures over text, no walls of text.

## Releasing

1. Bump the version in `manifest.json`, `package.json` and `versions.json`.
2. Push a tag with the bare version (`git tag 0.5.0 && git push origin
   0.5.0`, no "v"). `.github/workflows/release.yml` builds the plugin and
   attaches `main.js`, `manifest.json`, `styles.css` and a zip. A release made
   on the website also gets its files filled in.
3. For a local build: `npm run build`, then zip `main.js`, `manifest.json`
   and `styles.css` inside a `planetarium/` folder (`dist/` and `*.zip` are
   gitignored). Install by unzipping into the vault's `.obsidian/plugins/`.

## Status

- Version 0.5.0. About 1.13 quadrillion planet combinations; suns are 1,000
  kinds of star and 216 black holes.
- Done: the plugin, far-view overhaul (nebula, lanes, bloom, trails, labels),
  smooth lighting and workers, moons and features, realism pass, the dead,
  destroyed, snow, real and inspired types, storm strength, J1407b and
  colossal rings, more patterns, details and palettes, rarity on cards, the
  legend (`?`), sun cards, double-click to fly in, performance presets, live
  births, nebula styles, the web demo.

## Next steps

1. **Collision-free orbits**: spacing that accounts for rings, moons and
   planet size, shared lanes for big folders. Also fixes two known issues:
   - A new folder makes `layoutSystems` lay every system out again, so suns
     jump to new places. Keep old positions and place only the new sun (or
     glide systems to their new spots).
   - A new note shifts its folder's other orbits slightly, because
     `generateOrbits` spacing depends on the note count. Make orbit k depend
     only on k.
2. **One or two more optimization rounds**, especially the far view with
   every effect on.
3. **Planet depth layers** (not started): a cloud layer above the surface,
   cloud shadows, an atmosphere shell with a sunset line; only on planets
   bigger than about 12 pixels.
4. **More kinds of sun**: ideas in `docs/sun-expansion-brief.md`.
5. Open questions: should "Surprise me" be the default nebula style (it is
   "classic" now)? Test the plugin in real Obsidian, desktop and mobile,
   before the first public release.
