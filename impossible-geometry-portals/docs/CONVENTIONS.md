# World And Portal Conventions

## Coordinates And Identity

The simulation uses meters, seconds, right-handed coordinates, world +Y up, and camera local -Z forward. JSON vectors are `[x,y,z]`. Unit quaternions are `[x,y,z,w]`. Spawn yaw/pitch are radians. Editor Euler controls display degrees and serialize normalized quaternions.

Rooms are finite, nonoverlapping axis-aligned interior boxes. Their `center` is the geometric center and `size` is the full dimension. Static blocks can have arbitrary rigid rotation. Portals attach to a room boundary, not to a movable body or decorative mesh. Room surfaces remain solid outside an active finite aperture. Flush wall graphics are clipped out of apertures too.

All entity IDs are globally unique strings. `player` is reserved. A physical cube appears once in `World.cubes`; scene copies are render objects, not extra masses. The authoring document is persistent; runtime maps hold velocities, support state, door motion, and held-object state separately.

## One Rigid Mapping

Portal A has center `a` and rotation `Qa`. Local +Z points inward toward its room. Local +Y is aperture up, and +X is aperture right. Portal B uses the same convention.

```text
H = rotation of pi radians about local Y = diag(-1, 1, -1)
R = Qb H inverse(Qa)

point'       = b + R (point - a)
direction'   = R direction
velocity'    = R velocity
angularVel'  = R angularVel
orientation' = R orientation
camera'      = the same point and orientation mapping
```

The inverse is the same construction with A and B exchanged. These are rigid transforms; scale is always one. `mapPoint`, `mapDirection`, and `portalRotation` are used by crossing, transformed cameras, carried paths, ray queries, and rendered copies.

The mathematical mapping does not add speed. World gravity, ground friction, control acceleration, and collision impulses occur outside that mapping. `lastMapping` records before/after velocity and speed at the mapping instant. The physical solver uses a separate two-millimeter positional skin after a crossing, not a velocity boost.

Independent tests use explicit scalar quaternion-to-matrix formulas and known numeric answers, not the production transform to generate its own expectations. Published well-conditioned tolerances are position roundtrip <= `1e-5 m`, normalized direction error <= `1e-6`, and speed error <= `1e-6 * speed + 1e-10 m/s`. Cases include exact zero and near-zero speeds, wall/wall, wall/floor, and oblique orientations.

## Placement

Validation checks finite transforms, normalized quaternions, room references, inward orientation, coplanarity, complete aperture fit, equal paired sizes, mutual distinct links, nonoverlap, and one meter of static throat clearance from blocks and doors. Body spawns must fit the room without initial static penetration. The same checks protect imports and editor transactions.

Version 1 supports the six axis-aligned room faces, with arbitrary roll around a face normal if the entire aperture fits. Arbitrarily tilted portal mathematics is supported and tested, but arbitrary sloped host surfaces, room rotation, scaling, moving portals, unequal paired sizes, and portal placement on blocks are intentionally unsupported.

Portal pairs are created atomically. Orphan portals are not a valid saved state. Deleting/unlinking removes both apertures in one transaction, restoring their room surfaces. The pair can instead remain authored but disabled.

At runtime, `setPortalEnabled` recovers overlapping bodies inward, or uses their last fully safe pose. It cancels an affected hold and zeroes velocities for that recovery. If neither recovery pose is free, closure is refused. Render geometry is rebuilt on a successful state change, so disabling visibly restores a solid host and enabling cuts it again.

## Fixed-Step Movement

Physics uses `1/120 s` ticks, independent of rendering. `advance(realDt)` takes at most 12 ticks, clamps incoming elapsed time to 0.1 seconds, and discards overload. Pausing does not accumulate a catch-up debt. The documented maximum speed is 28 m/s; velocity is capped during ordinary integration, not during the rigid portal mapping.

