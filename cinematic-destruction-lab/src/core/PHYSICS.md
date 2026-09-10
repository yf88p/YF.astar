# Bonded Rigid-Body Core

This is a deterministic, pre-partitioned rigid-body destruction model. It is not
a finite-element solver, a material certification tool, or a simulation of
arbitrary three-dimensional crack growth. There are no cosmetic particles,
scripted explosion velocities, or prerecorded destruction trajectories.

## Interface

```js
import { createProject, LIMITS, validateProject } from './model.js';
import { partitionObject } from './geometry.js';
import { initPhysics, Simulation } from './simulation.js';
import { Recorder } from './replay.js';

await initPhysics();
const project = validateProject(createProject('storefront'));
const simulation = new Simulation(project);
const recorder = new Recorder(simulation);

// Repeat for EACH physics tick, not once per rendered frame.
recorder.capture(simulation.step());
const visualState = recorder.sample(0.004);
const take = recorder.serialize(project, [
  { name: 'Front', position: [7, 5, 10], target: [0, 2, 0], fov: 45 },
]);
const imported = Recorder.fromJSON(take); // Also accepts a JSON string.
simulation.dispose();
```

- Coordinates are right-handed, y-up, in meters, kilograms, and seconds.
- Object rotation is XYZ Euler radians, matching Three's default order.
- Snapshot rotations and fragment `initialRotation` are `[qx,qy,qz,qw]`.
- `object.density` is the integer FRAGMENT COUNT. `materials[key].density` is
  volumetric mass density in kg/m^3. These are deliberately different quantities.
- `shape` is an editing label (`panel`, `box`, `beam`). All three describe the
  specified solid rectangular envelope; material selects its partition method.
- `createObject()` raises its default center so its rotated envelope rests on
  y=0. An explicitly supplied position is respected, including initial overlap.
- `partitionObject()` is physics-independent and requires no initialization.
  Fragment vertices are relative to that fragment's true volume COM, not the
  seed site. `center` is object-local. `exterior` has one boolean per triangle,
  aligned with successive triples of `indices`.
- `Simulation.fragments` has the geometry fields plus `initialPosition`,
  `initialRotation`, material, radius, and internal collider/body references.
  Treat this array and `Simulation.bonds` as read-only outside instrumentation.
- Internal bond centers are object-local. Explicit inter-object bonds have
  `centerSpace: 'world'`, an INITIAL world center, and id `connection:<id>`.
  Their endpoints still reference real fragment ids in the same graph.
- `step()` accepts no timestep argument, executes one fixed tick, and returns a
  new snapshot. After tick 1440 it returns the final state without advancing.
- `removeSupport(objectId)` removes one local attachment, immediately rebuilds
  connectivity, and returns whether an active attachment was removed. It does
  not break bonds. Unknown objects throw; known unsupported objects return false.
- `applyImpulse(point,direction,magnitude)` applies N*s at an actual fragment
  surface/inside point. Direction is normalized. The nearest collider must be
  within 5 cm of the supplied point; otherwise it returns false, not a remote hit.
  Valid impulses and support changes at the current tick can be captured by
  replacing that tick's recorder frame.
- Snapshot `velocity` is velocity at EACH FRAGMENT COM, including its compound's
  angular contribution. `bodyId` is an opaque Rapier handle, not an array index.
- Projectile snapshots additionally preserve `damageBudget`, `damageSpent`,
  `sweptContacts` (fragment ids already assessed), and `predictedBonds` (bond ids
  already allocated predictive damage). These are discrete replay state.
- `swept-impact` events report a real next-tick sphere/convex intersection,
  `estimatedImpulse`, incident `energy`, actual allocated `damageWork`, and whether
  the hit fragment was released. They are predictions, not measured impulses.
  `contact` events retain measured `impulse`, use `source: 'rapier-contact'`, and
  report `predicted` and `damageWork` so suppressed double-counting is inspectable.
- `released` means the current component has no active attachment. It includes
  initially free objects, not just fragments that recently broke off.
- Fixed fragments report `sleeping: true`. `stats.active` counts moving/awake
  dynamic fragments, not rigid bodies. `stats.components` counts compound bodies.
- The ground is an actual fixed Rapier box: x/z in [-200,200], top y=0, depth 1 m.
  It has friction 0.7 and restitution 0. It is not included in fragment counts.
- Call `dispose()` to free both the Rapier world and event queue. It is idempotent.

