const paths = {
  sound:
    '<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="m16 9 6 6m0-6-6 6"/>',
  save: '<path d="M5 3h12l3 3v15H4V3h1Z"/><path d="M8 3v6h8V3M8 21v-8h8v8"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.8 7M3 4v7h7"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  play: '<path d="m8 4 12 8-12 8V4Z" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 3m0 3v.1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  headphones:
    '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12h3v9H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm16 0h-3v9h3a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2Z"/>',
  water:
    '<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0C19 10 12 2 12 2Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  hand: '<path d="M8 12V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v10c0 5-3 7-7 7-3 0-5-2-7-5l-4-5a2 2 0 0 1 3-2l3 3"/>',
  move: '<path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  leaf: '<path d="M20 3C9 2 3 8 5 14c2 6 14 7 15-11ZM4 21 15 10"/>',
};
export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.help}</svg>`;
}

export function toolArt(name) {
  const body = {
    loop: '<path d="M35 42 50 19c4-6 16-4 17 1 1 7-11 17-16 21l-8 5" fill="none" stroke="#b8bbb5" stroke-width="3"/><path d="m17 65 24-30 9 7-22 32c-4 6-16-2-11-9Z" fill="url(#wood-loop)"/><path d="m38 40 5-6 9 7-5 6" fill="#a7aaa3"/><path d="m22 65 19-25" stroke="#c39873" opacity=".5"/>',
    rib: '<path d="M21 60c-4-13 4-34 18-42 10-6 23-2 25 6 3 9-4 28-16 38-12 10-24 8-27-2Z" fill="url(#wood-rib)"/><path d="M26 59c-3-11 5-31 17-38" stroke="#c5a180" opacity=".55"/><ellipse cx="43" cy="43" rx="4" ry="6" transform="rotate(32 43 43)" fill="#58483c"/><path d="M50 20c9 1 8 9 7 14" stroke="#d1ad89" opacity=".4"/>',
    needle:
      '<path d="m40 39 24-29" stroke="#bfc0b6" stroke-width="2"/><path d="m19 65 20-30 9 7-21 30c-4 5-13-2-8-7Z" fill="url(#wood-needle)"/><path d="m38 38 4-5 7 6-3 5" fill="#a6aaa4"/><path d="m24 64 16-23" stroke="#cba37a" opacity=".4"/>',
    sponge:
      '<path d="M20 38c3-12 16-19 29-15 12 3 20 11 16 22-4 13-17 24-30 20-13-3-18-14-15-27Z" fill="#b69b69"/><path d="M21 37c7 9 21 14 38 7" fill="none" stroke="#d7bd84" stroke-width="10"/><g fill="#75623d" opacity=".6"><circle cx="30" cy="35" r="2"/><circle cx="44" cy="30" r="2.5"/><circle cx="53" cy="37" r="2"/><circle cx="27" cy="48" r="2.4"/><circle cx="38" cy="55" r="2"/><circle cx="51" cy="51" r="2.5"/><circle cx="39" cy="41" r="1.8"/><circle cx="58" cy="43" r="1.4"/><circle cx="31" cy="58" r="1.5"/></g>',
  };
  return `<svg class="tool-art" viewBox="0 0 84 84" aria-hidden="true"><defs><linearGradient id="wood-${name}" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="#684a34"/><stop offset=".5" stop-color="#ae8057"/><stop offset="1" stop-color="#735138"/></linearGradient></defs>${body[name]}</svg>`;
}
