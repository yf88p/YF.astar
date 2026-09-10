import { Vector3 } from "three";
import { LEVELS } from "./levels.js";

const FIXED_DT = 1 / 120;
const MAX_TICKS = 120 * 120;

function solutionSteps(index) {
  if (index === 1)
    return [
      {
        label: "Walk off the high balcony",
        target: [0, 0],
        falling: true,
        yaw: 0,
        pitch: -0.28,
      },
      { label: "Let gravity carry you through the floor portal", coast: true },
    ];
  const delivery = index === 0;
  const cube = delivery ? "delivery-cube" : "loop-cube";
  const plate = delivery ? "delivery-plate" : "loop-plate";
  return [
    {
      label: "Walk up to the cube",
      target: delivery ? [-0.8, 2.6] : [2, 3.1],
      face: true,
    },
    {
      label: "Look down and pick up the cube",
      action: "pickup",
      cube,
      yaw: 0,
      pitch: -0.6,
    },
    { label: "Lift the cube in front of you", seconds: 0.4, yaw: 0, pitch: 0 },
    {
      label: "Carry the cube to the north portal",
      target: delivery ? [-2.7, -4.8] : [0, -3.8],
    },
    {
      label: "Carry the cube through the portal",
      target: delivery ? [-2.7, -7.6] : [0, -6.6],
      roomAfter: delivery ? "annex" : "loop-relay",
    },
    {
      label: "Carry the cube over the pressure plate",
      target: delivery ? [22, 1.9] : [19, 0.1],
    },
    {
      label: "Lower the cube onto the plate",
      seconds: 0.6,
      yaw: 0,
      pitch: -0.5,
    },
    { label: "Release the cube", action: "drop", cube },
    { label: "Wait for the weight to open the door", plate },
    ...(delivery
      ? [
          {
            label: "Walk around the cube",
            target: [23.6, 1.9],
            face: true,
            pitch: 0,
          },
          {
            label: "Walk through the raised door",
            target: [23.6, -5.1],
            face: true,
          },
          { label: "Enter the goal", target: [22, -5.1], face: true },
        ]
      : [
          {
            label: "Return to the central aisle",
            target: [22, 0.1],
            face: true,
            pitch: 0,
          },
          {
            label: "Walk to the violet portal",
            target: [22, -3.8],
            face: true,
          },
          {
            label: "Cross into the gold gallery",
            target: [22, -6.6],
            roomAfter: "loop-vault",
            yaw: 0,
            pitch: 0,
          },
          { label: "Walk to the side door", target: [44, 0], face: true },
          { label: "Enter the open side vault", target: [47.6, 0], face: true },
        ]),
  ];
}

/** Public-input autopilot. Owns physics stepping; do not also advance its world. */
export class SolutionReplay {
  constructor(world, index) {
    this.world = world;
    this.done = false;
    this.error = null;
    this.label = "Preparing solution";
    this.stepIndex = 0;
    this.elapsed = 0;
    this._ticks = 0;
    this._accumulator = 0;
    this._stageTicks = 0;
    this._steps = [];
    if (
      !Number.isInteger(index) ||
      !LEVELS[index] ||
      world.doc.id !== LEVELS[index].id
    ) {
      this._finish("No input solution is available for this level.");
      return;
    }
    this._steps = solutionSteps(index);
    this.label = this._steps[0].label;
    world.setInput({ forward: 0, strafe: 0, jump: false });
    if (world.completed) this._finish();
  }

  _finish(error = null) {
    this.done = true;
    this.error = error;
    this.label = error || "Solution complete";
    this.world.setInput({ forward: 0, strafe: 0, jump: false });
  }

  update(dt) {
    if (this.done) return;
    if (this.world.completed) {
      this._finish();
      return;
    }
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Preserve supplied time across render rates, but bound total simulation work.
    this._accumulator += Math.min(dt, MAX_TICKS * FIXED_DT);
    while (!this.done && this._accumulator + 1e-10 >= FIXED_DT) {
      this._accumulator = Math.max(0, this._accumulator - FIXED_DT);
      this._tick();
    }
  }

