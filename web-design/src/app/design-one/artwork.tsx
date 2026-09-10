import { useId } from "react";

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h16m-6-6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function Chair({ id, color = "clay" }: { id: string; color?: string }) {
  const pale = color === "oat";
  const dark = color === "moss";
  const main = pale ? "#d7c9af" : dark ? "#737b60" : "#b9704d";
  const light = pale ? "#eee5d2" : dark ? "#929a7b" : "#d2956d";
  const shade = pale ? "#b3a289" : dark ? "#444e3d" : "#8a4a33";
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-wood`} x1="0" x2="1" y1="0" y2=".4">
          <stop stopColor="#3e2c21" />
          <stop offset=".35" stopColor="#846046" />
          <stop offset=".57" stopColor="#a17c57" />
          <stop offset="1" stopColor="#3d2a20" />
        </linearGradient>
        <linearGradient id={`${id}-back`} x1=".1" x2=".9" y1="0" y2="1">
          <stop stopColor={light} />
          <stop offset=".5" stopColor={main} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <linearGradient id={`${id}-seat`} x1="0" x2=".3" y1="0" y2="1">
          <stop stopColor={light} />
          <stop offset=".48" stopColor={main} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <filter
          id={`${id}-shadow`}
          x="-40%"
          y="-100%"
          width="180%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="11" />
        </filter>
      </defs>
      <ellipse
        cx="300"
        cy="493"
        rx="195"
        ry="25"
        fill="#33271c"
        opacity=".17"
        filter={`url(#${id}-shadow)`}
      />
      <path
        d="m185 334-20 143q4 9 16 4l43-132zm184-7 58 143q8 10 16 0l-26-153z"
        fill={`url(#${id}-wood)`}
      />
      <path
        d="m151 376-32 119q3 10 15 4l56-111zm222 6 34 115q7 11 17 0l-13-132z"
        fill={`url(#${id}-wood)`}
      />
      <path
        d="M143 279q-15-60 14-114 8-19 29-23 101-22 188-3 30 6 35 37l28 165-54 36-207-9z"
        fill={`url(#${id}-wood)`}
      />
      <path
        d="M168 159q98-29 202-8 26 5 30 33l21 130q2 19-21 26l-200 18q-23-4-27-27l-27-127q-5-32 22-45"
        fill={`url(#${id}-back)`}
      />
      <path
        d="M171 166q104-28 197-8 20 5 23 26"
        fill="none"
        stroke={light}
        strokeWidth="2"
        opacity=".55"
      />
      <path
        d="m171 199 27 113q5 20 23 22l162-12"
        fill="none"
        stroke={shade}
        strokeWidth="1.4"
        opacity=".25"
      />
      <path
        d="M130 348q123-44 276-33l46 62q3 16-21 24l-211 42q-20 3-38-7l-70-46q-10-21 18-42"
        fill={`url(#${id}-wood)`}
      />
      <path
        d="M142 331q78-34 215-27 24 1 46 15l42 41q17 24-13 38l-215 37q-23 2-40-9l-53-38q-26-24 18-57"
        fill={`url(#${id}-seat)`}
      />
      <path
        d="M139 347q87-39 217-28 26 3 41 13l33 30q15 17-7 21l-215 35q-15 0-30-7l-41-31q-23-14 2-33"
        fill={`url(#${id}-back)`}
      />
      <path
        d="M129 383q12 10 44 29 22 12 43 10l210-37"
        fill="none"
        stroke={light}
        opacity=".7"
      />
      <path
        d="M131 333q-27-13-23-42l20-66q8-17 26-8l41 30q12 9 11 21l-10 33-24-1 8-29-32-18-11 42 29 17z"
        fill={`url(#${id}-wood)`}
      />
      <path
        d="m110 283 21-60q6-11 19-6l43 28"
        fill="none"
        stroke="#b38b63"
        strokeWidth="2"
        opacity=".6"
      />
      <path
        d="m354 284 14-48q5-20 24-19l51 10q18 3 21 20l14 99q2 24-26 25l-49-9 5-29 36 5-14-79-37-7-14 45z"
        fill={`url(#${id}-wood)`}
      />
      <path
        d="m372 235 68 11 17 105"
        fill="none"
        stroke="#b38b63"
        strokeWidth="2"
        opacity=".65"
      />
    </g>
  );
}