## Geometry

Glass and concrete use a seeded jittered site distribution in the local xy
rectangle. Each site is clipped against the exact pairwise Voronoi half-planes

```
(site_j - site_i) dot p <= (|site_j|^2 - |site_i|^2) / 2
```

and the four object bounds. The resulting convex polygon is extruded along local
z. Sites only determine partition topology; neither rendering nor collision uses
a seed-centered bounding box. The polygon shoelace integral gives its area and
centroid. `volume = area * layerDepth`, `mass = volume * materialDensity`.

Concrete may have 2..5 depth layers when its thickness and a divisor of the desired
count permit. Layers reuse the same xy cells, producing aligned interfaces, not a
full 3D Voronoi tessellation. Prime counts can remain single-layer. Glass always
uses through-thickness shards. Internal shared edges generate bonds whose area
is `edgeLength * layerDepth`; between-layer bonds have polygon area. There is
no overlap, gap, or collider inflation deliberately introduced at fracture faces.

Timber and steel use exact rectangular segmentation. Prime factors of the desired
count subdivide the longest remaining dimension. Timber grain is its object's
longest dimension. Bonds with a normal transverse to grain have BOTH strength and
toughness multiplied by `grainStrength` (default 0.16). Cross-cut bonds retain full
capacity. Very slender beams may only have longitudinally arranged segments; this
does not resolve individual fibers or knots.

Geometry is calculated in JS double precision. Rapier convex hulls and mass
properties use its f32 WASM arithmetic, so simulated mass/COM have small additional
roundoff. Extremely small/high-aspect fragments may be ill-conditioned; a failed
convex hull produces an actionable error and frees the partially built world.

## Graph and Supports

All unbroken bonds, including explicit connections, define one graph. Each graph
component has ONE Rapier rigid body and one real convex collider per fragment.
Fragments in the same body do not collide with each other; disconnected components,
projectiles, and the floor have normal Rapier contacts. Every dynamic component
and projectile has CCD enabled. Solver iterations come from project settings.
There is no artificial linear or angular damping.

A fixed object contributes one attachment at its lowest initial fragment COM
(ties use deterministic fragment order). Any component containing that fragment
is fixed. A fragment separated from the attachment becomes dynamic, even if it
came from an object whose original `fixed` property was true. If multiple supports
are connected, removing one leaves the others active. A single fixed attachment
is a full six-degree-of-freedom clamp, not a pin or distributed adhesive boundary.

An explicit object connection chooses the closest pair of initial fragment COMs.
Its effective area is the smaller object's smallest cross-sectional area. Strength
is the specified connection threshold or the lesser endpoint material threshold;
toughness is the lesser endpoint toughness. Such connections are idealized
attachments, including across a user-specified gap. The model neither adds visible
connector geometry nor infers connections from merely touching objects.

On fracture, unchanged components retain their original body. Split components
retain world positions and rotations. Each new body's velocity is sampled from
its OLD body's velocity field at the NEW Rapier COM. For dynamic fracture this is
the post-contact field. For predictive supported brittle fracture it is sampled
before the contact solve:

```
v_new = v_old + omega_old cross (COM_new - COM_old)
omega_new = omega_old
```

No separation impulse, arbitrary fragment speed, or explosion radius is used.
For a free body this retains linear and angular momentum about a common origin,
up to numerical mass-property error. A fixed parent's velocity field is zero.
Supported glass/concrete may release before impact as described below, so the
NORMAL Rapier solve transfers projectile momentum into newly freed volumes.
Timber/steel retain post-contact damage: an intact clamped component can absorb
that first impulse through its attachment. The predictor neither transfers an
estimated impulse into a body nor deletes a collider to make a projectile pass.

## Predictive Brittle Fracture

Immediately before each fixed step, each projectile sphere is swept along its
current linear velocity over at most `dt`. The closest REAL collider is queried,
including blockers of other materials, the floor, dynamic bodies, and other
projectiles. Only a currently FIXED component's glass/concrete fragment is
eligible. Dynamic targets of every material retain measured post-contact damage.

When the world broadphase is current, this uses `world.castShape`. Rapier 0.19 has
no public query-only broadphase refresh; propagation alone does not register new
colliders. Immediately after creation/spawn/rebuild the core instead casts against
each actual collider with Rapier's convex narrowphase and selects the closest hit.
Local witnesses/normals from these casts are transformed into world space. There
is NO extra warm-up physics tick, infinite-plane test, bounding-box damage test,
teleport, collider removal, or collision disabling.

