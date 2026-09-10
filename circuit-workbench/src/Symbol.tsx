import type { ComponentType } from "./types";

export function Symbol({
  type,
  closed = false,
  rotation = 0,
}: {
  type: ComponentType;
  closed?: boolean;
  rotation?: number;
}) {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {type !== "ground" && <path d="M-40 0H-24 M24 0H40" />}
      {type === "resistor" && (
        <path d="M-24 0l4 -9 8 18 8 -18 8 18 8 -18 8 18 4 -9" />
      )}
      {type === "capacitor" && (
        <>
          <path d="M-24 0H-5 M5 0H24 M-5 -17V17 M5 -17V17" />
        </>
      )}
      {type === "inductor" && (
        <path d="M-24 0c0 -18 12 -18 12 0c0 -18 12 -18 12 0c0 -18 12 -18 12 0c0 -18 12 -18 12 0" />
      )}
      {type === "diode" && (
        <>
          <path d="M-24 0H-14 M-14 -15L14 0 -14 15Z M14 -16V16 M14 0H24" />
          <text x="-19" y="27" className="symbol-small">
            A
          </text>
          <text x="13" y="27" className="symbol-small">
            K
          </text>
        </>
      )}
      {(type === "voltage" || type === "current") && (
        <>
          <circle r="24" />
          {type === "voltage" ? (
            <>
              <g transform={`translate(-10 0) rotate(${-rotation})`}>
                <path d="M-5 0H5 M0 -5V5" />
              </g>
              <g transform={`translate(12 0) rotate(${-rotation})`}>
                <path d="M-5 0H5" />
              </g>
            </>
          ) : (
            <path d="M-14 0H14 M7 -6L14 0 7 6" />
          )}
        </>
      )}
      {type === "switch" && (
        <>
          <circle cx="-20" r="3" />
          <circle cx="20" r="3" />
          <path d={`M-17 0L17 ${closed ? 0 : -17} M-24 0H-23 M23 0H24`} />
        </>
      )}
      {type === "ground" && <path d="M0 0V13 M-17 13H17 M-11 19H11 M-5 25H5" />}
    </g>
  );
}
