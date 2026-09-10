export interface Vec2 {
  x: number;
  y: number;
}

export interface BodySpec {
  id: string;
  label: string;
  shape: "circle" | "box";
  position: Vec2;
  rotation?: number;
  velocity?: Vec2;
  angularVelocity?: number;
  fixed?: boolean;
  radius?: number;
  width?: number;
  height?: number;
  density: number;
  restitution: number;
  friction: number;
  color: string;
  charge?: number;
  trail?: boolean;
}

export interface JointSpec {
  id: string;
  type: "rope" | "spring" | "revolute";
  bodyA: string;
  bodyB: string;
  anchorA: Vec2;
  anchorB: Vec2;
  length: number;
  stiffness?: number;
  damping?: number;
}

export interface Environment {
  gravity: Vec2;
  airDrag: number;
  wind: Vec2;
  nbodyGravity: number;
  electrostaticConstant: number;
  magneticField: number;
  fluid: { level: number; density: number; drag: number } | null;
}

export interface SceneConfig {
  id: string;
  name: string;
  description: string;
  bodies: BodySpec[];
  joints: JointSpec[];
  environment: Environment;
  camera: { center: Vec2; scale: number };
}

export interface BodySnapshot extends BodySpec {
  rotation: number;
  velocity: Vec2;
  angularVelocity: number;
  mass: number;
  sleeping: boolean;
}

export interface Metrics {
  time: number;
  bodies: number;
  dynamicBodies: number;
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  momentum: Vec2;
  maxSpeed: number;
}

export interface DisplayOptions {
  grid: boolean;
  trails: boolean;
  vectors: boolean;
  labels: boolean;
}

export type Tool = "select" | "hand" | "circle" | "box";