Queries freeze other colliders at their current poses, matching the world query.
They do not sweep a moving blocker or its rotation. Gravity/curved trajectories
within the upcoming tick are also not included. Accordingly this is a one-tick
energy-trigger approximation for supported targets, not a fully coupled
space-time fracture/contact solution. A newly intervening moving body can make a
prediction differ from the later contact. Measured contacts are still recorded
separately and remain the only source of projectile/shard momentum exchange.

For the actual world-space witness and outward normal:

```
u = max(0, -projectileVelocity dot normal)
E_incident = projectileMass * u^2 / 2
J_estimated = projectileMass * u * (1 + max(0.15, targetRestitution))
B_launch = 0.35 * projectileMass * launchSpeed^2 / 2
B_available = min(0.35 * E_incident, B_launch - workAlreadyAllocated)
```

`J_estimated` is a fixed-wall upper impulse estimate for cohesive initiation. It
is NEVER applied to a rigid body. The finite local process zone contains the hit
fragment and its directly face-bonded brittle neighbors, excluding inter-object
connections from neighborhood expansion. All bonds incident to these fragments
get the minimum local weight 0.08; nearby bonds use the distance weighting below.
This permits a physically colliding set of shards to detach instead of punching
one large tightly fitting prism out of an otherwise perfectly rigid aperture.
The one-cell halo is discretization-dependent, not calibrated crack propagation.
Only glass/concrete bond materials can receive predictive damage.

The predictive pass first requires enough available cohesive work to fund the
ENTIRE candidate zone's remaining bond work:

```
zoneWork = sum(area_b * toughness_b * (1 - damage_b))
predictive damage is permitted only if B_available >= zoneWork
```

An under-budget hit is inspected once but causes no predictive damage. This
prevents slow contacts from accumulating one unearned fracture pulse each tick.
When funded, work is distributed by the same normalized weights/contact initiation
rules below. The ledger is charged only the actual clamped increment
`sum(deltaDamage_b * area_b * toughness_b)`, not a separate full energy allocation
for every bond. Previously allocated predictive bonds cannot receive another
predictive or measured allocation from the same projectile.

Each projectile/fragment pair is predicted at most ONCE for that projectile's
lifetime. Its later measured contact still resolves fully and emits a contact
event, but does not add damage again. This also suppresses contact-model fallback
on that pair if its predictive zone was under budget. Repeated ricochets against
the same fragment are conservatively not rearmed. Other new contacts share the
remaining launch ledger; gravity and secondary contacts cannot silently replenish
that DIRECT projectile damage budget. Debris/debris and debris/floor impacts
still use their own measured contact-energy estimates.

After predictive bond failures, connected components are rebuilt at unchanged
poses and inherited old velocities (zero for fixed parents). THEN the usual
fixed-dt Rapier step solves the ball against the newly dynamic convex colliders.
The projectile can pass, stall, deflect, or rebound according to actual masses,
contacts, friction, and remaining connectivity. Perforation is not guaranteed for
arbitrary fragment counts, impact positions, panel thicknesses, or projectile mass.

## Contact Damage

For dynamic targets, timber/steel, and non-predicted contacts, contacts are solved
BEFORE the graph is split. One-substep motion-clamping CCD is
used intentionally: with this Rapier version multiple CCD substeps can resolve a
thin-panel hit and remove its manifold before final event inspection. One substep
may clamp a projectile for one tick before the impulse is solved. The damage
trigger is the real normal impulse summed from the Rapier contact manifold, not
`force * renderDt`, an infinite-plane intersection, or an assumed impact time.
Measured contact events precede their resulting break events. A predictive
`swept-impact` event precedes its `source: 'swept-impact'` bond failures; the real
contact can follow in that step or the next CCD-clamped tick.

For each contact pair:

```
J = sum of manifold normal impulses                       [N*s]
u = abs(pre-step relative contact-point velocity dot n)   [m/s]
invMu = invMass_A + invMass_B                              [1/kg]
E = min(J * u / 2, u^2 / (2 * invMu))                     [J]
```

