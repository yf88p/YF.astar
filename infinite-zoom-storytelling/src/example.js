import { uid } from "./core.js";

export function createExample() {
  const C = {
    paper: "#e9e9dc",
    forest: "#214e3e",
    sage: "#799276",
    light: "#a4b294",
    rust: "#bb6245",
    ochre: "#d5a36e",
    cream: "#f3efe3",
    ink: "#253b31",
    roof: "#713f32",
    soil: "#d8c3a1",
    water: "#9bb8aa",
    pale: "#d6dcc6",
  };
  const nodes = [];
  const links = [];
  const add = (type, id, parentId, x, y, w, h, properties = {}) => {
    const node = {
      id,
      parentId,
      type,
      name: id.replaceAll("-", " "),
      x,
      y,
      w,
      h,
      scale: 1,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      ...properties,
    };
    nodes.push(node);
    return node;
  };
  const rect = (id, parent, x, y, w, h, fill, properties) =>
    add("rect", id, parent, x, y, w, h, { fill, ...properties });
  const ellipse = (id, parent, x, y, w, h, fill, properties) =>
    add("ellipse", id, parent, x, y, w, h, { fill, ...properties });
  const path = (id, parent, x, y, w, h, d, fill, properties) =>
    add("path", id, parent, x, y, w, h, { path: d, fill, ...properties });
  const text = (id, parent, x, y, w, h, content, size = 15, properties) =>
    add("text", id, parent, x, y, w, h, {
      text: content,
      fontSize: size,
      fontFamily: "Arial, sans-serif",
      fontWeight: 400,
      color: C.ink,
      fill: C.ink,
      align: "left",
      ...properties,
    });
  const serif = { fontFamily: "Georgia, Times New Roman, serif" };
  const rule = (id, parent, x, y, w, fill = C.light) =>
    rect(id, parent, x, y, w, 1, fill);
  const scene = (id, parent, x, y, scale, fill = C.cream) =>
    add("scene", id, parent, x, y, 1000, 660, {
      scale,
      fill,
      clip: true,
      minZoom: 0.4,
    });

  // Each cut-paper piece is its own object, including needles, gills, and rootlets.
  const spruce = (id, parent, x, y, w, h, fill) => {
    rect(
      `${id}-trunk`,
      parent,
      x + w * 0.465,
      y + h * 0.32,
      w * 0.07,
      h * 0.68,
      C.roof,
    );
    const points = [
      [0.5, 0],
      [0.71, 0.2],
      [0.63, 0.18],
      [0.87, 0.41],
      [0.73, 0.37],
      [1, 0.68],
      [0.77, 0.62],
      [0.96, 0.86],
      [0.57, 0.8],
      [0.5, 0.9],
      [0.43, 0.8],
      [0.04, 0.86],
      [0.23, 0.62],
      [0, 0.68],
      [0.27, 0.37],
      [0.13, 0.41],
      [0.37, 0.18],
      [0.29, 0.2],
    ];
    path(
      `${id}-crown`,
      parent,
      x,
      y,
      w,
      h,
      points
        .map(([px, py], i) => `${i ? "L" : "M"}${px * w} ${py * h}`)
        .join(" ") + " Z",
      fill,
    );
    path(
      `${id}-fold`,
      parent,
      x + w * 0.5,
      y + h * 0.05,
      w * 0.36,
      h * 0.75,
      `M0 0 L${w * 0.16} ${h * 0.15} L${w * 0.07} ${h * 0.13} L${w * 0.3} ${h * 0.38} L${w * 0.16} ${h * 0.33} L${w * 0.36} ${h * 0.64} L0 ${h * 0.75} Z`,
      C.light,
      { opacity: 0.17 },
    );
    for (let i = 0; i < 5; i++) {
      const branchY = y + h * (0.32 + i * 0.095);
      const branchW = w * (0.12 + i * 0.03);
      path(
        `${id}-crease-${i}`,
        parent,
        x + w * 0.5 - branchW,
        branchY,
        branchW * 2,
        h * 0.065,
        `M0 0 L${branchW} ${h * 0.065} L${branchW * 2} 0`,
        "none",
        { stroke: C.cream, strokeWidth: 1, opacity: 0.2 },
      );
    }
  };
  const mushroom = (id, parent, x, y, w, h, fill = C.rust) => {
    path(
      `${id}-stalk`,
      parent,
      x + w * 0.39,
      y + h * 0.34,
      w * 0.24,
      h * 0.66,
      `M${w * 0.06} 0 L${w * 0.18} 0 Q${w * 0.15} ${h * 0.4} ${w * 0.24} ${h * 0.63} Q${w * 0.12} ${h * 0.66} 0 ${h * 0.63} Z`,
      C.cream,
    );
    path(
      `${id}-cap`,
      parent,
      x,
      y,
      w,
      h * 0.48,
      `M0 ${h * 0.39} C${w * 0.09} ${h * 0.15} ${w * 0.3} 0 ${w * 0.5} 0 C${w * 0.77} 0 ${w * 0.94} ${h * 0.2} ${w} ${h * 0.39} Q${w * 0.5} ${h * 0.48} 0 ${h * 0.39} Z`,
      fill,
    );
    ellipse(
      `${id}-underside`,
      parent,
      x + w * 0.03,
      y + h * 0.365,
      w * 0.94,
      h * 0.115,
      C.ochre,
    );
    for (let i = 0; i < 7; i++) {
      path(
        `${id}-gill-${i}`,
        parent,
        x + w * 0.08,
        y + h * 0.382,
        w * 0.84,
        h * 0.073,
        `M${w * (0.025 + i * 0.13)} 0 L${w * 0.42} ${h * 0.073}`,
        "none",
        { stroke: C.roof, strokeWidth: Math.max(0.6, w * 0.006), opacity: 0.6 },
      );
    }
    ellipse(
      `${id}-cap-fleck-1`,
      parent,
      x + w * 0.32,
      y + h * 0.14,
      w * 0.08,
      h * 0.025,
      C.cream,
    );
    ellipse(
      `${id}-cap-fleck-2`,
      parent,
      x + w * 0.64,
      y + h * 0.22,
      w * 0.06,
      h * 0.025,
      C.cream,
    );
  };
  const fern = (id, parent, x, y, w, h, fill = C.forest) => {
    path(
      `${id}-stem`,
      parent,
      x,
      y,
      w,
      h,
      `M${w * 0.5} ${h} Q${w * 0.34} ${h * 0.4} ${w * 0.53} 0`,
      "none",
      { stroke: fill, strokeWidth: 2 },
    );
    for (let i = 0; i < 8; i++) {
      const py = h * (0.1 + i * 0.1);
      const reach = w * (0.1 + Math.sin(((i + 1) / 9) * Math.PI) * 0.29);
      const mid = w * (0.47 - Math.sin(i * 0.35) * 0.045);
      for (const side of [-1, 1]) {
        path(
          `${id}-leaf-${i}-${side === -1 ? "l" : "r"}`,
          parent,
          x,
          y,
          w,
          h,
          `M${mid} ${py + h * 0.09} Q${mid + side * reach * 0.45} ${py - h * 0.04} ${mid + side * reach} ${py - h * 0.035} Q${mid + side * reach * 0.86} ${py + h * 0.09} ${mid} ${py + h * 0.09} Z`,
          fill,
        );
      }
    }
  };
  const chapter = (id, number, category, title, body, fill = C.ink) => {
    rule(`${id}-top-rule`, id, 56, 66, 888);
    text(`${id}-eyebrow`, id, 56, 34, 800, 20, `${number} / ${category}`, 11, {
      color: fill,
      fill,
      fontWeight: 700,
    });
    text(`${id}-title`, id, 54, 96, 425, 132, title, 52, {
      ...serif,
      color: fill,
      fill,
    });
    text(`${id}-body`, id, 56, 252, 352, 116, body, 16, { color: fill, fill });
    rule(`${id}-footer-rule`, id, 56, 550, 888);
    text(
      `${id}-folio`,
      id,
      56,
      634,
      888,
      16,
      `THE SECRET LIFE OF A FOREST     /     FIELD NOTES ${number}                                      LOOK CLOSER, THEN LOOK AGAIN`,
      9,
      { color: fill, fill },
    );
  };
  const branches = (parent, choices, overview = false) => {
    choices.forEach(([label, target], i) => {
      const id = `${parent}-branch-${i + 1}`;
      const x = overview ? 78 : 56 + i * 468;
      const y = overview ? 620 + i * 48 : 572;
      const w = overview ? 214 : 420;
      const h = overview ? 36 : 46;
      rect(id, parent, x, y, w, h, i ? C.cream : C.forest, {
        stroke: C.forest,
        strokeWidth: 1,
      });
      text(
        `${id}-label`,
        parent,
        x + 15,
        y + (overview ? 11 : 15),
        w - 30,
        20,
        label,
        overview ? 11 : 13,
        {
          color: i ? C.forest : C.cream,
          fill: i ? C.forest : C.cream,
          fontWeight: 700,
        },
      );
      // Link both the hit area and its overlaid label; either can be picked by the editor.
      for (const sourceId of [id, `${id}-label`]) {
        links.push({
          id: `link-${sourceId}`,
          sourceId,
          targetStopId: target,
          label,
        });
      }
    });
  };

  add("scene", "forest", null, 0, 0, 1200, 780, { fill: C.paper, clip: true });
  ellipse("forest-sky-disc", "forest", 602, 71, 447, 451, C.pale);
  ellipse("forest-sun", "forest", 746, 108, 82, 82, C.cream);
  path(
    "forest-distant-slope",
    "forest",
    418,
    350,
    708,
    239,
    "M0 206 Q90 100 176 135 Q320 2 434 63 Q560 100 708 0 L708 239 L0 239 Z",
    C.light,
  );
  path(
    "forest-distant-ridge",
    "forest",
    578,
    332,
    558,
    242,
    "M0 222 Q100 82 211 106 Q350 122 430 18 Q502 0 558 57 L558 242 L0 242 Z",
    C.sage,
  );

  spruce("spruce-far-left", "forest", 452, 250, 116, 294, C.light);
  spruce("spruce-silver", "forest", 542, 134, 173, 387, C.sage);
  spruce("spruce-far-right", "forest", 984, 155, 156, 381, C.sage);
  spruce("spruce-middle", "forest", 686, 195, 173, 338, C.forest);
  spruce("spruce-tower", "forest", 784, 46, 278, 476, C.forest);
  spruce("spruce-left", "forest", 435, 337, 104, 222, C.forest);

  path(
    "forest-soil-cutaway",
    "forest",
    320,
    545,
    827,
    155,
    "M0 35 Q125 0 240 28 Q395 5 558 18 Q734 0 827 33 L798 117 Q696 155 530 135 Q352 152 192 129 Q75 144 21 96 Z",
    C.soil,
  );
  path(
    "forest-moss-bank",
    "forest",
    307,
    469,
    855,
    145,
    "M0 111 Q54 58 168 66 Q235 3 352 45 Q458 0 595 35 Q755 4 855 69 L838 111 Q713 140 584 121 Q434 145 294 122 Q125 136 0 111 Z",
    C.sage,
  );
  path(
    "forest-moss-light",
    "forest",
    332,
    527,
    792,
    71,
    "M0 44 Q138 0 248 18 Q335 35 432 7 Q600 0 792 34 Q632 70 454 45 Q278 71 157 50 Q57 67 0 44 Z",
    C.light,
  );
  path(
    "forest-walking-path",
    "forest",
    395,
    496,
    402,
    117,
    "M226 0 C216 26 320 27 345 46 C402 78 172 67 132 82 C92 96 113 104 0 117",
    "none",
    { stroke: C.cream, strokeWidth: 12 },
  );
  path(
    "forest-trail-center",
    "forest",
    395,
    496,
    402,
    117,
    "M226 0 C216 26 320 27 345 46 C402 78 172 67 132 82 C92 96 113 104 0 117",
    "none",
    { stroke: C.ochre, strokeWidth: 1 },
  );

  // The field station is a small, deliberately architectural counterpoint to the trees.
  rect("cabin-shadow", "forest", 569, 507, 165, 8, C.forest, { opacity: 0.18 });
  rect("cabin-wall", "forest", 582, 425, 121, 84, C.cream);
  path(
    "cabin-gable",
    "forest",
    580,
    393,
    127,
    37,
    "M0 37 L63 0 L127 37 Z",
    C.cream,
  );
  path(
    "cabin-side",
    "forest",
    703,
    424,
    27,
    85,
    "M0 0 L27 12 L27 79 L0 85 Z",
    C.ochre,
  );
  path(
    "cabin-roof",
    "forest",
    563,
    387,
    181,
    59,
    "M0 45 L77 0 L181 48 L147 59 L79 19 L19 58 Z",
    C.roof,
  );
  path(
    "cabin-roof-fold",
    "forest",
    640,
    387,
    104,
    48,
    "M0 0 L104 48 L83 46 L0 9 Z",
    C.rust,
  );
  rect("cabin-chimney", "forest", 679, 381, 13, 25, C.roof);
  path(
    "cabin-smoke",
    "forest",
    680,
    336,
    20,
    39,
    "M8 39 C0 25 20 24 12 13 Q4 5 14 0",
    "none",
    { stroke: C.cream, strokeWidth: 2 },
  );
  rect("cabin-door", "forest", 631, 460, 26, 49, C.forest);
  ellipse("cabin-door-knob", "forest", 651, 485, 3, 3, C.ochre);
  for (const [i, x] of [594, 670].entries()) {
    rect(`cabin-window-${i}`, "forest", x, 449, 20, 24, C.sage, {
      stroke: C.roof,
      strokeWidth: 2,
    });
    rect(`cabin-mullion-${i}`, "forest", x + 9, 449, 2, 24, C.cream);
    rect(`cabin-transom-${i}`, "forest", x, 460, 20, 2, C.cream);
  }
  rect("cabin-step", "forest", 625, 507, 39, 5, C.roof);
  text("cabin-sign", "forest", 595, 430, 95, 12, "FIELD STATION", 7, {
    fontWeight: 700,
    align: "center",
  });

  ellipse("forest-pond-bank", "forest", 928, 552, 166, 56, C.forest);
  ellipse("forest-pond", "forest", 939, 555, 143, 43, C.water);
  path(
    "forest-pond-reflection",
    "forest",
    963,
    566,
    91,
    19,
    "M8 0 Q42 5 80 0 M0 10 Q40 16 91 10 M23 18 L64 18",
    "none",
    { stroke: C.cream, strokeWidth: 1.5 },
  );
  path(
    "forest-large-rock",
    "forest",
    1054,
    538,
    65,
    47,
    "M0 35 L13 11 L40 0 L62 21 L65 40 L37 47 Z",
    C.ink,
  );
  path(
    "forest-rock-light",
    "forest",
    1067,
    538,
    48,
    31,
    "M0 11 L27 0 L48 21 L19 31 Z",
    C.sage,
  );
  ellipse("forest-pebble", "forest", 920, 587, 24, 12, C.cream);

  for (let i = 0; i < 11; i++) {
    const x = 360 + i * 63;
    const h = 48 + (i % 4) * 11;
    path(
      `forest-root-${i}`,
      "forest",
      x,
      585 + (i % 3) * 8,
      74,
      h,
      `M35 0 Q30 ${h * 0.25} 41 ${h * 0.45} Q59 ${h * 0.65} 68 ${h} M39 ${h * 0.38} Q17 ${h * 0.55} 4 ${h * 0.84} M48 ${h * 0.58} L69 ${h * 0.62}`,
      "none",
      { stroke: i % 2 ? C.roof : C.rust, strokeWidth: i % 3 ? 1.4 : 2.8 },
    );
  }
  path(
    "forest-root-chamber",
    "forest",
    488,
    594,
    130,
    87,
    "M0 16 Q56 0 120 17 L130 56 Q98 87 28 73 L8 48 Z",
    C.roof,
    { opacity: 0.28 },
  );
  for (let i = 0; i < 36; i++) {
    ellipse(
      `forest-soil-grain-${i}`,
      "forest",
      349 + ((i * 101) % 749),
      620 + ((i * 17) % 64),
      2.3,
      2.3,
      C.roof,
      { opacity: 0.35 },
    );
  }
  mushroom("mushroom-hero", "forest", 748, 449, 186, 155);
  mushroom("mushroom-companion", "forest", 881, 515, 72, 85, C.roof);
  mushroom("mushroom-small", "forest", 724, 546, 55, 58, C.ochre);
  mushroom("mushroom-front-left", "forest", 384, 577, 76, 81);
  mushroom("mushroom-front-pair", "forest", 447, 604, 46, 55, C.roof);
  mushroom("mushroom-front-right", "forest", 974, 608, 59, 66);
  fern("fern-left", "forest", 314, 509, 75, 110);
  fern("fern-cabin", "forest", 541, 491, 55, 82);
  fern("fern-right", "forest", 1072, 462, 76, 116);
  fern("fern-low", "forest", 1008, 594, 61, 86);
  for (let i = 0; i < 17; i++) {
    const x = 366 + i * 43;
    const y = 566 + Math.sin(i * 1.7) * 21;
    path(
      `forest-grass-${i}`,
      "forest",
      x,
      y,
      20,
      20,
      "M10 20 Q7 6 1 4 M10 20 Q12 4 18 0 M10 20 L9 1",
      "none",
      { stroke: C.forest, strokeWidth: 1.2 },
    );
  }
  path(
    "forest-bird-1",
    "forest",
    677,
    98,
    26,
    9,
    "M0 9 Q6 0 13 7 Q20 0 26 9",
    "none",
    { stroke: C.forest, strokeWidth: 1.5 },
  );
  path(
    "forest-bird-2",
    "forest",
    707,
    81,
    18,
    6,
    "M0 6 Q4 0 9 5 Q14 0 18 6",
    "none",
    { stroke: C.forest, strokeWidth: 1.2 },
  );

  text(
    "forest-eyebrow",
    "forest",
    80,
    70,
    390,
    20,
    "FIELD NOTES / VOLUME 01",
    12,
    { fontWeight: 700 },
  );
  text(
    "forest-title-first",
    "forest",
    80,
    108,
    465,
    80,
    "The secret life",
    66,
    serif,
  );
  text(
    "forest-title-second",
    "forest",
    80,
    176,
    465,
    80,
    "of a forest.",
    66,
    serif,
  );
  text(
    "forest-description",
    "forest",
    84,
    274,
    340,
    102,
    "A world beneath the world we know.\nFollow a thread from the tallest spruce\nto the smallest instructions for life.\nNothing here grows entirely alone.",
    15,
  );
  rule("forest-description-rule", "forest", 84, 387, 56, C.rust);
  text(
    "forest-canopy-label",
    "forest",
    956,
    94,
    211,
    34,
    "01 / ABOVE THE GROUND",
    10,
    { fontWeight: 700 },
  );
  path(
    "forest-canopy-leader",
    "forest",
    966,
    132,
    87,
    67,
    "M87 0 L44 0 L0 67",
    "none",
    { stroke: C.sage, strokeWidth: 1 },
  );
  text(
    "forest-soil-label",
    "forest",
    676,
    709,
    285,
    20,
    "02 / BENEATH THE SURFACE",
    10,
    { fontWeight: 700 },
  );
  path(
    "forest-soil-leader",
    "forest",
    635,
    664,
    30,
    56,
    "M0 0 L0 56 L30 56",
    "none",
    { stroke: C.roof, strokeWidth: 1 },
  );
  text(
    "forest-image-caption",
    "forest",
    80,
    561,
    222,
    35,
    "HERBARIUM / SPECIMEN 001\nA small invitation to look closer.",
    10,
  );
  rule("forest-bottom-rule", "forest", 80, 742, 1040);
  text(
    "forest-colophon",
    "forest",
    80,
    755,
    750,
    15,
    "AN ILLUSTRATED JOURNEY IN SIX DESCENTS     /     ECOLOGY, AT EVERY SCALE",
    9,
  );
  text("forest-folio", "forest", 1030, 751, 90, 20, "01 / 09", 12, {
    ...serif,
    align: "right",
  });

  const botanicalSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="280" viewBox="0 0 360 280">
    <title>Forest field journal: an original botanical postage study</title>
    <desc>A sage fern and a terracotta mushroom on a perforated cream botanical stamp.</desc>
    <rect width="360" height="280" fill="#d6dcc6"/>
    <rect x="13" y="13" width="334" height="254" fill="#f3efe3"/>
    <rect x="28" y="28" width="304" height="224" fill="none" stroke="#799276" stroke-width="2"/>
    <path d="M23 13H337M23 267H337M13 23V257M347 23V257" fill="none" stroke="#d6dcc6" stroke-width="11" stroke-dasharray="2 14" stroke-linecap="round"/>
    <text x="44" y="51" font-family="Georgia, serif" font-size="13" fill="#214e3e">FOREST / FIELD JOURNAL</text>
    <text x="294" y="53" font-family="Georgia, serif" font-size="24" fill="#bb6245">01</text>
    <ellipse cx="174" cy="145" rx="81" ry="78" fill="#e9e9dc"/>
    <path d="M140 219Q119 154 158 75" fill="none" stroke="#214e3e" stroke-width="3"/>
    <path d="M145 106Q119 98 128 79Q148 85 145 106ZM146 113Q147 88 168 87Q170 107 146 113ZM137 132Q108 122 112 104Q135 106 137 132ZM137 143Q151 117 174 120Q167 141 137 143ZM133 159Q100 151 99 129Q123 132 133 159ZM135 172Q157 145 183 151Q171 172 135 172ZM138 194Q107 185 103 163Q130 166 138 194ZM141 207Q157 183 183 184Q176 204 141 207Z" fill="#214e3e"/>
    <path d="M216 177Q211 201 217 219H235Q226 194 230 174Z" fill="#d5a36e"/>
    <path d="M177 174Q192 126 224 126Q253 127 269 174Q220 190 177 174Z" fill="#bb6245"/>
    <path d="M182 176Q226 164 264 176Q230 188 182 176Z" fill="#d5a36e"/>
    <path d="M190 176L225 182M204 172L225 182M238 172L225 182M255 176L225 182" stroke="#713f32" fill="none"/>
    <circle cx="276" cy="203" r="28" fill="none" stroke="#799276"/>
    <circle cx="276" cy="203" r="23" fill="none" stroke="#799276"/>
    <path d="M253 203H299M248 213H304" stroke="#799276"/>
    <text x="45" y="239" font-family="Arial, sans-serif" font-size="9" letter-spacing="2" fill="#214e3e">OBSERVE / WONDER / RETURN</text>
  </svg>`;
  add("image", "field-image", "forest", 78, 410, 180, 140, {
    name: "Botanical field-journal stamp (replaceable)",
    assetId: "asset-field-journal",
    fit: "contain",
  });

  scene("canopy", "forest", 850, 180, 0.12);
  chapter(
    "canopy",
    "01",
    "THE SUNLIT EXCHANGE",
    "A tree makes\nlight tangible.",
    "Inside spruce needles, photosynthesis\nturns light, water and carbon dioxide\ninto sugars. Some of that carbon feeds\nfungal partners at the roots.",
  );
  ellipse("canopy-disc", "canopy", 510, 101, 384, 385, C.pale);
  ellipse("canopy-sun", "canopy", 819, 112, 74, 74, C.ochre);
  path(
    "canopy-twig",
    "canopy",
    518,
    143,
    379,
    360,
    "M6 353 Q165 208 367 5 M120 239 L95 108 M215 149 L343 130 M280 80 L272 0",
    "none",
    { stroke: C.roof, strokeWidth: 9 },
  );
  for (let i = 0; i < 18; i++) {
    const x = 554 + i * 15;
    const y = 432 - i * 15;
    path(
      `canopy-needle-left-${i}`,
      "canopy",
      x - 55,
      y - 78,
      62,
      88,
      "M55 88 Q12 55 0 0 Q36 14 62 80 Z",
      i % 3 ? C.forest : C.sage,
    );
    path(
      `canopy-needle-right-${i}`,
      "canopy",
      x,
      y - 7,
      90,
      30,
      "M0 4 Q49 0 90 13 Q45 30 0 10 Z",
      i % 3 ? C.sage : C.forest,
    );
  }
  for (let i = 0; i < 4; i++) {
    path(
      `canopy-light-ray-${i}`,
      "canopy",
      794 + i * 27,
      187 + i * 8,
      29,
      55,
      "M29 0 L0 55 M0 55 L1 42 M0 55 L12 48",
      "none",
      { stroke: C.ochre, strokeWidth: 1.5 },
    );
  }
  text(
    "canopy-detail",
    "canopy",
    56,
    390,
    365,
    108,
    "A needle is a negotiation.\nTiny pores admit carbon dioxide,\nbut every opening can lose water.",
    23,
    serif,
  );
  text(
    "canopy-figure-label",
    "canopy",
    577,
    513,
    351,
    18,
    "PICEA / NEEDLES THAT WORK THROUGH THE WINTER",
    9,
    { fontWeight: 700 },
  );

  // Scene scales compose; the final room is 0.14 * 0.08^5 = 4.58752e-7.
  scene("mushroom", "forest", 770, 485, 0.14);
  chapter(
    "mushroom",
    "02",
    "A PARTNERSHIP IN THE SOIL",
    "Nothing grows\nentirely alone.",
    "Many forest fungi sheath living roots.\nTheir hyphae explore soil for nutrients;\nthe tree supplies photosynthetic carbon.\nThe exchange depends on conditions.",
  );
  ellipse("mushroom-study-disc", "mushroom", 482, 113, 447, 401, C.paper);
  path(
    "mushroom-study-ground",
    "mushroom",
    478,
    500,
    454,
    36,
    "M0 24 Q126 0 234 12 Q367 0 454 25 Q247 36 0 24 Z",
    C.light,
  );
  path(
    "mushroom-study-stem",
    "mushroom",
    679,
    368,
    90,
    164,
    "M23 0 L67 0 Q49 75 85 151 Q45 164 0 151 Q29 73 23 0 Z",
    C.ochre,
  );
  path(
    "mushroom-stem-highlight",
    "mushroom",
    692,
    388,
    31,
    129,
    "M17 0 L28 0 Q16 63 31 125 L0 129 Q17 65 17 0 Z",
    C.cream,
  );
  path(
    "mushroom-study-cap",
    "mushroom",
    466,
    148,
    478,
    260,
    "M0 223 C40 65 126 4 239 4 C366 4 450 74 478 223 Q250 260 0 223 Z",
    C.rust,
  );
  path(
    "mushroom-cap-light",
    "mushroom",
    503,
    172,
    307,
    169,
    "M0 169 Q76 0 213 0 Q262 0 307 23 Q145 1 40 169 Z",
    C.ochre,
    { opacity: 0.45 },
  );
  ellipse("mushroom-gill-bed", "mushroom", 473, 351, 471, 111, C.ochre);
  for (let i = 0; i < 27; i++) {
    const angle = (Math.PI * 2 * i) / 27;
    const px = 235.5 + Math.cos(angle) * 229;
    const py = 55.5 + Math.sin(angle) * 49;
    path(
      `mushroom-radial-gill-${i}`,
      "mushroom",
      473,
      351,
      471,
      111,
      `M235.5 67 Q${(px + 235.5) / 2} ${(py + 67) / 2 - 9} ${px} ${py}`,
      "none",
      { stroke: C.roof, strokeWidth: 1.5, opacity: 0.65 },
    );
  }
  for (let i = 0; i < 9; i++) {
    ellipse(
      `mushroom-cap-mark-${i}`,
      "mushroom",
      577 + ((i * 61) % 242),
      227 + ((i * 29) % 96),
      9 + (i % 4),
      4,
      C.cream,
      { opacity: 0.7 },
    );
  }
  text(
    "mushroom-detail",
    "mushroom",
    56,
    390,
    365,
    104,
    "The mushroom is a moment.\nMost of the fungus is a branching\nbody hidden from view.",
    23,
    serif,
  );
  text(
    "mushroom-gill-note",
    "mushroom",
    784,
    475,
    160,
    32,
    "TURN THE CAP OVER.\nA WORLD OF FOLDS.",
    9,
    { fontWeight: 700 },
  );
  path(
    "mushroom-gill-pointer",
    "mushroom",
    742,
    449,
    35,
    41,
    "M0 0 L12 41 L35 41",
    "none",
    { stroke: C.roof, strokeWidth: 1 },
  );

  scene("gill", "mushroom", 650, 400, 0.08, C.paper);
  chapter(
    "gill",
    "03",
    "ARCHITECTURE OF RELEASE",
    "A thousand\nquiet folds.",
    "Gills pack a large fertile surface\nbeneath a small cap. On these folds,\nmicroscopic basidia form spores.\nA water droplet can set one free.",
  );
  path(
    "gill-section-ground",
    "gill",
    469,
    110,
    475,
    408,
    "M0 32 Q224 0 475 32 L475 408 L0 408 Z",
    C.ochre,
  );
  for (let i = 0; i < 8; i++) {
    const x = 483 + i * 57;
    path(
      `gill-fold-${i}`,
      "gill",
      x,
      134,
      46,
      368,
      "M0 0 Q23 15 46 0 L41 269 Q38 343 23 368 Q6 344 5 269 Z",
      i % 2 ? C.rust : C.roof,
    );
    path(
      `gill-fold-edge-${i}`,
      "gill",
      x + 16,
      154,
      11,
      309,
      "M0 0 Q11 132 6 309",
      "none",
      { stroke: C.cream, strokeWidth: 1.5, opacity: 0.45 },
    );
  }
  path(
    "gill-basidium",
    "gill",
    632,
    349,
    108,
    132,
    "M39 132 L42 81 C0 80 0 22 32 10 Q54 0 79 10 C108 29 106 74 65 81 L70 132 Z",
    C.cream,
  );
  path(
    "gill-sterigmata",
    "gill",
    650,
    330,
    61,
    51,
    "M13 51 Q14 20 0 7 M43 51 Q44 16 61 0",
    "none",
    { stroke: C.cream, strokeWidth: 5 },
  );
  ellipse("gill-attached-spore-left", "gill", 627, 313, 34, 22, C.light);
  ellipse("gill-attached-spore-right", "gill", 705, 306, 34, 22, C.light);
  ellipse("gill-bullers-drop", "gill", 641, 328, 13, 13, C.water, {
    stroke: C.forest,
    strokeWidth: 1,
  });
  for (let i = 0; i < 14; i++) {
    ellipse(
      `gill-free-spore-${i}`,
      "gill",
      503 + ((i * 97) % 407),
      435 + ((i * 31) % 78),
      8,
      5,
      C.cream,
    );
  }
  ellipse("gill-spore-closeup-wall", "gill", 628, 383, 126, 86, C.rust);
  ellipse("gill-spore-closeup-interior", "gill", 634, 389, 114, 74, C.cream);
  ellipse("gill-spore-closeup-drop", "gill", 744, 407, 19, 19, C.water, {
    stroke: C.forest,
    strokeWidth: 1,
  });
  path(
    "gill-spore-closeup-leader",
    "gill",
    744,
    451,
    41,
    35,
    "M0 0 L19 35 L41 35",
    "none",
    { stroke: C.roof, strokeWidth: 1 },
  );
  rect("gill-spore-closeup-caption-paper", "gill", 783, 473, 161, 40, C.cream);
  text(
    "gill-spore-closeup-label",
    "gill",
    792,
    479,
    148,
    29,
    "A SPORE + ITS DROP\nDETAIL ENLARGED",
    9,
    { fontWeight: 700 },
  );
  text(
    "gill-marginalia",
    "gill",
    56,
    401,
    350,
    88,
    "BULLER'S DROP\nSurface tension powers a launch\nacross a microscopic distance.",
    15,
    { color: C.roof, fill: C.roof },
  );
  text(
    "gill-scale-label",
    "gill",
    781,
    523,
    155,
    15,
    "A FERTILE SURFACE / ENLARGED",
    8,
    { fontWeight: 700 },
  );

  scene("spore", "gill", 650, 400, 0.08);
  chapter(
    "spore",
    "04",
    "TRAVELLING WITHOUT A MAP",
    "A beginning,\nborne on air.",
    "A spore clears the gill, then falls\ninto moving air. Most never establish.\nOn a suitable, moist substrate, one\nmay germinate into a new hypha.",
  );
  ellipse("spore-air-disc", "spore", 474, 104, 468, 412, C.paper);
  for (let i = 0; i < 7; i++) {
    path(
      `spore-air-current-${i}`,
      "spore",
      473,
      134 + i * 49,
      471,
      42,
      `M0 ${28 - i * 2} C105 0 169 42 263 20 Q374 0 471 ${12 + i * 3}`,
      "none",
      { stroke: i % 2 ? C.light : C.sage, strokeWidth: 1, opacity: 0.7 },
    );
  }
  path(
    "spore-hero-wall",
    "spore",
    604,
    315,
    210,
    180,
    "M17 42 C61 0 130 0 185 47 C210 84 201 137 150 168 C93 180 21 151 4 103 Q0 65 17 42 Z",
    C.rust,
  );
  path(
    "spore-hero-interior",
    "spore",
    619,
    330,
    181,
    152,
    "M14 37 C55 0 112 0 160 40 C181 77 168 119 129 142 C79 152 18 128 3 88 Q0 56 14 37 Z",
    C.ochre,
  );
  ellipse("spore-cell-window", "spore", 640, 388, 102, 71, C.cream);
  ellipse("spore-nucleus-mark", "spore", 697, 354, 28, 25, C.roof);
  for (let i = 0; i < 12; i++) {
    ellipse(
      `spore-wall-pore-${i}`,
      "spore",
      636 + ((i * 37) % 127),
      348 + ((i * 47) % 104),
      3,
      3,
      C.roof,
      { opacity: 0.65 },
    );
  }
  for (let i = 0; i < 8; i++) {
    ellipse(
      `spore-distant-traveller-${i}`,
      "spore",
      513 + ((i * 73) % 373),
      164 + ((i * 43) % 114),
      12 + (i % 3) * 4,
      8 + (i % 3) * 2,
      i % 2 ? C.rust : C.ochre,
    );
  }
  text(
    "spore-marginalia",
    "spore",
    56,
    401,
    351,
    94,
    "NOT A SEED, BUT A SPORE.\nA small fungal cell, carrying\na possibility rather than a promise.",
    15,
    { color: C.roof, fill: C.roof },
  );
  text(
    "spore-figure-label",
    "spore",
    601,
    520,
    337,
    15,
    "WALL / CYTOPLASM / A POSSIBLE FUTURE",
    9,
    { fontWeight: 700 },
  );

  scene("cell", "spore", 650, 400, 0.08, C.paper);
  chapter(
    "cell",
    "05",
    "THE WORK OF BEING ALIVE",
    "A room that\nbuilds itself.",
    "A fungal wall contains chitin and\nglucans. Beneath it, a membrane\nregulates exchange. With water and\nfuel, a germ tube begins to extend.",
  );
  path(
    "cell-germ-tube-wall",
    "cell",
    781,
    221,
    156,
    119,
    "M0 43 Q52 48 69 10 Q96 0 121 10 Q156 27 145 62 Q118 119 0 113 Z",
    C.forest,
  );
  path(
    "cell-germ-tube-interior",
    "cell",
    789,
    238,
    132,
    88,
    "M0 39 Q60 39 66 8 Q99 0 122 17 Q132 42 109 57 Q58 88 0 81 Z",
    C.light,
  );
  ellipse("cell-wall", "cell", 486, 153, 371, 360, C.forest);
  ellipse("cell-membrane", "cell", 500, 167, 343, 332, C.ochre);
  ellipse("cell-cytoplasm", "cell", 508, 175, 327, 316, C.light);
  ellipse("cell-vacuole", "cell", 549, 213, 130, 111, C.cream, {
    stroke: C.sage,
    strokeWidth: 2,
  });
  ellipse("cell-nuclear-envelope", "cell", 622, 363, 142, 111, C.rust, {
    stroke: C.roof,
    strokeWidth: 2,
  });
  ellipse("cell-nuclear-interior", "cell", 635, 375, 116, 85, C.ochre);
  ellipse("cell-nucleolus", "cell", 688, 391, 32, 29, C.roof);
  for (let i = 0; i < 5; i++) {
    const x = [700, 746, 553, 586, 749][i];
    const y = [225, 302, 354, 427, 416][i];
    ellipse(`cell-mitochondrion-${i}`, "cell", x, y, 42, 23, C.rust);
    path(
      `cell-cristae-${i}`,
      "cell",
      x + 7,
      y + 5,
      27,
      13,
      "M0 7 L5 1 L9 12 L14 0 L18 12 L23 1 L27 7",
      "none",
      { stroke: C.cream, strokeWidth: 1.2 },
    );
  }
  for (let i = 0; i < 24; i++) {
    const angle = i * 2.39996;
    ellipse(
      `cell-ribosome-${i}`,
      "cell",
      667 + Math.cos(angle) * (118 + (i % 4) * 5),
      330 + Math.sin(angle) * (122 + (i % 3) * 5),
      3.5,
      3.5,
      C.forest,
    );
  }
  path(
    "cell-tip-vesicle-route",
    "cell",
    800,
    263,
    98,
    50,
    "M0 50 Q54 45 98 0",
    "none",
    { stroke: C.cream, strokeWidth: 1.5 },
  );
  for (let i = 0; i < 5; i++)
    ellipse(
      `cell-tip-vesicle-${i}`,
      "cell",
      825 + i * 13,
      288 - i * 7,
      7,
      7,
      C.cream,
    );
  text(
    "cell-marginalia",
    "cell",
    56,
    401,
    355,
    94,
    "GROWTH HAPPENS AT THE TIP.\nVesicles deliver new membrane\nand wall-building materials.",
    15,
    { color: C.roof, fill: C.roof },
  );
  text(
    "cell-figure-label",
    "cell",
    590,
    523,
    352,
    15,
    "A GERMINATING SPORE / SCHEMATIC, NOT TO SCALE",
    9,
    { fontWeight: 700 },
  );

  scene("nucleus", "cell", 650, 400, 0.08);
  chapter(
    "nucleus",
    "06",
    "AN ARCHIVE, NOT A BRAIN",
    "Instructions\nwithout a voice.",
    "In this haploid spore, a nucleus holds\none set of chromosomes. DNA carries\ninstructions used to build proteins;\nwhich genes are read can change.",
  );
  ellipse("nucleus-halo", "nucleus", 484, 108, 448, 420, C.paper);
  ellipse("nucleus-envelope", "nucleus", 514, 139, 388, 367, C.roof);
  ellipse("nucleus-inner-envelope", "nucleus", 525, 150, 366, 345, C.ochre);
  ellipse("nucleus-nucleoplasm", "nucleus", 533, 158, 350, 329, C.soil);
  const threads = [
    "M31 35 C150 0 21 167 154 137 S257 226 300 105",
    "M12 147 C69 7 145 34 115 155 S247 288 301 197",
    "M50 244 C2 154 227 230 218 115 S287 48 304 70",
    "M63 25 C8 123 122 76 177 55 S327 130 252 238",
    "M30 200 C153 280 131 116 251 137 S189 32 118 20",
  ];
  threads.forEach((d, i) =>
    path(`nucleus-chromatin-${i}`, "nucleus", 547, 178, 316, 288, d, "none", {
      stroke: i % 2 ? C.rust : C.forest,
      strokeWidth: 3,
      opacity: 0.85,
    }),
  );
  ellipse("nucleus-nucleolus", "nucleus", 743, 232, 72, 66, C.rust);
  ellipse("nucleus-nucleolus-fold", "nucleus", 757, 245, 32, 30, C.roof, {
    opacity: 0.5,
  });
  for (let i = 0; i < 15; i++) {
    const angle = (i / 15) * Math.PI * 2;
    ellipse(
      `nucleus-pore-${i}`,
      "nucleus",
      702 + Math.cos(angle) * 187 - 5,
      321 + Math.sin(angle) * 177 - 5,
      10,
      10,
      C.cream,
      { stroke: C.roof, strokeWidth: 1.5 },
    );
  }
  path(
    "nucleus-archive-thread",
    "nucleus",
    637,
    387,
    111,
    79,
    "M0 17 Q22 0 50 19 T111 19 M0 60 Q22 79 50 58 T111 58",
    "none",
    { stroke: C.forest, strokeWidth: 4 },
  );
  for (let i = 0; i < 8; i++)
    rect(`nucleus-dna-rung-${i}`, "nucleus", 643 + i * 13, 410, 2, 29, C.rust);
  text(
    "nucleus-marginalia",
    "nucleus",
    56,
    401,
    354,
    99,
    "ONE STAGE OF A LARGER CYCLE.\nCompatible hyphae may later carry\npaired nuclei before sexual fusion.",
    15,
    { color: C.roof, fill: C.roof },
  );
  text(
    "nucleus-figure-label",
    "nucleus",
    629,
    523,
    309,
    15,
    "CHROMATIN / DNA WITH ASSOCIATED PROTEINS",
    9,
    { fontWeight: 700 },
  );

  scene("memory", "nucleus", 650, 400, 0.08, C.paper);
  chapter(
    "memory",
    "07",
    "WHAT THE FOREST CARRIES",
    "The future\nhas a past.",
    "DNA passes inherited variation on.\nForests also retain physical legacies:\nseeds in soil, decaying wood, altered\nground. Memory here is a metaphor.",
  );
  ellipse("memory-time-disc", "memory", 489, 103, 435, 427, C.soil);
  for (let i = 0; i < 12; i++) {
    const inset = i * 13;
    ellipse(
      `memory-growth-ring-${i}`,
      "memory",
      507 + inset,
      121 + inset,
      399 - inset * 2,
      391 - inset * 2,
      "none",
      {
        stroke: i % 3 ? C.roof : C.cream,
        strokeWidth: i % 3 ? 1 : 2,
        opacity: 0.6,
      },
    );
  }
  path(
    "memory-ring-check",
    "memory",
    513,
    134,
    365,
    349,
    "M38 0 L93 81 L100 126 M365 187 L256 183 L217 199 M79 349 L115 275 L135 260 M0 142 L78 158",
    "none",
    { stroke: C.roof, strokeWidth: 2 },
  );
  ellipse("memory-seed-bed", "memory", 631, 431, 157, 32, C.roof);
  path(
    "memory-seedling-stem",
    "memory",
    681,
    261,
    63,
    192,
    "M28 192 Q0 104 48 0 M22 120 L0 87 M27 79 L63 48",
    "none",
    { stroke: C.forest, strokeWidth: 5 },
  );
  path(
    "memory-seedling-left",
    "memory",
    595,
    290,
    108,
    72,
    "M108 71 Q15 73 0 0 Q74 0 108 71 Z",
    C.forest,
  );
  path(
    "memory-seedling-right",
    "memory",
    708,
    260,
    128,
    76,
    "M0 76 Q21 0 128 0 Q105 71 0 76 Z",
    C.sage,
  );
  path(
    "memory-seedling-bud",
    "memory",
    707,
    206,
    36,
    79,
    "M12 79 Q0 24 34 0 Q36 46 12 79 Z",
    C.forest,
  );
  path(
    "memory-leaf-veins",
    "memory",
    619,
    285,
    188,
    60,
    "M0 21 L77 60 M91 39 L188 0",
    "none",
    { stroke: C.light, strokeWidth: 1.5 },
  );
  path(
    "memory-seedling-roots",
    "memory",
    666,
    449,
    105,
    55,
    "M45 0 L37 25 L13 48 M39 20 L62 33 L78 55 M45 0 L68 14 L105 20 M37 25 L33 52 M62 33 L49 51 M22 39 L0 40",
    "none",
    { stroke: C.cream, strokeWidth: 2 },
  );
  text(
    "memory-marginalia",
    "memory",
    56,
    401,
    354,
    98,
    "NOT RECOLLECTION. CONTINUITY.\nA fallen tree becomes a nursery.\nThe next forest starts in this one.",
    15,
    { color: C.roof, fill: C.roof },
  );
  text(
    "memory-figure-label",
    "memory",
    593,
    523,
    347,
    15,
    "A SEEDLING ON OLD WOOD / AN ECOLOGICAL LEGACY",
    9,
    { fontWeight: 700 },
  );

  scene("roots", "forest", 500, 600, 0.1, C.paper);
  chapter(
    "roots",
    "08",
    "THE LIVING UNDERGROUND",
    "An exchange,\nnot a promise.",
    "Fine roots and fungal hyphae meet\nin mycorrhizas. Carbon can be traded\nfor mineral nutrients. Networks exist;\nbenefits vary with partner and place.",
  );
  path(
    "roots-soil-profile",
    "roots",
    471,
    190,
    473,
    340,
    "M0 12 Q130 0 249 15 Q386 0 473 11 L473 340 L0 340 Z",
    C.soil,
  );
  path(
    "roots-moss-surface",
    "roots",
    471,
    180,
    473,
    41,
    "M0 20 Q70 0 123 14 Q182 0 240 18 Q295 3 350 13 Q409 0 473 18 L473 41 Q220 23 0 38 Z",
    C.sage,
  );
  rect("roots-tree-trunk", "roots", 649, 97, 54, 116, C.roof);
  path(
    "roots-trunk-fold",
    "roots",
    656,
    97,
    18,
    107,
    "M0 0 L18 0 L13 107 L3 107 Z",
    C.ochre,
    { opacity: 0.5 },
  );
  const rootPaths = [
    "M176 0 Q176 89 100 100 Q38 111 0 196",
    "M198 0 Q211 88 287 124 Q347 158 405 161",
    "M185 0 Q162 95 196 168 Q221 216 171 286",
    "M170 37 Q106 29 76 76 Q51 121 9 112",
    "M209 56 Q270 44 298 75 Q350 92 411 46",
  ];
  rootPaths.forEach((d, i) =>
    path(`roots-woody-root-${i}`, "roots", 497, 199, 425, 293, d, "none", {
      stroke: C.roof,
      strokeWidth: 9 - i * 1.3,
    }),
  );
  for (let i = 0; i < 17; i++) {
    const x = 490 + i * 24;
    const y = 287 + ((i * 47) % 142);
    path(
      `roots-hypha-${i}`,
      "roots",
      x,
      y,
      53,
      83,
      "M27 0 Q5 24 25 42 Q43 67 9 83 M24 37 Q45 23 53 31 M25 44 Q0 41 0 55 M26 66 L49 79",
      "none",
      { stroke: i % 3 ? C.cream : C.rust, strokeWidth: 1.5 },
    );
  }
  path(
    "roots-mantle",
    "roots",
    562,
    299,
    107,
    72,
    "M0 27 Q34 0 80 9 Q107 19 98 45 Q64 72 22 60 Z",
    C.ochre,
    { stroke: C.rust, strokeWidth: 3 },
  );
  for (let i = 0; i < 8; i++) {
    path(
      `roots-mantle-wrap-${i}`,
      "roots",
      574 + i * 10,
      312,
      11,
      44,
      "M2 0 Q11 22 0 44",
      "none",
      { stroke: C.cream, strokeWidth: 2 },
    );
  }
  path(
    "roots-carbon-arrow",
    "roots",
    731,
    223,
    162,
    58,
    "M0 0 Q58 56 162 46 M162 46 L149 36 M162 46 L147 56",
    "none",
    { stroke: C.rust, strokeWidth: 2 },
  );
  text(
    "roots-carbon-label",
    "roots",
    755,
    215,
    164,
    19,
    "CARBON FROM THE TREE",
    9,
    { color: C.roof, fill: C.roof, fontWeight: 700 },
  );
  path(
    "roots-mineral-arrow",
    "roots",
    744,
    428,
    149,
    56,
    "M149 56 Q31 56 0 0 M0 0 L0 15 M0 0 L15 5",
    "none",
    { stroke: C.forest, strokeWidth: 2 },
  );
  text(
    "roots-mineral-label",
    "roots",
    740,
    497,
    200,
    18,
    "NITROGEN / PHOSPHORUS / WATER",
    9,
    { fontWeight: 700 },
  );
  for (let i = 0; i < 23; i++) {
    ellipse(
      `roots-mineral-grain-${i}`,
      "roots",
      486 + ((i * 107) % 443),
      250 + ((i * 61) % 269),
      3,
      3,
      C.roof,
      { opacity: 0.45 },
    );
  }
  text(
    "roots-marginalia",
    "roots",
    56,
    401,
    357,
    98,
    "CONNECTION IS NOT INTENTION.\nA shared fungus does not prove\nthat trees knowingly help each other.",
    15,
    { color: C.roof, fill: C.roof },
  );

  // Append navigation after all illustration so no decorative object covers a hotspot.
  branches(
    "forest",
    [
      ["01 / EXPLORE THE CANOPY", "stop-canopy"],
      ["02 / FOLLOW THE FUNGI", "stop-mushroom"],
    ],
    true,
  );
  branches("canopy", [
    ["01 / LOOK INSIDE A NEEDLE", "stop-canopy-detail"],
    ["02 / FOLLOW THE CARBON BELOW", "stop-roots"],
  ]);
  branches("mushroom", [
    ["01 / ENTER THE GILLS", "stop-gill"],
    ["02 / FOLLOW THE ROOTS", "stop-roots"],
  ]);
  branches("gill", [
    ["01 / FOLLOW A SPORE", "stop-spore"],
    ["02 / RETURN TO THE MUSHROOM", "stop-mushroom"],
  ]);
  branches("spore", [
    ["01 / ENTER THE LIVING CELL", "stop-cell"],
    ["02 / RETURN TO THE GILLS", "stop-gill"],
  ]);
  branches("cell", [
    ["01 / ENTER THE NUCLEUS", "stop-nucleus"],
    ["02 / FOLLOW THE ROOT NETWORK", "stop-roots"],
  ]);
  branches("nucleus", [
    ["01 / DISCOVER WHAT REMAINS", "stop-memory"],
    ["02 / RETURN TO THE CELL", "stop-cell"],
  ]);
  branches("memory", [
    ["01 / REJOIN THE ROOTS", "stop-roots"],
    ["02 / RETURN TO THE FOREST", "stop-return"],
  ]);
  branches("roots", [
    ["01 / WHAT THE FOREST REMEMBERS", "stop-memory"],
    ["02 / RETURN TO THE OVERVIEW", "stop-return"],
  ]);

  const stops = [
    [
      "overview",
      "The Secret Life of a Forest",
      "forest",
      "A forest is more than its trees. Begin with the whole landscape, then descend through six nested worlds to find the living processes hidden inside it.",
      2.6,
    ],
    [
      "canopy",
      "Where Light Becomes Life",
      "canopy",
      "Spruce needles capture light and fix atmospheric carbon into sugars. Respiration uses some; growth and relationships with root-associated fungi use more.",
      2.8,
    ],
    [
      "canopy-detail",
      "The Price of an Open Pore",
      "canopy-detail",
      "Stomata regulate gas exchange. Opening admits carbon dioxide for photosynthesis, but also allows water vapour to escape. A needle balances opportunity with risk.",
      2.2,
    ],
    [
      "mushroom",
      "Choose a Thread",
      "mushroom",
      "This mushroom is a reproductive structure of a much larger fungus. Choose the gills to follow reproduction, or the roots to explore a conditional partnership.",
      2.8,
      true,
    ],
    [
      "mushroom-detail",
      "A Moment Above Ground",
      "mushroom-detail",
      "The visible fruiting body may be brief. The fungus continues as hyphae through its substrate. Many, but not all, forest mushrooms belong to mycorrhizal species.",
      2.2,
    ],
    [
      "gill",
      "The Geometry of Release",
      "gill",
      "Gills multiply spore-bearing surface area. In many gilled fungi, Buller's drop merges with a surface film and launches a spore clear of its basidium; gravity and air take over.",
      2.6,
    ],
    [
      "spore",
      "A Passenger in the Air",
      "spore",
      "Air currents may carry a spore far from its parent. Most spores fail to establish. Moisture, a suitable substrate and the right conditions can turn dispersal into a beginning.",
      2.6,
    ],
    [
      "cell",
      "The Work of a Single Cell",
      "cell",
      "A chitin-and-glucan wall supports the cell; the membrane regulates exchange. As a spore germinates, vesicles supply membrane and wall materials to an extending hyphal tip.",
      2.6,
    ],
    [
      "nucleus",
      "An Archive, Not a Brain",
      "nucleus",
      "Our illustrated spore is haploid. Its nucleus contains chromosomes, not intentions. In many mushroom-forming fungi, compatible hyphae later maintain paired haploid nuclei.",
      2.6,
    ],
    [
      "memory",
      "What the Forest Carries",
      "memory",
      "Inherited DNA and ecological legacies both connect past to future, but in different ways. A nursery log is a physical legacy, not a recollection. Here, memory is a poetic metaphor.",
      2.8,
    ],
    [
      "roots",
      "Choose What Comes Next",
      "roots",
      "Mycorrhizal exchanges depend on species and conditions. Shared fungal connections do not establish deliberate generosity between trees. Follow the idea of memory, or return to the whole forest.",
      3,
      true,
    ],
    [
      "return",
      "The Same Forest, Seen Anew",
      "forest",
      "Return from the smallest room to the tallest tree. Sunlight, soil, fungi and inheritance are not separate stories: they are different scales of this one living place.",
      3,
    ],
  ].map(([id, title, targetId, caption, transition, choice]) => ({
    id: `stop-${id}`,
    title,
    targetId,
    caption,
    transition,
    dwell: 4,
    easing: "gentle",
    ...(choice ? { choice: true } : {}),
  }));

  return {
    version: 1,
    id: "secret-life-of-a-forest",
    name: "The Secret Life of a Forest",
    nodes,
    assets: {
      "asset-field-journal": {
        id: "asset-field-journal",
        name: "Original botanical field-journal postage",
        mime: "image/svg+xml",
        width: 360,
        height: 280,
        dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(botanicalSvg)}`,
      },
    },
    stops,
    links,
    settings: { reducedMotion: false },
  };
}

export function createBlank() {
  return {
    version: 1,
    id: uid("project"),
    name: "Untitled project",
    nodes: [],
    assets: {},
    stops: [],
    links: [],
    settings: { reducedMotion: false },
  };
}
