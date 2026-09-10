export interface Settings {
  name: string;
  volume: number;
  reducedMotion: boolean;
  camera: "chase" | "hood" | "aerial";
  bindings: Record<
    "accelerate" | "reverse" | "left" | "right" | "brake" | "drift" | "reset",
    string
  >;
}
export const DEFAULT_SETTINGS: Settings = {
  name: "Racer",
  volume: 0.35,
  reducedMotion: false,
  camera: "chase",
  bindings: {
    accelerate: "KeyW",
    reverse: "KeyS",
    left: "KeyA",
    right: "KeyD",
    brake: "Space",
    drift: "ShiftLeft",
    reset: "KeyR",
  },
};
export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem("apex-settings") || "{}");
    return {
      name:
        typeof saved.name === "string" &&
        /^[\p{L}\p{N} _.'-]{1,24}$/u.test(saved.name)
          ? saved.name
          : "Racer",
      volume:
        typeof saved.volume === "number"
          ? Math.max(0, Math.min(1, saved.volume))
          : DEFAULT_SETTINGS.volume,
      reducedMotion:
        typeof saved.reducedMotion === "boolean"
          ? saved.reducedMotion
          : matchMedia("(prefers-reduced-motion: reduce)").matches,
      camera: ["chase", "hood", "aerial"].includes(saved.camera)
        ? saved.camera
        : "chase",
      bindings: Object.fromEntries(
        Object.entries(DEFAULT_SETTINGS.bindings).map(([key, code]) => [
          key,
          typeof saved.bindings?.[key] === "string" &&
          /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right))$/.test(
            saved.bindings[key],
          )
            ? saved.bindings[key]
            : code,
        ]),
      ) as Settings["bindings"],
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