Fixed bodies have zero inverse mass. The kinetic cap uses translational reduced
mass, not the complete rotational effective contact mass. Pre-step velocity
includes angular motion; gravity added during the tick is not in this estimate.
Friction is solved physically, but tangential impulses do not directly fracture
bonds. Contacts below 0.1 m/s produce no impact damage, preventing resting forces
from acting as repeated hammer blows. Gravity fatigue is a separate calculation.

Contact energy is shared equally between fragment recipients (if both colliders
are fragments). Candidate intact bonds are in the hit component, within
`R = max(0.15 m, 1.5 * hitFragmentRadius, 3 * projectileRadius)` of the contact.
Their weight is `max(0, 1 - distance/R)`. Bonds incident to the contacted fragment
retain a minimum weight of 0.08 even when their face center is farther away. Weights
are normalized; no candidate receives an unnormalized copy of the impact energy.

```
pulseTime = max(1e-5, min(dt, minimumObjectDimension / u))
stress_b = J * normalizedWeight_b / (pulseTime * area_b)
work_b = area_b * toughness_b
damageIncrement_b = 0.35 * E * normalizedWeight_b / work_b
```

For direct projectile contacts, available work is additionally capped by that
projectile's remaining launch ledger. Already predicted projectile/fragment pairs
and already funded predictive bonds are excluded from contact damage, never from
the collision solver. The predictor expands the minimum-weight incident set to
the one-face-neighbor process zone described above; other contacts do not.

Damage initiates when the estimated stress exceeds bond strength, or allocated
energy exceeds `work_b`, or the bond is already damaged. For steel the stress
onset is `yieldFraction * threshold`, default 0.22. A steel bond sets `yielded`
when accumulated damage reaches that fraction; it still rigidly connects its
segments until damage reaches one. All materials fail at damage one. Steel's high
toughness typically permits repeated sub-failure hits; grain factors make timber
splitting directional. Parameters are illustrative effective values, not fitted
test certificates or universal properties of a material class.

The factor 0.35, process-zone gate, one-cell halo, and locality/pulse estimates are
explicit modeling assumptions. Damage is an energy-driven state variable, not an
additional force. Fracture work is NOT separately subtracted from rigid-body
kinetic energy: the new ledger bounds credited fracture work, not a complete
mechanical/thermal energy balance. Non-projectile contact work is pairwise, not
globally optimized. Therefore this model does not claim exact total energy
conservation or calibrated fracture speed. It does preserve the rigid velocity
field through topology changes and adds no explosion energy.

## Gravity Load Approximation

Each active attachment is a root of a capacity-weighted shortest-path tree.
An edge costs `initialCOMDistance / (area * threshold)` (minimum distance 1 mm).
Thus strong steel paths generally carry frame loads instead of weak glazing.
Paths are rebuilt after topology/support changes and ties are deterministic.

Subtree mass and its mass-weighted world center accumulate toward the roots:

```
F = subtreeMass * gravity
M = F * horizontalDistance(subtreeCOM, bondCenter)
stress = F / area + 6 * M / (area * effectiveSectionLength)
increment = dt * max(0, stress / onsetStrength - 1)
```

For prism side bonds, effective section length is the longer side of the bond
face. For depth and explicit connection bonds it is sqrt(area). Steel uses its
yield onset strength; other materials use threshold. Only overloaded bonds on
rooted load paths fatigue. A fully free component falls as a rigid body and has no
quasi-static gravitational internal load in this approximation.

This is a capacity-weighted spanning-tree approximation, not elastic load sharing.
It ignores parallel-path stiffness, true bending axes, deflection, buckling,
compression/tension asymmetry, reinforcement, and plastic geometric deformation.
The longer-side section estimate can understate weak-axis bending. Contact with
the ground does not create a new graph attachment or redistribute this virtual
load tree. Removing a support can change later overloads; it does not immediately
mark remote bonds as broken. A detached but internally intact beam remains a
compound body rather than turning automatically into loose pieces.

## Example Fixtures

The storefront has three 2.17 x 3.92 x 0.012 m glass panels, 48 fragments each,
within the editable steel frame. Its shot remains 8 kg, radius 0.16 m, 28 m/s,
from z=5 toward -z at t=0.4 s. The glazing thickness is now 12 mm, an ordinary
architectural-glass scale, rather than the former 35 mm solid slab. This reduces
the initially hit shard's mass from about 16.37 kg to 5.61 kg without changing
material density or adding any velocity. In the regression fixture the whole
sphere exits behind the pane at tick 72 (0.600 s), with z velocity about -12.37 m/s.
Nine local fragments release in the predictive pass and then receive real contact
momentum. With 35 mm panels, this same discretization can still arrest/deflect the
shot through the mass and friction of large close-fitting shards; no bypass is
installed for that case. The generic `createObject('glass')` default remains
35 mm, and users can edit thickness explicitly.

