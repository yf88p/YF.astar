import { useId } from "react";
import styles from "./slow-days.module.css";

const blue = "#234bb7";
const cream = "#f6f0d8";
const foam = "#bed8c4";
const yellow = "#ebcf70";

export function Sun({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d="M50 7V19" transform={`rotate(${i * 22.5} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="24" />
        <path d="M40 48v3m20-3v3m-16 9q6 5 12 0" />
      </g>
    </svg>
  );
}

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={diagonal ? "M5 19 19 5M5 5h14v14" : "M3 12h17m-6-6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OliveBranch({ transform }: { transform?: string }) {
  return (
    <g transform={transform} fill={blue}>
      <path
        d="M0 170C41 125 55 68 67 0"
        fill="none"
        stroke={blue}
        strokeWidth="3"
      />
      <path d="M14 151C-12 145-18 123-17 112c23 5 36 18 31 39M25 130C50 124 65 106 67 94c-25 0-43 17-42 36M35 105C9 96 3 77 4 61c22 12 33 28 31 44M44 81C68 81 85 63 88 46c-26 5-40 17-44 35M53 52C31 36 34 18 38 9c16 10 20 24 15 43M59 29C82 22 89 10 90-5 72-1 62 10 59 29" />
      <ellipse cx="39" cy="133" rx="5" ry="8" transform="rotate(24 39 133)" />
      <ellipse cx="27" cy="87" rx="5" ry="8" transform="rotate(-20 27 87)" />
    </g>
  );
}

export function CoastalScene() {
  const id = useId();
  return (
    <svg
      viewBox="0 0 720 720"
      role="img"
      aria-label="An illustrated Mediterranean bay with blue-shuttered houses, a striped beach umbrella, an olive branch, and a little sailboat"
    >
      <defs>
        <clipPath id={`${id}-arch`}>
          <path d="M27 674V344C27 159 156 34 360 34s333 125 333 310v330Z" />
        </clipPath>
        <pattern
          id={`${id}-sea`}
          width="91"
          height="37"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M8 12q12 5 27 0m24 18 13-1"
            fill="none"
            stroke={cream}
            strokeWidth="1.4"
            opacity=".45"
          />
        </pattern>
        <pattern
          id={`${id}-sand`}
          width="31"
          height="33"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="9" cy="9" r=".8" fill={blue} opacity=".2" />
          <path d="m23 24 3-1" stroke={blue} strokeWidth=".7" opacity=".2" />
        </pattern>
      </defs>
      <path
        d="M17 680V344C17 153 151 23 360 23s343 130 343 321v336Z"
        fill="none"
        stroke={blue}
        strokeWidth="1"
      />
      <g clipPath={`url(#${id}-arch)`}>
        <path d="M0 0h720v720H0Z" fill="#e5e8cc" />
        <g className={styles.sunTurn}>
          <circle cx="270" cy="155" r="38" fill={yellow} />
          <g stroke={blue} strokeWidth="1.5" strokeLinecap="round">
            {Array.from({ length: 16 }, (_, i) => (
              <path
                key={i}
                d="M270 101v-9"
                transform={`rotate(${i * 22.5} 270 155)`}
              />
            ))}
          </g>
        </g>
        <path
          d="M0 293c101-15 139-17 229 0s132-4 196-10 183-3 295 13v424H0Z"
          fill={blue}
        />
        <path
          d="M0 329c165-7 220 18 362-8s221 7 358 9"
          fill="none"
          stroke={cream}
          strokeWidth="1.5"
          opacity=".45"
        />
        <path
          d="M379 294c46-43 73-114 136-126s90 37 135 20 92 3 107 30v193H416Z"
          fill="#89b7a0"
        />
        <path
          d="M428 285c33-67 90-110 120-80s50 19 78-2 70-3 96 24v116Z"
          fill={foam}
        />
        <path
          d="M720 284c-54 5-102 27-152 43-38 13-83 13-112 40-28 26-27 48-6 66 34 29 91 37 60 69-30 30-150 40-230 44C163 554 48 583 0 638v90h720Z"
          fill={cream}
        />
        <path
          d="M720 302c-91 3-128 45-215 59-75 13-85 56-31 78 126 51 33 93-111 105C172 560 55 587 0 647"
          fill="none"
          stroke={foam}
          strokeWidth="15"
        />
        <path
          d="M720 306c-92 3-130 45-211 58-73 12-87 46-31 70 137 60 37 100-108 113C176 565 56 590 0 650"
          fill="none"
          stroke={cream}
          strokeWidth="2"
        />
        <path
          d="M720 454c-57 22-100 3-119 45-25 55-52 86-146 113-77 23-178 17-226 108h491Z"
          fill={yellow}
          opacity=".5"
        />
        <path d="M0 550h720v170H0Z" fill={`url(#${id}-sand)`} />
        <g fill={cream} stroke={blue} strokeWidth="1.7" strokeLinejoin="round">
          <path d="m467 255 74-20 2 98-77 26Z" />
          <path d="m541 235 42 19v88l-40-9Z" fill="#e7d894" />
          <path d="m458 254 83-28 49 24-10 11-40-15-73 24Z" fill={blue} />
          <path d="M551 185h70v132l-70 21Z" />
          <path d="m621 185 36 20v100l-36 12Z" fill="#e7d894" />
          <path d="m546 183 42-31 42 28v12h-84Z" fill={blue} />
          <path d="M631 254h86v94l-86 5Z" />
          <path d="M623 250h103v13H623Z" fill={blue} />
        </g>
        <g fill={blue}>
          <path d="M574 208h13v24h-13zm24 0h13v24h-13zm-24 49h13v23h-13zm24 0h13v23h-13zM479 282l16-5v26l-16 5zm32-9 16-4v25l-16 5z" />
          <path d="M573 328v-23a13 13 0 0 1 26 0v16ZM653 290h14v22h-14zm35 0h14v22h-14z" />
        </g>
        <g stroke={cream} strokeWidth="1" opacity=".7">
          <path d="M578 211v19m5-19v19m19-19v19m5-19v19m-126 53v18m5-20v18m30-27v18m5-20v18" />
        </g>
        <path
          d="m614 317-4 10-13 3-4 10-14 4-4 10-14 4-4 10-18 4"
          fill="none"
          stroke={blue}
          strokeWidth="2"
        />
        <g fill={blue}>
          <path d="M449 337c-12-43-15-60-10-86 21 21 24 50 10 86M462 330c-5-48 5-67 15-77 7 29 2 55-15 77M675 249c-13-53-10-81 2-110 17 41 17 74-2 110" />
          <path d="m433 334 38-3-7 23-21 2Z" />
        </g>
        <g className={styles.seaWaves}>
          <path d="M0 344h390v206H0Z" fill={`url(#${id}-sea)`} />
          <path
            d="M64 357h44m195 98h58M107 490h45m28-88h37"
            stroke={cream}
            strokeWidth="2"
            strokeLinecap="round"
            opacity=".8"
          />
        </g>
        <g className={styles.sailboat}>
          <path d="M287 391h72l-15 15h-45Z" fill={cream} />
          <path d="M324 329v60" stroke={cream} strokeWidth="2" />
          <path d="m319 335-30 47h30Zm9 12v35h23Z" fill={cream} />
          <path
            d="M297 414q26 5 52 0"
            fill="none"
            stroke={cream}
            strokeWidth="1.5"
            opacity=".5"
          />
        </g>
        <g stroke={blue} strokeWidth="2" strokeLinejoin="round">
          <path d="m157 449 30 201" fill="none" strokeWidth="4" />
          <path
            d="m157 449 17 113"
            fill="none"
            stroke={cream}
            strokeWidth="4"
          />
          <path
            d="M47 479c11-59 46-96 105-102 64-5 113 29 146 67Z"
            fill={cream}
          />
          <path
            d="M47 479c11-59 46-96 105-102-38 18-57 46-60 95Z"
            fill={blue}
          />
          <path d="M133 461c-5-42 2-68 19-84 27 22 45 48 51 73Z" fill={blue} />
          <path
            d="M249 450c-21-38-51-62-97-73 64-5 113 29 146 67Z"
            fill={blue}
          />
          <path
            d="M47 479c11-59 46-96 105-102 64-5 113 29 146 67"
            fill="none"
            stroke={cream}
            strokeWidth="2"
          />
          <path
            d="m47 479 2 13q24 12 43-8l41-11q21 15 44-5l26-5q29 16 46-1l49-5v-13Z"
            fill={cream}
          />
          <path
            d="m48 480 1 12q24 12 43-8v-12Zm85-19v12q21 15 44-5l26-5v-13Zm116-11v12l49-5v-13Z"
            fill={blue}
          />
        </g>
        <g transform="rotate(-12 267 620)">
          <path d="M222 590h96v57h-96Z" fill={blue} />
          <path
            d="M232 590v57m17-57v57m17-57v57m17-57v57m17-57v57"
            stroke={cream}
            strokeWidth="7"
          />
          <path
            d="M222 586v-6m10 6v-6m11 6v-6m11 6v-6m11 6v-6m11 6v-6m11 6v-6m11 6v-6m11 6v-6m9 6v-6"
            stroke={blue}
            strokeWidth="2"
          />
        </g>
        <ellipse cx="375" cy="606" rx="23" ry="8" fill={blue} opacity=".12" />
        <path
          d="m361 584 3 19h19l3-19Z"
          fill={cream}
          stroke={blue}
          strokeWidth="2"
        />
        <path d="m378 584 6-17" stroke={blue} strokeWidth="2" />
        <path d="M351 590h45" stroke={blue} strokeWidth="2" />
        <path
          d="M594 473c8-6 14-5 23 0m8-48c8-6 15-5 22 0M93 229q10-10 20 0 10-10 20 0m213-11q8-9 16 0 8-9 16 0"
          fill="none"
          stroke={blue}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <OliveBranch transform="translate(70 107) rotate(6) scale(1.05)" />
      <text
        x="402"
        y="704"
        fill={blue}
        fontFamily="Georgia, serif"
        fontSize="18"
        fontStyle="italic"
        transform="rotate(-3 402 704)"
      >
        a place to lose track of time.
      </text>
      <path
        d="M622 689q29-20 17-49m-6 7 6-9 8 8"
        fill="none"
        stroke={blue}
        strokeWidth="1.3"
      />
    </svg>
  );
}

export function RoomScene({ kind }: { kind: "garden" | "sea" | "casa" }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 440 340"
      role="img"
      aria-label={
        kind === "garden"
          ? "A garden room with blue shutters, a striped daybed, and olive trees"
          : kind === "sea"
            ? "An arched sea-view balcony with a breakfast table and sailboat"
            : "A private coastal casita with a pool and lemon tree"
      }
    >
      <defs>
        <pattern
          id={`${id}-tiles`}
          width="44"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0 0h44v28H0Z"
            fill="none"
            stroke={blue}
            strokeWidth=".8"
            opacity=".25"
          />
        </pattern>
      </defs>
      <path d="M0 0h440v340H0Z" fill={kind === "sea" ? "#dfdfbd" : foam} />
      {kind === "garden" && (
        <>
          <path d="M55 0h330v244H55Z" fill={cream} />
          <path d="M57 0h18v244H57Z" fill="#e4d69f" />
          <path d="M154 82a63 63 0 0 1 126 0v128H154Z" fill={blue} />
          <path d="M169 88a48 48 0 0 1 96 0v107h-96Z" fill="#a1c4b1" />
          <path d="M212 39h10v165h-10Z" fill={cream} />
          <path d="M168 120h99" stroke={cream} strokeWidth="7" />
          <path
            d="m151 71-46-12v151l46-7Zm132 0 45-12v151l-45-7Z"
            fill={blue}
          />
          <path
            d="m115 82 27 6m-27 9 27 6m-27 9 27 6m-27 9 27 6m-27 9 27 6m-27 9 27 6m-27 9 27 6m-27 9 27 6m152-117 26-6m-26 21 26-6m-26 21 26-6m-26 21 26-6m-26 21 26-6m-26 21 26-6m-26 21 26-6m-26 21 26-6"
            stroke={cream}
            strokeWidth="2"
            opacity=".6"
          />
          <path d="M0 244h440v96H0Z" fill="#e3d39f" />
          <path d="M0 244h440v96H0Z" fill={`url(#${id}-tiles)`} />
          <path
            d="M112 232h205v58H112Z"
            fill={cream}
            stroke={blue}
            strokeWidth="2"
          />
          <path d="M119 239h190v24H119Z" fill={foam} />
          <path
            d="M123 272h184m-179 17v19m165-19v19"
            stroke={blue}
            strokeWidth="4"
          />
          <path d="M151 235h51v31h-51Z" fill={blue} />
          <path
            d="M158 236v29m12-29v29m12-29v29m12-29v29"
            stroke={cream}
            strokeWidth="4"
          />
          <path d="M260 235h33v22h-33Z" fill={yellow} />
          <OliveBranch transform="translate(354 63) scale(.8)" />
          <path d="m352 198 34 1-6 62h-23Z" fill={blue} />
          <path
            d="M11 302c22-39 13-94 35-126 14 48 4 92-17 130m-16-17C-5 254 1 224 3 211c26 18 34 47 24 80"
            fill={blue}
          />
        </>
      )}
      {kind === "sea" && (
        <>
          <path d="M81 250V111a139 139 0 0 1 278 0v139Z" fill={cream} />
          <path d="M106 245V117a114 114 0 0 1 228 0v128Z" fill={foam} />
          <path d="M106 154h228v105H106Z" fill={blue} />
          <path
            d="M107 199c78 10 146-3 226 2m-226 35c102 12 135-7 226-2"
            fill="none"
            stroke={cream}
            strokeWidth="1.5"
            opacity=".65"
          />
          <path
            d="M106 245V117a114 114 0 0 1 228 0v128"
            fill="none"
            stroke={blue}
            strokeWidth="2"
          />
          <circle cx="267" cy="91" r="21" fill={yellow} />
          <path
            d="M182 194h36l-7 8h-23Zm19-36-17 30h17Zm4 8v22h15Z"
            fill={cream}
          />
          <path d="M0 266h440v74H0Z" fill={cream} />
          <path d="M0 266h440v74H0Z" fill={`url(#${id}-tiles)`} />
          <path
            d="M77 248h287M89 248v-40m27 40v-40m27 40v-40m27 40v-40m27 40v-40m27 40v-40m27 40v-40m27 40v-40m27 40v-40m27 40v-40m27 0H79"
            fill="none"
            stroke={blue}
            strokeWidth="3"
          />
          <ellipse
            cx="221"
            cy="263"
            rx="66"
            ry="15"
            fill={cream}
            stroke={blue}
            strokeWidth="2"
          />
          <path
            d="M220 278v41m-27 0h55m-92-58-19 48m151-48 19 48"
            stroke={blue}
            strokeWidth="3"
          />
          <path
            d="m135 298-9-50q-4-16 10-19 17-3 24 11m127 0q7-14 24-11 14 3 10 19l-9 50"
            fill="none"
            stroke={blue}
            strokeWidth="3"
          />
          <path d="M201 238h14v17h-14Z" fill={blue} />
          <path
            d="M215 240q13-1 5 10h-5"
            fill="none"
            stroke={blue}
            strokeWidth="2"
          />
          <ellipse cx="242" cy="254" rx="14" ry="4" fill={yellow} />
          <path d="M19 0h57v259H19Z" fill={blue} />
          <path
            d="M29 0v258m15-258v258m15-258v258"
            stroke={cream}
            strokeWidth="4"
            opacity=".5"
          />
          <path d="M364 0h57v259h-57Z" fill={blue} />
          <path
            d="M376 0v258m15-258v258m15-258v258"
            stroke={cream}
            strokeWidth="4"
            opacity=".5"
          />
        </>
      )}
      {kind === "casa" && (
        <>
          <path d="M0 178h440v162H0Z" fill={cream} />
          <path
            d="m99 65 205-15 20 174H91Z"
            fill={cream}
            stroke={blue}
            strokeWidth="1.5"
          />
          <path
            d="m304 50 70 39v128l-50 7Z"
            fill="#e6d699"
            stroke={blue}
            strokeWidth="1.5"
          />
          <path d="m87 59 219-15 78 41-10 13-72-35L93 77Z" fill={blue} />
          <path d="M121 119h43v58h-43Zm130-12h39v56h-39Z" fill={blue} />
          <path d="M183 215v-76a24 24 0 0 1 48 0v76Z" fill={blue} />
          <path d="M143 121v52m129-64v50" stroke={cream} strokeWidth="3" />
          <path
            d="M95 200h233v14H95Zm-10 14h253v13H85Zm-10 13h273v13H75Z"
            fill={cream}
            stroke={blue}
            strokeWidth="1.5"
          />
          <path
            d="M45 272c16-17 292-16 319 3s-3 45-33 47H72c-28-4-46-31-27-50Z"
            fill={foam}
          />
          <path
            d="M63 281c22-13 264-11 280 3s-5 25-20 25H80c-20-3-30-20-17-28Z"
            fill={blue}
          />
          <path
            d="M91 288q43 7 90 0m47 12q38-8 67-1"
            fill="none"
            stroke={cream}
            strokeWidth="1.5"
          />
          <path
            d="M375 285c-10-86 12-147 1-193"
            stroke={blue}
            strokeWidth="5"
            fill="none"
          />
          <path
            d="M377 220c-41-16-55-36-50-52 29 3 48 20 50 52m2-36c33-7 54-30 52-47-28 7-45 23-52 47m1-39c-30-5-45-26-42-46 26 7 40 23 42 46m-1-26c30-7 46-28 43-48-28 10-41 27-43 48m-2-29c-23-7-32-23-25-42 21 11 29 27 25 42"
            fill={blue}
          />
          <ellipse
            cx="348"
            cy="154"
            rx="10"
            ry="14"
            fill={yellow}
            transform="rotate(-26 348 154)"
          />
          <ellipse
            cx="412"
            cy="201"
            rx="10"
            ry="14"
            fill={yellow}
            transform="rotate(26 412 201)"
          />
          <ellipse cx="405" cy="104" rx="10" ry="14" fill={yellow} />
          <path d="M10 65h55v145H10Z" fill={foam} />
          <OliveBranch transform="translate(8 37) scale(.9)" />
        </>
      )}
    </svg>
  );
}

export function TableScene() {
  const id = useId();
  return (
    <svg
      viewBox="0 0 520 570"
      role="img"
      aria-label="A sunlit Mediterranean lunch of lemons, olives, and wine on a striped tablecloth beside the sea"
    >
      <defs>
        <clipPath id={`${id}-window`}>
          <path d="M40 499V220a220 220 0 0 1 440 0v279Z" />
        </clipPath>
        <pattern
          id={`${id}-cloth`}
          width="56"
          height="56"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-14)"
        >
          <path d="M0 0h56v56H0Z" fill={cream} />
          <path d="M0 0h16v56H0Z" fill={foam} />
          <path d="M23 0h3v56h-3Z" fill={blue} opacity=".55" />
        </pattern>
      </defs>
      <g clipPath={`url(#${id}-window)`}>
        <path d="M0 0h520v570H0Z" fill={foam} />
        <circle cx="366" cy="104" r="31" fill={yellow} />
        <path d="M0 173h520v185H0Z" fill={blue} />
        <path
          d="M72 203h48m169 17h69m50-29h64M160 243h82m102 19h29m-306 0h42"
          stroke={cream}
          strokeWidth="2"
          opacity=".6"
        />
        <path
          d="M7 331c146-98 350-136 529-67v316H0Z"
          fill={`url(#${id}-cloth)`}
        />
        <ellipse
          cx="262"
          cy="410"
          rx="125"
          ry="90"
          fill={cream}
          stroke={blue}
          strokeWidth="3"
          transform="rotate(-13 262 410)"
        />
        <ellipse
          cx="262"
          cy="410"
          rx="103"
          ry="71"
          fill="none"
          stroke={blue}
          strokeWidth="2"
          transform="rotate(-13 262 410)"
        />
        <ellipse
          cx="262"
          cy="410"
          rx="97"
          ry="65"
          fill="none"
          stroke={blue}
          strokeWidth="1"
          transform="rotate(-13 262 410)"
        />
        <path
          d="M186 418c-14-18-2-46 19-54 25-10 59 2 61 20 2 24-34 50-62 45Z"
          fill={yellow}
          stroke={blue}
          strokeWidth="1.5"
        />
        <path
          d="M246 438c-12-16 1-43 25-52s52-3 62 16c10 22-15 46-43 51-21 4-29-4-44-15Z"
          fill={yellow}
          stroke={blue}
          strokeWidth="1.5"
        />
        <path
          d="M255 388c-5-34 14-47 40-44-3 25-18 38-40 44m7 11c22-15 44-10 54 13-21 8-41 3-54-13"
          fill={blue}
        />
        <path
          d="m385 370 22 123m-13-133 22 122m-17-139 22 123m-19-123 7 49m-20-45 8 46"
          fill="none"
          stroke={blue}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <g transform="rotate(9 132 318)" stroke={blue} strokeWidth="2">
          <path d="M101 208h63l-5 56c-4 28-49 28-53 0Z" fill={cream} />
          <path
            d="m104 237 3 26c3 25 48 25 50 0l3-26Z"
            fill={yellow}
            stroke="none"
          />
          <path d="M132 284v49m-25 0h50" />
        </g>
        <ellipse
          cx="327"
          cy="298"
          rx="42"
          ry="25"
          fill={cream}
          stroke={blue}
          strokeWidth="2"
        />
        <g fill={blue}>
          <ellipse
            cx="311"
            cy="295"
            rx="8"
            ry="5"
            transform="rotate(-30 311 295)"
          />
          <ellipse
            cx="330"
            cy="288"
            rx="8"
            ry="5"
            transform="rotate(20 330 288)"
          />
          <ellipse
            cx="337"
            cy="303"
            rx="8"
            ry="5"
            transform="rotate(-40 337 303)"
          />
          <ellipse cx="318" cy="307" rx="8" ry="5" />
        </g>
      </g>
      <path
        d="M29 507V220a231 231 0 0 1 462 0v287"
        fill="none"
        stroke={cream}
        strokeWidth="1"
      />
      <text
        x="126"
        y="546"
        fill={cream}
        fontFamily="Georgia, serif"
        fontSize="25"
        fontStyle="italic"
        transform="rotate(-4 126 546)"
      >
        long lunch. longer conversations.
      </text>
    </svg>
  );
}
