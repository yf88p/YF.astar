import { useId } from "react";
import type { TrackId } from "../shared/protocol";

export function TrackArt({
  track,
  className = "",
}: {
  track: TrackId;
  className?: string;
}) {
  const id = useId().replaceAll(":", "");
  const night = track === "harbor";
  return (
    <svg
      className={`track-art ${className}`}
      viewBox="0 0 600 300"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={
        night
          ? "Neon-lit harbor circuit at night"
          : "A winding road through red-rock canyons at sunset"
      }
    >
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor={night ? "#15233c" : "#7e8c98"} />
          <stop offset="1" stopColor={night ? "#517387" : "#f1c38f"} />
        </linearGradient>
        <linearGradient id={`${id}-road`} x2="0.4" y2="1">
          <stop stopColor={night ? "#617989" : "#656365"} />
          <stop offset="1" stopColor={night ? "#152b3c" : "#262e30"} />
        </linearGradient>
        <linearGradient id={`${id}-glow`}>
          <stop stopColor="#5ae0ec" stopOpacity="0" />
          <stop offset="0.5" stopColor="#5ae0ec" stopOpacity="0.45" />
          <stop offset="1" stopColor="#5ae0ec" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}-sky)`} d="M0 0h600v300H0z" />
      <circle
        cx={night ? 480 : 395}
        cy="74"
        r={night ? 21 : 34}
        fill={night ? "#dbe9e9" : "#ffdfaa"}
        opacity="0.8"
      />
      {night ? (
        <>
          <path
            d="M0 161V84h29v-24h28v69h17V95h55v59h24V74h15v-14h26v99h38V92h38v-39h29v101h28V98h27v64h49V88h49v74h71V97h38v59h49v144H0Z"
            fill="#273d50"
          />
          <path
            d="M0 191V121h73v45h87v-48h54v66h99v-42h68v42h55v-71h75v69h89v118H0Z"
            fill="#203641"
          />
          {Array.from({ length: 9 }, (_, i) => (
            <g key={i}>
              <path
                d={`M${25 + i * 67} 106v18m0 15v15m10-48v18m0 15v15`}
                stroke={i % 2 ? "#e4b2a0" : "#80b7cb"}
                strokeWidth="3"
                opacity="0.5"
              />
            </g>
          ))}
          <path
            d="M435 204V61h8v-8h98v6h-82v15h-15m0-13 64 47m-23-43v87m53-87v53"
            fill="none"
            stroke="#798b87"
            strokeWidth="4"
          />
          <path d="M0 207h600v93H0Z" fill="#18333d" />
          <path
            d="M0 237h160m215-12h225M397 262h180"
            stroke="#6ab3c4"
            opacity="0.2"
            strokeWidth="3"
          />
        </>
      ) : (
        <>
          <path
            d="M0 128 47 104 95 112 126 78 181 81 198 114 248 108 281 130 324 111 366 141 420 118 463 120 491 81 535 69 575 95 600 72v228H0Z"
            fill="#9d8177"
          />
          <path
            d="M0 92 55 74 82 48 147 43 167 128 214 150 242 175 289 189 357 160 400 147 445 66 507 60 529 89 566 107 600 85v215H0Z"
            fill="#a06e54"
          />
          <path
            d="m0 129 64-19 22-42 60-7 12 82 45 26-91-19-40 26-72 2zm401 40 51-82 48-11 14 40 59 20 27-23v61l-77 12-59-23Z"
            fill="#c18d69"
          />
          <path
            d="M0 186 93 173 206 199 272 201 350 185 438 184 525 201 600 185v115H0Z"
            fill="#ad8762"
          />
          <path
            d="M0 220 180 214 297 229 459 210 600 225v75H0Z"
            fill="#b99672"
          />
          <path
            d="M51 216v-39m0 18h-13v-15m13 11h14v-22M546 235v-59m0 27h-18v-22m18 14h15v-13"
            stroke="#4f614d"
            strokeWidth="5"
            fill="none"
          />
        </>
      )}
      <path
        d="M-70 300C135 205 410 254 420 207S270 188 324 161C238 180 257 209 335 213S146 211 37 245L-70 300Z"
        fill={night ? "#4c6571" : "#e5c49a"}
      />
      <path
        d="M-40 300C147 212 417 255 420 207S278 185 324 161C251 183 275 208 349 212S153 216 56 256L-40 300Z"
        fill={`url(#${id}-road)`}
      />
      <path
        d="M9 295C173 226 409 251 410 208S287 184 324 161"
        stroke={night ? "#6ae0e9" : "#eee0bd"}
        strokeWidth="2"
        strokeDasharray="18 15"
        fill="none"
      />
      {night && <path d="M80 263h280v37H0Z" fill={`url(#${id}-glow)`} />}
      <g transform="translate(210 258) rotate(-11)">
        <ellipse cx="0" cy="6" rx="29" ry="8" fill="#0f191b" opacity="0.65" />
        <path d="m-27 0 8-9 11-3h22l15 7 1 11-57-1Z" fill="#c5e773" />
        <path
          d="m-12-10 6-7h16l9 9Z"
          fill="#2a3e3d"
          stroke="#bed584"
          strokeWidth="2"
        />
        <path d="m-26 1 7 1m35 0 11 1" stroke="#fbf4cc" strokeWidth="3" />
        <path d="M-18 6v4m34-4v4" stroke="#152024" strokeWidth="8" />
      </g>
    </svg>
  );
}