The material range is an equivalent-geometry comparison: ALL four fixtures are
1.35 x 2.4 x 0.04 m, have 24 fragments, the same seed, and one lowest-fragment
attachment. Four simultaneous projectiles have identical radius/mass/speed/time/
direction and y/z launch position; only their x positions and ids differ. Mass,
grain segmentation, thresholds, toughness, restitution, and fracture sequencing
are material-dependent. The default shot releases and passes through the local
glass/concrete zones, breaks timber bonds after contact, and produces unbroken
yield-damaged steel bonds with rebound. This is not a claim that those outcomes
hold at every velocity or that distinct crack counts are forced for each material.

The structure is explicitly a WEAK-JOINTED timber assembly, not a solid intact
wood beam. Its project-local timber segment-joint threshold is 0.30 MPa; ordinary
`MATERIALS.timber.threshold` stays 9 MPa for other projects. The two idealized
bearing connections explicitly retain the concrete's 2 MPa effective threshold
instead of inheriting the weaker timber joint value. Dimensions, grain, density,
toughness, and actual convex geometry are unchanged. Both attachments keep the
assembly stable. Removing either at tick 240 changes only that attachment; around
tick 245 four overloaded INTERNAL lintel bonds fail and pieces subsequently fall
roughly 3 m under actual gravity/contacts. This replaces the former example where
only attachment/release flags changed while an intact lintel still rested on the
piers. Because floor reactions do not feed back into the virtual load-path tree,
this demonstration is not a prediction that unbolting a real floor-supported pier
necessarily transfers its full weight into a bridge beam.

## Replay and Limits

- Maximum 600 fragments TOTAL, 60 objects, 1800 explicit connections, 64 impacts.
- `dt = 1/120` s; maximum 1440 executed ticks, 12 seconds, 1441 recorded frames.
- At most `600 * 1441 = 864600` fragment states per take, before cloning/import.
  These are upper bounds, not a promise that every scene can record all 1440 ticks.
- `LIMITS.maxRecordingBytes = 134217728` sets a 128 MiB compact-JSON UTF-8 wire
  cap. `LIMITS.recordingMetadataBytes = 1048576` reserves 1 MiB for the project,
  cameras, take envelope, brackets, and frame-array commas. Frame data therefore
  has a conservative maximum of 127 MiB, even when metadata uses less space.
  Bonds, projectiles, events, prediction ledgers, and any extra frame JSON fields
  all count toward the frame budget; this is not just a fragment-state estimate.
- Launch radii are 0.05..0.5 m, masses 0.01..1000 kg, speeds 0..100 m/s.
  `maxSpeed` limits launch input, NOT post-contact fragment speed; silently
  clamping physics velocities would destroy momentum conservation.
- Impulse magnitude is 0..1e6 N*s. Gravity is 0..30 m/s^2, solver iterations 1..32.
- Object dimensions are 0.005..30 m per axis; editable centers are within +/-100 m.
- Impact times must permit execution before tick 1440. An impact fires at the
  first tick START whose time is at least the requested time. Its first moved
  projectile state therefore appears in the next snapshot.
- Project validation checks all required nested fields, identifiers, connectivity,
  finite numbers, material definitions, and budgets before physics allocation.
  It rejects circular/non-JSON data, excessive metadata depth/size, and invalid
  versions, and returns an isolated copy without changing the caller's data.
  Object and connection ids cannot contain `:`, which is reserved for generated
  fragment and bond ids.
- Recorder capture requires consecutive fixed ticks; capturing again at the same
  tick replaces the last frame. It does not silently discard frames on overflow.
- `new Recorder(sim, { maxBytes } = {})` optionally lowers the FRAME-data byte
  budget for resource-constrained callers/tests. `maxBytes` must be an integer in
  [1, 134217728]; the effective public `recorder.maxBytes` is capped at 127 MiB to
  preserve the global metadata reservation. Tiny custom budgets are supported;
  the optional value does not include the separate global metadata reservation.