export function ObjectArt({
  kind = "chair",
  color = "clay",
}: {
  kind?: "chair" | "lamp" | "table" | "vase";
  color?: string;
}) {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      viewBox="0 0 600 560"
      fill="none"
      role="img"
      aria-label={
        {
          chair: `Sculptural walnut lounge chair with ${color} upholstery`,
          lamp: "Domed sculptural lamp in warm ivory",
          table: "Solid oak side table with a rounded pebble top",
          vase: "Hand-thrown terracotta vase with an olive branch",
        }[kind]
      }
    >
      <defs>
        <linearGradient id={`${id}-stone`} x1=".1" y1=".1" x2="1" y2=".6">
          <stop stopColor="#e1dac8" />
          <stop offset=".45" stopColor="#f5efdd" />
          <stop offset="1" stopColor="#aea28a" />
        </linearGradient>
        <linearGradient id={`${id}-oak`} x1="0" x2="1">
          <stop stopColor="#877150" />
          <stop offset=".35" stopColor="#b09a74" />
          <stop offset=".65" stopColor="#c7b18a" />
          <stop offset="1" stopColor="#7f6a4e" />
        </linearGradient>
        <radialGradient id={`${id}-dome`} cx=".3" cy=".25" r=".8">
          <stop stopColor="#fffbed" />
          <stop offset=".55" stopColor="#e6ddc7" />
          <stop offset="1" stopColor="#b2a68c" />
        </radialGradient>
        <linearGradient id={`${id}-terra`} x1="0" x2="1">
          <stop stopColor="#91563d" />
          <stop offset=".35" stopColor="#c78965" />
          <stop offset=".65" stopColor="#cc9673" />
          <stop offset="1" stopColor="#9f654c" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-50%" y="-100%" width="200%" height="300%">
          <feGaussianBlur stdDeviation="13" />
        </filter>
      </defs>
      {kind === "chair" && <Chair id={id} color={color} />}
      {kind === "lamp" && (
        <g>
          <ellipse
            cx="319"
            cy="466"
            rx="132"
            ry="17"
            fill="#544839"
            opacity=".14"
            filter={`url(#${id}-soft)`}
          />
          <path
            d="M286 302h36l28 142q1 21-42 22t-44-17z"
            fill={`url(#${id}-stone)`}
          />
          <ellipse cx="306" cy="457" rx="41" ry="8" fill="#c1b69e" />
          <path
            d="M131 297c3-221 336-221 339 0q-157 47-339 0"
            fill={`url(#${id}-dome)`}
          />
          <ellipse cx="301" cy="297" rx="169" ry="27" fill="#ad9e80" />
          <ellipse cx="301" cy="294" rx="153" ry="20" fill="#f6e8bf" />
          <ellipse cx="303" cy="294" rx="51" ry="12" fill="#fff8dc" />
          <path
            d="M207 161q-40 38-49 102"
            stroke="#fffced"
            opacity=".6"
            strokeWidth="2"
          />
          <path d="M334 454q81-3 88 21t61 5" stroke="#8f806b" strokeWidth="2" />
        </g>
      )}
      {kind === "table" && (
        <g>
          <ellipse
            cx="315"
            cy="465"
            rx="176"
            ry="25"
            fill="#544839"
            opacity=".16"
            filter={`url(#${id}-soft)`}
          />
          <path
            d="m209 282-7 153q0 16 29 16t31-16l21-153zm138-5 13 155q3 17 29 17t27-17l-14-155z"
            fill={`url(#${id}-oak)`}
          />
          <path
            d="m278 306 1 155q0 20 33 20t33-20l-9-166z"
            fill={`url(#${id}-oak)`}
          />
          <path
            d="M119 254q5-52 85-84 75-28 179 1 101 28 104 88v18q-20 59-167 66-175 5-201-69z"
            fill="#8e7857"
          />
          <path
            d="M119 251q5-54 85-85 75-28 179 1 104 28 104 90-9 56-166 69-180 4-202-75"
            fill={`url(#${id}-oak)`}
          />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path
              key={i}
              d={`M${149 + i * 14} ${243 - i * 7}q92 ${-66 + i * 6} ${285 - i * 25} 0q-40 ${78 - i * 7}-${225 - i * 26} ${19 - i}`}
              stroke="#6f583a"
              strokeWidth="1"
              opacity=".15"
            />
          ))}
        </g>
      )}
      {kind === "vase" && (
        <g>
          <ellipse
            cx="302"
            cy="474"
            rx="113"
            ry="17"
            fill="#544839"
            opacity=".14"
            filter={`url(#${id}-soft)`}
          />
          <path
            d="M263 273q-5-64 31-121t12-108m-12 153q-53-55-95-61m93 12q39-60 92-68m-81 41q-29-48-58-58"
            stroke="#655f42"
            strokeWidth="3"
          />
          {[
            [286, 168, -35],
            [256, 147, -65],
            [215, 134, -60],
            [317, 108, 45],
            [354, 87, 55],
            [299, 73, -25],
            [274, 88, -45],
            [307, 44, 20],
          ].map(([x, y, r], i) => (
            <ellipse
              key={i}
              cx={x}
              cy={y}
              rx="9"
              ry="25"
              fill={i % 2 ? "#737961" : "#92957c"}
              transform={`rotate(${r} ${x} ${y})`}
            />
          ))}
          <path
            d="M253 252h96l-10 49q1 18 18 37 47 64 12 114-19 25-65 25-56 0-77-27-29-51 10-112 17-27 23-38z"
            fill={`url(#${id}-terra)`}
          />
          <ellipse cx="301" cy="251" rx="48" ry="11" fill="#b07857" />
          <ellipse cx="301" cy="251" rx="36" ry="6" fill="#6f4a35" />
          {[342, 352, 362, 372, 382, 392, 402, 412, 422, 432].map((y) => (
            <path
              key={y}
              d={`M235 ${y}q68 17 133 0`}
              stroke="#f0c7a4"
              opacity=".1"
            />
          ))}
        </g>
      )}
    </svg>
  );
}