Each swept displacement is segmented into lengths <= 0.08 m. Public diagnostic `moveBody` calls are capped at 40.96 m / 512 segments. Supported high-speed traversal is bounded by these settings, rather than claiming unrestricted continuous collision detection.

Crossing requires a signed, front-to-back center-plane crossing and a swept intersection within the finite opening. Projected body extents must fit at both apertures. Room support is resolved before the crossing query so a floor-flush opening is not incorrectly rejected by the gravity increment. Both the mapped throat pose and mapped endpoint must be clear. Remaining swept motion is rotated into the destination frame.

Explicit destination-exit state suppresses chatter for 35 milliseconds. Resting near the plane is not a crossing. A deliberate reverse crossing is permitted after that interval. Outside the finite opening, or when the destination is blocked, the host is solid.

The first-person collider is an upright box of half-width 0.28 m and half-height 0.85 m, with acceleration, support, gravity, and an edge-triggered jump. Walking speed is 5.8 m/s and jump speed is 5.6 m/s. It is not a rotating capsule solver.

The view orientation is transported once and retained in a separate view frame; later mouse input composes into it. There is no automatic orientation leveling. The eye's 0.67 m offset is rigidly transported at crossing, then smoothly approaches upright with exponential rate 5/s. This is camera comfort recovery only and cannot rotate or change physical velocity. Eye and body can briefly be on opposite sides; `cameraFrame()` then maps the eye into the correct room independently. Render near distance shrinks as the camera approaches an aperture, avoiding the usual near-plane disappearance immediately before crossing.

## Cubes And Straddling

Cubes have fixed dimensions, mass `size^3` at unit density, quaternion orientation, linear velocity, and angular velocity. A conservative axis-aligned envelope of the rotated cube is used for contacts. Static rotated blocks use oriented separating axes. Impacts are inelastic, with simple push transfer and exponential support friction. Angular integration is collision checked; contact impulses do not calculate a full torque manifold. This is a bounded box-based solver, not a general-purpose rigid-body engine.

Before its center crosses, a fitting cube has one source body and a transformed destination collision proxy. Destination bodies collide with that proxy. Both sides must be clear for protrusion or continued motion. The proxy uses the conservative whole transformed envelope; this deliberately overestimates the contact volume near corners rather than allowing wall/frame tunneling. The actual visual geometry is not expanded.

Rendering keeps the source half on the source room's inward side and the transformed copy on the destination room's inward side. The two clipping planes are complementary under the rigid map. When the center crosses, ownership swaps but identity and mass do not. Reversing before crossing, releasing while protruding, pushing from either side, frame contact, blocked destinations, and later reversal are covered by regressions.

The metallic frame bevel is visual. Its contact boundary is the solid room plane outside the aperture; a protruding bevel is not a separate high-detail collision mesh. Rotated envelopes and ghost envelopes can stop a cube slightly early. Stacks and supports work, but this is not an unbounded stability guarantee for arbitrary dense rigid-body piles.

## Picking, Holding, Throwing

The ray solver intersects room boundaries, oriented blocks/cubes, plates, moving doors, and active finite apertures analytically. A nearer ordinary solid wins. Each portal hit transforms the ray origin and direction and subtracts its traveled distance from the remaining metric budget.

Gameplay reach is four meters total and six traversals maximum. The public ray query also accepts bounded diagnostic distances. Budget exhaustion returns the aperture hit, not a selectable distant cube. Misses and out-of-range cubes remain misses.

Holding uses a bounded collision-resolved spring toward the current portal-aware path, with no direct position assignment. Held speed is capped at 14 m/s. The target is represented in the cube's current room and the path is recomputed each tick. If the body is occluded, no matching room segment remains, or it is out of reach, the hold drops safely. No body is deleted or cloned. Dropping preserves its current frame and velocity. Throwing uses the ray segment in the cube's room at 13 m/s, plus spin, before normal integration resumes.

## Mechanisms And Reset