- `recorder.frameSizes[i]` is the exact UTF-8 byte length of compact
  `JSON.stringify(recorder.frames[i])`. `recorder.byteSize` is their sum, excluding
  array brackets and commas. Thus compact `JSON.stringify(frames)` has byte length
  `byteSize + 2 + max(0, frames.length - 1)`. Treat frame arrays and accounting
  fields as read-only. `Recorder.fromJSON()` restores these counters and the
  default global frame allowance; custom local budgets are not serialized.
- Constructor/capture validate and measure each complete frame BEFORE cloning it
  into storage. Replacement subtracts the old last-frame size before testing the
  new total. Any rejection leaves the recorder's frames, frameSizes, byteSize,
  last frame, and duration unchanged. Recording does not advance or roll back the
  Simulation: if capture fails after a step, the UI must stop stepping, display the
  last stored frame, and make that take read-only or rebuild the simulation.
- A byte-budget failure throws a `RangeError` with
  `code: 'RECORDING_BYTE_LIMIT'`, `section: 'frames' | 'metadata' | 'take'`,
  `requiredBytes`, and `limitBytes`. Its message suggests reducing fragmentation/
  duration or project/camera metadata. Other schema errors remain ordinary Errors.
- Samples clamp to the recorded time range. Position and velocities interpolate
  linearly; quaternion interpolation uses the shortest arc. Bonds, support state,
  sleeping/released flags, events, body ids, and impact firing are from the
  preceding tick. New projectiles do not appear before their recorded spawn frame.
- Exact tick sampling tolerates floating-point division roundoff and returns the
  complete original frame, even during arbitrary backwards seeks. Returned state
  is copied, so changing a sample does not change stored history.
- `serialize(project,cameras)` and `Recorder.fromJSON()` validate take version,
  dt, bounded consecutive frames, ordered geometry/bond ids, finite poses and
  velocities, unit quaternions, state flags/statistics, material/projectile
  identity, and irreversible damage/support transitions. Raw JSON strings over
  128 MiB UTF-8 (including whitespace) are rejected BEFORE parsing. Object imports
  and serialization measure all frames and the reserved metadata BEFORE cloning.
  Compact exports that pass validation therefore fit the import wire cap. Adding
  excessive pretty-print whitespace to an external file can still exceed it.
  Cameras require `position` and `target`; optional `fov`
  and `time` are checked. Name/id metadata is preserved.
- Nested project/camera/frame metadata must be finite plain JSON: no cycles,
  undefined/function values, non-plain instances, accessors, sparse arrays,
  symbol keys, or `toJSON` conversion hooks. JSON trees also have safety bounds
  of 32 levels and one million visited values per measured frame/envelope. Project
  validation retains its stricter existing project-specific bounds.
- Accounting exactly includes JSON escaping, UTF-8 multibyte characters, astral
  pairs, lone-surrogate escapes, keys, punctuation, and number formatting. The
  counter traverses data without allocating a take-sized JSON string or encoded
  byte buffer. Validated imports clone frames individually. This adds one full
  per-frame traversal to every capture, on top of frame validation and storage
  cloning, and additional accounting passes on import/export. It consumes CPU at
  physics-tick cadence; it does not change dt or determinism. The 128 MiB bound is
  serialized size, NOT a JavaScript heap cap: object overhead, copies, export
  strings, and browser rendering can require substantially more live memory.
- Projectile work ledgers and prediction-id sets are validated when present,
  including launch-energy bounds, existing ids, and irreversible credit/history.
  Older version-1 takes without these additional inspection fields remain valid.
- Replay is a full VISUAL/INSPECTION state history, including velocities and
  topology. It is not a Rapier solver checkpoint. There is no claim that an
  interpolated frame can resume bit-identical physics with restored contact warm
  starts. To branch deterministically, construct the project again and repeat the
  same tick-indexed controls; no wall-clock time or rendering cadence enters core.
- Determinism is tested on the same Rapier/WASM version/runtime. Cross-version or
  cross-platform bitwise identity is not promised. Project object ids generated
  without overrides are unique within this module session, not persistent UUIDs.

## Independent Evidence

Run after installing the repository's declared dependencies:

```sh
node --test tests/core.test.js
```

The 30 focused Node tests pass against the repository's installed
`@dimforge/rapier3d-compat` 0.19.3 using the command above. The package emits an
upstream initialization deprecation warning; tests execute the real WASM engine.