  _tick() {
    const world = this.world,
      stage = this._steps[this.stepIndex];
    if (!stage || this._ticks >= MAX_TICKS || this._stageTicks >= 15 * 120) {
      this._finish(`Solution stalled: ${stage?.label || "goal not reached"}.`);
      return;
    }
    const player = world.player;
    let reached = false;
    let forward = 0,
      strafe = 0;
    if (this._stageTicks === 0 && stage.yaw !== undefined)
      world.look(stage.yaw, stage.pitch ?? 0);
    if (stage.target) {
      const dx = stage.target[0] - player.position.x,
        dz = stage.target[1] - player.position.z;
      const distance = Math.hypot(dx, dz);
      reached = stage.roomAfter
        ? player.room === stage.roomAfter
        : distance < 0.025 &&
          Math.hypot(player.velocity.x, player.velocity.z) < 0.12;
      if (stage.falling)
        reached =
          !player.grounded &&
          Math.abs(player.position.z) < 0.04 &&
          Math.abs(player.velocity.z) < 0.08;
      if (!reached) {
        if (stage.face) world.look(Math.atan2(-dx, -dz), stage.pitch ?? 0);
        // Resolve desired world velocity in the transported view frame. Carrying
        // uses strafing so turns do not swing the held cube into portal edges.
        const direction = new Vector3(0, 0, -1).applyQuaternion(
          player.quaternion,
        );
        direction.y = 0;
        if (direction.lengthSq() < 1e-6)
          direction.set(
            -Math.sin(world.input.yaw),
            0,
            -Math.cos(world.input.yaw),
          );
        direction.normalize();
        const speed = Math.min(3, distance * (stage.falling ? 3 : 4));
        const vx = distance ? (dx / distance) * speed : 0,
          vz = distance ? (dz / distance) * speed : 0;
        forward = (vx * direction.x + vz * direction.z) / 5.8;
        strafe = (-vx * direction.z + vz * direction.x) / 5.8;
      }
    } else if (stage.action) {
      if (stage.action === "pickup" && world.held) {
        this._finish(
          "Cannot pick up the solution cube while already holding an object.",
        );
        return;
      }
      if (stage.action === "drop" && world.held?.id !== stage.cube) {
        this._finish("The solution cube was lost before reaching the plate.");
        return;
      }
      if (world.interact() !== stage.cube) {
        this._finish(`Could not ${stage.action} the solution cube.`);
        return;
      }
      reached = true;
    } else if (stage.seconds) {
      reached = this._stageTicks >= Math.round(stage.seconds * 120);
    } else if (stage.plate) {
      reached =
        world.plates.get(stage.plate).active &&
        [...world.doors.values()].every((door) => door.open >= 0.995);
    }
    world.setInput({ forward, strafe, jump: false });
    world.step(FIXED_DT);
    this._ticks++;
    this.elapsed = this._ticks * FIXED_DT;
    this._stageTicks++;
    if (world.completed) this._finish();
    else if (reached) {
      this.stepIndex++;
      this._stageTicks = 0;
      this.label = this._steps[this.stepIndex]?.label || "Checking goal";
    }
  }
}

/** Run on a fresh/reset world, returning a summary without resetting it implicitly. */
export function runSolution(world, index, maxSeconds = 120) {
  const replay = new SolutionReplay(world, index);
  const ticks = Number.isFinite(maxSeconds)
    ? Math.max(0, Math.min(MAX_TICKS, Math.floor(maxSeconds * 120)))
    : 0;
  for (let tick = 0; tick < ticks && !replay.done; tick++)
    replay.update(FIXED_DT);
  if (!replay.done) replay._finish(`Solution exceeded ${maxSeconds} seconds.`);
  return {
    done: replay.done,
    completed: world.completed,
    error: replay.error,
    label: replay.label,
    stepIndex: replay.stepIndex,
    elapsed: replay.elapsed,
    crossings: world.crossings,
  };
}