A plate responds to actual supported cube/player overlap at its top face. A held object, a hovering object, or a teleported-away body cannot keep it pressed. Doors use **AND** across their wired plates. Their visible panel and collider rise together at normalized rate 2.5/s. An unwired door remains closed. On losing power, a door waits if its next closing position intersects a body, instead of crushing that body into a wall or ceiling; its logical signal is nevertheless inactive immediately.

A goal requires actual player overlap and active signals from every listed door. Completion is sticky until reset. Reset recreates all initial conditions from the authored document. It does not preserve displaced cubes, held state, crossings, open doors, or elapsed time.

## Recursive Rendering

Every active visible portal renders a destination room using the exact mapped camera. Offscreen projection keeps the main camera's aspect and field of view. An oblique near plane plus explicit world clipping rejects the space behind the destination plane; a one-millimeter plane bias prevents surface precision artifacts. The independent clipping checks include a conspicuous rejected behind-plane object and an otherwise identical visible positive control.

The portal plane samples the destination target in projected screen coordinates and writes ordinary depth. Source occluders and the solid frame therefore win the usual depth test. Child portal views are computed before their parent. All levels use live geometry, lighting, current cubes, and the current avatar; no prerecorded feeds or stale-frame feedback buffers are used.

Default recursion is three traversals; Settings can select four. At the limit, or when the per-frame budget of 20 portal targets is exhausted, a stable inset-grid field is rendered. The pool uses RGBA8 plus a conservative four-byte depth estimate. Target longest side <= 1024 pixels, depth scale `0.82^(depth-1)`, minimum dimensions 64 pixels, maximum 20 targets. The strict upper estimate for this pool is 160 MiB, excluding the main canvas and per-room shadow maps. The supplied three-pair scene is substantially smaller. Targets are disposed on resize and document rebuild; scene geometry, materials, generated textures, and shadow targets are released on edit/reload.

The root camera hides its own avatar. Recursive cameras see the live body. Material-compatible cube/avatar parts are merged into a few draw calls per visual representation; this batching does not combine physical entities or remove complementary clipping.

Lighting is local room illumination, direct spot shadows, emissive frames, and procedural surface detail. It is not recursive lighting transport. Sound is generated with Web Audio oscillators and HRTF panners; adjacent-room events can be placed through one portal mapping. There is no diffraction, occlusion acoustics, or full recursive acoustic simulation.

## Editable JSON Version 1

The JSON is the editable authored state, not a screenshot or runtime save game. Top-level fields:

```text
version: 1
id, name, description, lesson, accent
rooms:  [{ id, name, center: [x,y,z], size: [w,h,d], color }]
blocks: [{ id, room, position, size, rotation?: quaternion }]
portals:[{ id, room, position, quaternion, width, height,
           linkedTo, enabled, color }]
cubes:  [{ id, room, position, size: scalar, quaternion }]
plates: [{ id, room, position, size, doorIds: [doorId,...] }]
doors:  [{ id, room, position, size }]
goals:  [{ id, room, position, size, requires: [doorId,...] }]
spawn:  { room, position, yaw, pitch }
physics:{ gravity, fixedDt: 1/120, maxSubsteps, maxSpeed }
```

Every collection exists, even when empty. Colors are six-digit hex strings. Dimension and coordinate ranges, normalized rotations, unique IDs, all cross-references, supported physics settings, room fit, static spawn collisions, and portal placement are checked before a document replaces current work. Imports/local saves have a two-MiB limit. The validator permits up to 1000 entries per collection as a data guard, not as a performance promise; the measured interactive stress workload is 21 cubes and three pairs.

History stores whole validated snapshots. An authoring transaction either validates and commits in full, or leaves both the document and history unchanged. A drag previews validated snapshots but commits only once. Import and project replacement reset history only after successful validation. Playtest creates an isolated `World`, and returning restores the untouched authored snapshot.