Full-duration storefront physics smoke runs also reached tick 1440, including the
scheduled impact and resting debris. The serialized byte budget can terminate
recording before the physics tick ceiling for large histories.

Evidence includes:

- All four materials, counts 1/7/48/600: independent signed-tetrahedron mesh volume
  and COM integration, exact dimensional bounds, graph connectivity, total mass
  error below 1e-5 kg, and repeated seeded byte-for-byte geometry equality.
- Independent point-in-convex-polygon coverage across a layered concrete volume:
  every interior sample belongs to exactly one prism; a different seed changes it.
- A physical storefront stays intact for 120 unstruck ticks; invalid projects
  (including nested NaN and cycles) fail without caller mutation.
- Local support removal leaves remote attachments/bonds alone; explicit
  connections retain a remaining support; removing a pier changes later gravity
  overload and release instead of triggering instantaneous remote failure.
- Timber has separate along/across-grain capacities. Repeated steel impulses
  produce intermediate yield/damage before failure, unlike the brittle specimen.
- A controlled spinning compound split is checked independently using analytic
  box inertia and angular momentum about one COMMON world origin: linear residual
   tolerance 2e-4 kg*m/s and angular residual tolerance 2e-3 kg*m^2/s.
   The published relative-plus-absolute criterion is also asserted componentwise:
   `abs(residual) <= absoluteTolerance + 1e-6 * abs(referenceComponent)`.
   Both the stricter absolute fixture checks and this scale-aware criterion pass.
- A frictionless-normal sphere/wall contact with restitution 0.65 agrees with
  `v_out = e*v_in` and `J = m*(1+e)*v_in` to 0.05 m/s and 0.05 N*s.
- A real dynamic projectile contact precedes split events, retains the angular
  velocity field, and conserves total linear momentum to 0.01 kg*m/s.
- Real 5 mm glass colliders are struck at 10, 50, and 100 m/s with both 0.05 m and
  0.5 m projectile radii. Hits produce contact and damage; shots beyond the actual
  panel edge plus radius do neither. No infinite-plane fallback is involved.
- A dropped convex concrete fragment contacts the floor and settles above it.
- Fresh, never-stepped worlds perform actual convex sweeps; the pre-contact
  release test preserves all collider volumes, poses, and velocities before the
  normal solver runs. Repeating the prediction does not create another pulse.
- The exact default storefront shot has a swept event, actual measured contact,
  two or more moving volumetric shards, and complete sphere passage behind glass.
  Credited work is bounded, audited against event totals, and survives replay.
- Two arbitrary hit points on a rotated panel agree with independently transformed
  surface points within 4 mm. An edge miss and a nearer steel shield do not cause
  hidden glass damage. The actual convex shape, not an infinite plane, is decisive.
- Identical 0.25 and 1 m/s shots on supported glass/concrete fixtures produce real
  contact but no damage or repeated predictive energy credit.
- All four identical range fixtures receive actual simultaneous contacts. Four
  separate identical FREE zero-gravity fixtures also retain their analytically
  expected material mass and conserve projectile-plus-fragment linear momentum
  within 0.015 kg*m/s without an external attachment reaction.
- The default weak-jointed structure is intact for 240 ticks. Removing either
  attachment causes internal gravity failures and more than 2 m of actual lintel
  displacement, not just a change in released statistics.
- A sleeping, settled concrete fragment wakes and moves under a new applied
  impulse and, independently, under a later actual projectile collision.
- Two independent render-cadence accumulators produce identical entire physics
  histories, including fracture events, not just similar final screenshots.
- Recordings round-trip, sample backwards at every exact tick, interpolate at
  arbitrary fractional times, preserve preceding discrete transitions, isolate
  returned copies, reject tampering, and enforce tick/frame bounds.
- Byte accounting is independently compared with
  `TextEncoder().encode(JSON.stringify(value)).length`, including Unicode,
  controls, quotes/backslashes, lone surrogates, unusual numbers, and JSON framing.
  Small custom budgets test exact-boundary acceptance, atomic append/replacement
  rejection, replacement refunds, and restored import counters. Metadata overflow
  and unsafe/non-finite metadata are rejected. An object take with shared text
  references tests the global import limit without allocating a 128 MiB JSON
  string or a 128 MiB set of distinct frame payloads.

These tests establish the listed mechanics and invariants. They do not establish
engineering accuracy for real glass, concrete, timber, steel, structural safety,
blast response, or terminal ballistics.