export function InteriorScene({ closeup = false }: { closeup?: boolean }) {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      viewBox={closeup ? "40 140 560 640" : "0 0 740 790"}
      fill="none"
      role="img"
      aria-label="Sunlit architectural interior with a terracotta lounge chair, travertine side table, and olive branches"
    >
      <defs>
        <linearGradient id={`${id}-wall`} x1="0" x2="1" y1="0" y2=".6">
          <stop stopColor="#c7bbaa" />
          <stop offset=".48" stopColor="#e3d9c8" />
          <stop offset="1" stopColor="#f2eadc" />
        </linearGradient>
        <linearGradient id={`${id}-arch`} x1="0" x2="1">
          <stop stopColor="#978b77" />
          <stop offset=".11" stopColor="#c1b39e" />
          <stop offset="1" stopColor="#ded3bf" />
        </linearGradient>
        <linearGradient id={`${id}-floor`} x1="0" x2=".5" y1="0" y2="1">
          <stop stopColor="#c5b49b" />
          <stop offset="1" stopColor="#dfd3bb" />
        </linearGradient>
        <linearGradient id={`${id}-plinth`} x1="0" x2="1">
          <stop stopColor="#d8c8ac" />
          <stop offset=".6" stopColor="#ecdfc7" />
          <stop offset="1" stopColor="#c4b391" />
        </linearGradient>
        <linearGradient id={`${id}-sun`} x1="0" x2="1">
          <stop stopColor="#fff6db" stopOpacity="0" />
          <stop offset="1" stopColor="#fff6db" stopOpacity=".55" />
        </linearGradient>
        <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={`${id}-grain`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".72"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope=".07" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" mode="multiply" />
        </filter>
      </defs>
      <path fill={`url(#${id}-wall)`} d="M0 0h740v790H0z" />
      <path d="M63 605V239a195 195 0 0 1 390 0v366" fill={`url(#${id}-arch)`} />
      <path
        d="M69 605V239a188 188 0 0 1 376 0v366"
        stroke="#f5ead6"
        strokeOpacity=".26"
        strokeWidth="3"
      />
      <path d="M458 0h6v610h-6" fill="#f6ebd8" opacity=".17" />
      <path d="M0 592 740 574v216H0" fill={`url(#${id}-floor)`} />
      <path
        d="m0 639 740-6M0 731l740-24M186 588 103 790m459-210 80 210"
        stroke="#9f8e7430"
      />
      <path
        d="M740 18 448 591l-64 4L707 0zm0 92L500 590l-30 2L740 55zm0 99L556 588l-27 1L740 159z"
        fill="#fff3d5"
        opacity=".32"
      />
      <path
        d="m449 592 291 73v55l-356-125zm51-2 240 56v-17l-210-40z"
        fill="#fff3d5"
        opacity=".32"
      />
      <path
        d="M520 609q107-19 176 33l44 50v20l-171-46z"
        fill="#78664b"
        opacity=".11"
        filter={`url(#${id}-blur)`}
      />
      <path d="M536 450h125v182H536z" fill={`url(#${id}-plinth)`} />
      <path d="m536 450 36-19h121l-32 19z" fill="#f1e3c8" />
      <path d="m661 450 32-19v181l-32 20z" fill="#b4a17f" />
      {[465, 491, 514, 552, 574, 596, 620].map((y, i) => (
        <path
          key={y}
          d={`m539 ${y}q${30 + i * 4} -6 119 ${i % 2 ? 3 : -2}`}
          stroke="#928164"
          opacity=".13"
        />
      ))}
      <g transform="translate(460 252) scale(.47)">
        <path
          d="M263 330q-4-97 26-151t11-150m-13 164q-45-49-92-57m99 15q47-63 90-71"
          stroke="#616248"
          strokeWidth="3.5"
        />
        {[
          [279, 197, -35],
          [250, 151, -65],
          [211, 134, -60],
          [323, 113, 45],
          [359, 87, 55],
          [299, 73, -25],
          [285, 125, -45],
          [307, 44, 20],
        ].map(([x, y, r], i) => (
          <ellipse
            key={i}
            cx={x}
            cy={y}
            rx="10"
            ry="27"
            fill={i % 2 ? "#73745a" : "#8e9172"}
            transform={`rotate(${r} ${x} ${y})`}
          />
        ))}
        <path
          d="M247 363q-17-26 4-65l17-43h66l16 43q26 40 4 65-26 21-55 17-31 1-52-17"
          fill="#6b6351"
        />
        <ellipse cx="301" cy="255" rx="34" ry="8" fill="#4d4a3c" />
      </g>
      <g transform="translate(-26 173) scale(1.22)">
        <Chair id={`${id}-hero`} />
      </g>
      <path d="M0 0h740v790H0z" fill={`url(#${id}-sun)`} opacity=".17" />
      <path d="M0 0h740v790H0z" filter={`url(#${id}-grain)`} opacity=".34" />
    </svg>
  );
}
