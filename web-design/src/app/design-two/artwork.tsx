import { useId } from "react";
import styles from "./page.module.css";

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={diagonal ? "M5 19 19 5M5 5h14v14" : "M3 12h17m-7-7 7 7-7 7"}
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function Asterisk({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <rect
          key={i}
          x="43"
          y="2"
          width="14"
          height="96"
          fill="currentColor"
          transform={`rotate(${i * 30} 50 50)`}
        />
      ))}
    </svg>
  );
}

export function HeroArtwork() {
  // Cross-sections of a trefoil, depth-sorted to create a sculptural ribbed tube.
  const point = (t: number) => [
    Math.sin(t) + 2 * Math.sin(2 * t),
    Math.cos(t) - 2 * Math.cos(2 * t),
    -Math.sin(3 * t),
  ];
  const rotate = ([x, y, z]: number[]) => {
    const a = -0.35;
    const b = 0.62;
    const yy = y * Math.cos(b) - z * Math.sin(b);
    const zz = y * Math.sin(b) + z * Math.cos(b);
    return [
      x * Math.cos(a) - yy * Math.sin(a),
      x * Math.sin(a) + yy * Math.cos(a),
      zz,
    ];
  };
  const rings = Array.from({ length: 190 }, (_, i) => {
    const t = (i / 190) * Math.PI * 2;
    const center = point(t);
    const next = point(t + 0.001);
    const tangent = next.map((v, j) => v - center[j]);
    const length = Math.hypot(...tangent);
    const [tx, ty, tz] = tangent.map((v) => v / length);
    const normalLength = Math.hypot(tx, ty);
    const normal = [-ty / normalLength, tx / normalLength, 0];
    const binormal = [
      -tz * normal[1],
      tz * normal[0],
      tx * normal[1] - ty * normal[0],
    ];
    const points = Array.from({ length: 30 }, (_, j) => {
      const theta = (j / 30) * Math.PI * 2;
      const vertex = center.map(
        (v, k) =>
          v +
          0.61 * (normal[k] * Math.cos(theta) + binormal[k] * Math.sin(theta)),
      );
      const [x, y, z] = rotate(vertex);
      const perspective = 1 + z * 0.035;
      return `${(280 + x * 77 * perspective).toFixed(2)},${(281 + y * 77 * perspective).toFixed(2)}`;
    });
    return { depth: rotate(center)[2], path: `M${points.join("L")}Z` };
  }).sort((a, b) => a.depth - b.depth);

  return (
    <svg
      className={styles.sculpture}
      viewBox="0 0 560 590"
      role="img"
      aria-label="An impossible black ribbed knot, looping and twisting against acid yellow"
    >
      <defs>
        <radialGradient id="offscript-shadow">
          <stop stopColor="#17190d" stopOpacity=".25" />
          <stop offset="1" stopColor="#17190d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx="283"
        cy="544"
        rx="184"
        ry="25"
        fill="url(#offscript-shadow)"
      />
      <g className={styles.knot}>
        {rings.map((ring, i) => (
          <path
            key={i}
            d={ring.path}
            fill="#14160f"
            stroke="#b8c33c"
            strokeWidth="0.7"
          />
        ))}
      </g>
    </svg>
  );
}

