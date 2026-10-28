# Sun expansion brief

Material to pick from for growing the suns and black holes. Choose what you
like, cross out what you don't, and paste the prompt at the bottom with your
picks filled in.

## What there is today

**Stars: 1,000 variations** = 10 types × 4 tints × 5 surfaces × 5 coronas

- Types: yellow dwarf, orange dwarf, red dwarf, red giant, blue giant, white
  dwarf, yellow-white, pulsar, emerald, violet
- Surfaces: calm, granulated, sunspots, plasma, active
- Coronas: soft, rays, halo, prominences, streamers
- All drawn in the "wispy" style: soft aura, flowing corona strands,
  white-hot disc.

**Black holes: 216 variations** = 6 disk colors × 3 disk widths × 3 tilts ×
jets or not × which side is brighter. About 1 folder in 12 gets one.

**Today a sun is pure chance.** Its look comes from the folder name and has
nothing to do with what is in the folder. Only its size follows the note count.

## Ideas

### 1. New kinds of star (multiply the type count)

| Idea | What it looks like |
| --- | --- |
| Binary pair | Two suns circling each other; planets lit from two directions |
| Brown dwarf | Dim, banded like a glowing gas giant, deep magenta-brown |
| Wolf-Rayet | Hot blue-white core inside expanding shells of gas |
| Protostar | Young star still wrapped in a dusty cocoon with a glowing disk |
| Carbon star | Deep ruby red, sooty patches, very large |
| Magnetar | Tiny, intense, with looping magnetic field lines |
| Variable (Cepheid) | Slowly breathes brighter and dimmer |
| Hypergiant | Enormous, blotchy, losing material into space |

### 2. More surfaces and coronas (5 each today)

- Surfaces: flares, giant convection cells, magnetic loops, starspot belt,
  bright faculae, boiling
- Coronas: crown (sharp spiky ring), solar wind (long swept-back tail),
  eclipse ring, flare arcs, aurora curtain

### 3. Brand-new traits (each one multiplies everything)

| Trait | Options | × |
| --- | --- | --- |
| Companion | none, small companion star, close binary | ×3 |
| Surroundings | none, dust ring, planetary nebula shell, bubble, debris disk | ×5 |
| Activity | steady, pulsing, flickering, flaring | ×4 |
| Size class within the type | small, normal, large | ×3 |
| Corona spin | still, slow, fast | ×3 |

### 4. Black holes

| Trait | Today | Ideas |
| --- | --- | --- |
| Disk colors | 6 | 10 (add teal, rose, white-hot, copper) |
| Disk style | 1 | smooth, turbulent, banded, clumpy, spiral arms |
| Jets | on/off | none, straight, twisted, wobbling |
| Photon ring | 1 | thin, double, flickering |
| Feeding | none | pulling a stream of gas off a nearby star |

### 5. Rare special kinds (alongside the 1-in-12 black holes)

- **Quasar**: blinding core and huge jets. Very rare, maybe for the biggest
  folder only.
- **Nebula core**: no star at all, just a glowing gas cloud with planets
  orbiting its center.
- **Dyson sphere**: a star inside a machine-built shell or swarm. It would
  pair well with machine planets.
- **Neutron pair**: two tiny stars spinning fast with a shared glow.
- **Wormhole**: a ring that bends the stars behind it.

### 6. Make suns mean something (my favourite idea)

Instead of chance, a folder's stats could pick some of its sun's traits:

- **Folder age**: young folders get hot blue stars, old ones red giants.
- **Recent activity**: busy folders flare and pulse, quiet ones stay calm.
- **Size**: the biggest folders become giants or hypergiants.
- **Links between folders**: heavily linked pairs become binary stars.
- **Unusual folders**: for example archive or trash folders turn into black
  holes.

The rest (tint, corona, surface) stays random, so suns still vary.

## Example scale

With types 10 → 16, surfaces 5 → 8, coronas 5 → 8, plus companion ×3,
surroundings ×5 and activity ×4:
16 × 4 × 8 × 8 × 3 × 5 × 4 = **245,760 star variations**.

With black holes at 10 colors × 3 widths × 3 tilts × 5 styles × 4 jet kinds ×
2 sides × 3 photon rings × 2 feeding = **21,600**.

## Cost and limits

- Each sun's image is made once (in a background worker) and reused, so new
  looks cost nothing per frame.
- Animated traits (pulsing, flaring, spinning) cost a little each frame.
  They are cheap when done as brightness or rotation changes on the cached
  image.
- Binary stars and nebula cores change how planets are lit and how orbits
  work, so they are the biggest jobs on this list.
- Every sun must still read as a bright point in the far view. The bloom and
  lanes take their color from the sun, so very dark kinds (brown dwarfs,
  nebula cores) need a glow color of their own.

## Prompt to paste when the planets are done

```
Expand the suns. Keep the wispy style and the far-view bloom.
New star types: [pick from section 1]
New surfaces: [section 2]   New coronas: [section 2]
New traits: [section 3]
Black holes: [section 4]
Rare kinds: [section 5, and how rare]
Folder stats that pick traits: [section 6, or "none, keep it random"]
Target: about [number] star variations and [number] black hole variations.
Show me preview sheets of every new type, and some random systems.
```