export function ProjectArtwork({ kind }: { kind: string }) {
  const id = useId();

  if (kind === "other-side") {
    return (
      <svg viewBox="0 0 640 530" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-can`} x1="0" x2="1">
            <stop stopColor="#b7c629" />
            <stop offset=".3" stopColor="#f5ff77" />
            <stop offset=".6" stopColor="#e7f548" />
            <stop offset="1" stopColor="#a9b823" />
          </linearGradient>
          <linearGradient id={`${id}-metal`} x1="0" x2="0" y2="1">
            <stop stopColor="#e4e5d1" />
            <stop offset="1" stopColor="#797c6e" />
          </linearGradient>
        </defs>
        <path fill="#2945e6" d="M0 0h640v530H0z" />
        <g fill="none" stroke="#6a7dff" strokeWidth="1">
          <ellipse
            cx="310"
            cy="275"
            rx="280"
            ry="120"
            transform="rotate(-30 310 275)"
          />
          <ellipse
            cx="310"
            cy="275"
            rx="320"
            ry="159"
            transform="rotate(-30 310 275)"
          />
          <ellipse
            cx="310"
            cy="275"
            rx="357"
            ry="197"
            transform="rotate(-30 310 275)"
          />
        </g>
        <text
          x="30"
          y="42"
          fill="#edf1c9"
          fontSize="10"
          letterSpacing="2"
          fontFamily="monospace"
        >
          A DIFFERENT KIND OF ENERGY.
        </text>
        <text
          x="612"
          y="496"
          textAnchor="end"
          fill="#edf1c9"
          fontSize="10"
          letterSpacing="2"
          fontFamily="monospace"
        >
          GO GET A LITTLE LOST.
        </text>
        <g transform="translate(315 267) rotate(17)">
          <ellipse
            cx="16"
            cy="192"
            rx="125"
            ry="25"
            fill="#172cac"
            opacity=".6"
          />
          <path
            d="M-81-150Q-81-164-67-175H67Q81-164 81-150V160Q81 180 0 180T-81 160Z"
            fill={`url(#${id}-can)`}
          />
          <ellipse cy="-175" rx="67" ry="12" fill={`url(#${id}-metal)`} />
          <ellipse cy="-176" rx="57" ry="7" fill="#b6b9a0" stroke="#727665" />
          <ellipse cx="14" cy="-177" rx="18" ry="4" fill="#535848" />
          <path d="M-8-180h22v7H-8z" fill="#daddc5" />
          <text
            x="0"
            y="-119"
            textAnchor="middle"
            fill="#243dc4"
            fontSize="10"
            letterSpacing="2"
            fontFamily="monospace"
          >
            NATURALLY WIRED
          </text>
          <g
            fill="#243dc4"
            fontFamily="Arial, sans-serif"
            fontWeight="900"
            fontSize="55"
            letterSpacing="-4"
            textAnchor="middle"
          >
            <text x="-2" y="-37">
              other
            </text>
            <text x="-2" y="12">
              side.
            </text>
          </g>
          <g
            transform="translate(0 69)"
            fill="none"
            stroke="#243dc4"
            strokeWidth="2"
          >
            <circle r="27" />
            <ellipse rx="12" ry="27" />
            <path d="M-27 0h54M-23-13h46M-23 13h46" />
          </g>
          <text
            x="0"
            y="128"
            textAnchor="middle"
            fill="#243dc4"
            fontSize="9"
            letterSpacing="1.5"
            fontFamily="monospace"
          >
            YUZU + GOOD INTENTIONS
          </text>
          <text
            x="0"
            y="149"
            textAnchor="middle"
            fill="#243dc4"
            fontSize="8"
            fontFamily="monospace"
          >
            250 ml / A BRIGHTER STATE OF MIND
          </text>
          <path
            d="M-69 164Q0 182 69 164"
            fill="none"
            stroke="#eff778"
            strokeWidth="3"
          />
        </g>
        <g transform="translate(509 117) rotate(12)">
          <path
            d="m0-53 12 21 22-16 2 26 26-2-16 22 21 12-21 12 16 22-26-2-2 26-22-16-12 21-12-21-22 16-2-26-26 2 16-22-21-12 21-12-16-22 26 2 2-26 22 16Z"
            fill="#e7f548"
          />
          <text
            y="-5"
            textAnchor="middle"
            fontSize="11"
            fontWeight="900"
            fill="#243dc4"
          >
            GOOD
          </text>
          <text
            y="9"
            textAnchor="middle"
            fontSize="11"
            fontWeight="900"
            fill="#243dc4"
          >
            DIFFERENT.
          </text>
        </g>
      </svg>
    );
  }

  if (kind === "forme") {
    return (
      <svg viewBox="0 0 640 530" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-forme`} x2="1" y2="1">
            <stop stopColor="#cf563b" />
            <stop offset="1" stopColor="#9c3025" />
          </linearGradient>
        </defs>
        <path fill="#d8d3c7" d="M0 0h640v530H0z" />
        <path
          d="M374 530V191a147 147 0 0 0-294 0v339Z"
          fill={`url(#${id}-forme)`}
        />
        <path d="M147 530V200a78 78 0 0 1 156 0v330" fill="#2b2925" />
        <path d="m303 530 88-55V204L303 190Z" fill="#aa9d87" />
        <path d="M303 530H147L0 468v62Z" fill="#bcb29f" />
        <path d="M391 475 640 530H303Z" fill="#eee7d8" />
        <g fill="none" stroke="#e9e2d3" opacity=".5">
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d={`M${157 + i * 12} 530V${208 + i * 1.8}`} />
          ))}
        </g>
        <text
          x="611"
          y="55"
          textAnchor="end"
          fill="#292924"
          fontSize="10"
          letterSpacing="2"
          fontFamily="monospace"
        >
          SPACES TO FEEL SOMETHING.
        </text>
        <text
          x="31"
          y="454"
          fill="#f5f0e5"
          fontSize="164"
          letterSpacing="-10"
          fontFamily="Georgia, serif"
        >
          forme
        </text>
        <path d="M34 477h568" stroke="#f5f0e5" />
        <text
          x="34"
          y="500"
          fill="#fff8ec"
          fontSize="10"
          letterSpacing="2"
          fontFamily="monospace"
        >
          ARCHITECTURE. WITH FEELING.
        </text>
        <text
          x="602"
          y="500"
          textAnchor="end"
          fill="#292924"
          fontSize="10"
          fontFamily="monospace"
        >
          EST. 2025
        </text>
      </svg>
    );
  }

  if (kind === "after-hours") {
    return (
      <svg viewBox="0 0 640 530" aria-hidden="true">
        <path fill="#171815" d="M0 0h640v530H0z" />
        <g transform="translate(320 263)">
          {Array.from({ length: 32 }, (_, i) => (
            <path
              key={i}
              d="M0 0Q70-150 270-240L310-210Q115-98 0 0"
              fill={i % 2 === 0 ? "#e7f548" : "#d7e53d"}
              transform={`rotate(${i * 11.25})`}
            />
          ))}
        </g>
        <g transform="translate(320 265) rotate(-9)">
          <path d="M-177-126h354v252h-354z" fill="#2945e6" />
          <g
            fill="#f0f0df"
            fontFamily="Arial, sans-serif"
            fontWeight="900"
            fontSize="69"
            letterSpacing="-5"
            textAnchor="middle"
          >
            <text y="-30">AFTER</text>
            <text y="34">HOURS</text>
            <text y="98" fill="none" stroke="#f0f0df" strokeWidth="1">
              FOREVER
            </text>
          </g>
          <text
            y="-102"
            textAnchor="middle"
            fill="#e7f548"
            fontSize="9"
            letterSpacing="3"
            fontFamily="monospace"
          >
            A FESTIVAL FOR THE REST OF US
          </text>
        </g>
        <text
          x="25"
          y="506"
          fill="#fff"
          fontSize="10"
          letterSpacing="2"
          fontFamily="monospace"
        >
          TURN UP. TUNE OUT.
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 640 530" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-box`} x2="1">
          <stop stopColor="#e7b5cc" />
          <stop offset="1" stopColor="#f8d8e7" />
        </linearGradient>
      </defs>
      <path fill="#697957" d="M0 0h640v530H0z" />
      <circle cx="319" cy="259" r="208" fill="none" stroke="#9aa88a" />
      <circle cx="319" cy="259" r="228" fill="none" stroke="#9aa88a" />
      <text
        x="28"
        y="39"
        fill="#eff0de"
        fontSize="10"
        letterSpacing="2"
        fontFamily="monospace"
      >
        SMALL RITUALS. BIG FEELINGS.
      </text>
      <g transform="translate(318 270) rotate(-12)">
        <path d="M-106-153 71-171 113-137-66-120Z" fill="#ffe5ef" />
        <path d="m71-171 42 34v308l-42-33Z" fill="#c68da8" />
        <path d="M-106-153 71-171v309l-177 19Z" fill={`url(#${id}-box)`} />
        <g transform="skewY(-6)" fill="#3b5034" textAnchor="middle">
          <text
            x="-17"
            y="-95"
            fontSize="11"
            letterSpacing="3"
            fontFamily="monospace"
          >
            DAILY PRACTICE
          </text>
          <text
            x="-17"
            y="-17"
            fontSize="50"
            letterSpacing="-3"
            fontFamily="Georgia, serif"
          >
            good
          </text>
          <text
            x="-17"
            y="30"
            fontSize="50"
            letterSpacing="-3"
            fontFamily="Georgia, serif"
          >
            things.
          </text>
          <path
            d="M-20 65c-35-37-58 8 0 36 58-28 35-73 0-36"
            fill="none"
            stroke="#3b5034"
            strokeWidth="2"
          />
          <text
            x="-17"
            y="131"
            fontSize="8"
            letterSpacing="1.5"
            fontFamily="monospace"
          >
            A LITTLE MORE YOU / 30 CAPSULES
          </text>
        </g>
      </g>
      <text
        x="609"
        y="498"
        textAnchor="end"
        fill="#eff0de"
        fontSize="10"
        letterSpacing="2"
        fontFamily="monospace"
      >
        FEEL-GOOD, BY NATURE.
      </text>
    </svg>
  );
}
