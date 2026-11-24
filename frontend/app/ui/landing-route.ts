/** Geometry of the landing ribbon. Pure: DOM boxes come in, document points come out. */
export type Box = { l: number; t: number; r: number; b: number };
export type LandingBoxes = {
  width: number;
  height: number;
  viewport: number;
  /** Visible sections in document order. */
  sections: { kind: string; box: Box; parts: Record<string, Box>; list: Box[] }[];
  /** Text and links that neither the bird nor the desktop ribbon may cross. */
  text: Box[];
};
export type RoutePoint = {
  length: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** 0 next to text: the desktop ribbon disappears there and the phone one turns pale. */
  ribbon: number;
  bird: number;
};
export type Route = {
  points: RoutePoint[];
  total: number;
  intro: number;
  /** Length at which each approach marker is reached. */
  markers: number[];
  /** Scroll position to ribbon length, both non-decreasing. */
  stops: [scroll: number, length: number][];
  mobile: boolean;
};
type Anchor = [x: number, y: number, mark?: string];

export const ribbonWidth = (mobile: boolean) => (mobile ? 11 : 24);
export const ribbonSway = (mobile: boolean) => (mobile ? 2.5 : 5);
/** Keeps text above 4.5:1 where the phone ribbon runs under it. */
export const ribbonAlpha = (mobile: boolean, clear: number) => (mobile ? 0.2 + 0.55 * clear : 0.92);
export const ribbonColors = ['#ecd8a6', '#cfa95f'] as const;
export const birdRadius = (mobile: boolean) => (mobile ? 20 : 34);
const STEP = 7;
const cx = (b: Box) => (b.l + b.r) / 2;
const cy = (b: Box) => (b.t + b.b) / 2;

function desktop(w: number, kind: string, b: Box, p: Record<string, Box>, list: Box[]): Anchor[] {
  if (kind === 'hero' && p.photo) {
    const f = p.photo;
    return [
      [w + 80, b.t + 20],
      [cx(f), f.t - 62],
      [f.l - 34, f.t + (f.b - f.t) * 0.3],
      [f.l + 40, f.b + 34],
      [cx(f), f.b + 66, 'intro'],
      [f.r + 10, f.b + 40],
    ];
  }
  if (kind === 'approach' && list.length === 3) {
    const [one, two, three] = list;
    const arc = one.t - 58;
    return [
      [w - 90, b.t + 120],
      [w * 0.72, b.t + 210],
      [w * 0.64, b.t + 120],
      [w * 0.7, b.t + 60],
      [w * 0.78, b.t + 170],
      [w * 0.5, one.t - 84],
      [one.l - 48, one.t - 44],
      [one.l - 34, one.b],
      [cx(one), cy(one), 'marker'],
      [(cx(one) + cx(two)) / 2, arc],
      [cx(two), cy(two), 'marker'],
      [(cx(two) + cx(three)) / 2, arc],
      [cx(three), cy(three), 'marker'],
      [w - 50, three.b + 10],
    ];
  }
  if (kind === 'ages' && p.art)
    return [
      [w - 34, b.t + 60],
      [cx(p.art), p.art.t - 30],
      [p.art.l - 34, cy(p.art)],
      [p.art.l + 20, p.art.b + 34],
      [cx(p.art), p.art.b + 30],
    ];
  if (kind === 'formats' && p.list) {
    const y = p.intro ? cy(p.intro) : b.t + 120;
    return [
      [w - 60, b.t + 60],
      [w * 0.76, y + 10],
      [w * 0.66, y - 50],
      [w * 0.72, b.t + 70],
      [w * 0.8, y + 40],
      [w * 0.5, p.list.t + 30],
      [26, p.list.t + 110],
      [24, p.list.b - 60],
      [26, b.b - 30],
    ];
  }
  if (kind === 'prices' && p.intro && p.list) {
    const x = p.list.l;
    const y = p.intro.b;
    return [
      [28, y - 60],
      [p.intro.l + 20, y + 90],
      [x * 0.55, y + 130],
      [x * 0.72, y + 70],
      [x * 0.6, y + 56],
      [x * 0.56, y + 150],
      [x * 0.9, b.b - 40],
    ];
  }
  if (kind === 'schedule')
    return [
      [w * 0.82, b.t + 90],
      [w - 52, b.t + (b.b - b.t) * 0.3],
      [w - 52, b.b - 130],
      [w * 0.8, b.b - 36],
    ];
  if (kind === 'visit')
    return [
      [w * 0.66, b.t + 70],
      [w * 0.6, cy(b)],
      [w * 0.7, b.b - 70],
      [w * 0.82, cy(b) - 10],
      [w * 0.72, b.t + 80],
      [w * 0.55, b.b - 40],
    ];
  if (kind === 'coach' && p.photo)
    return [
      [w * 0.25, b.t + 30],
      [p.photo.l - 38, cy(p.photo)],
      [cx(p.photo), p.photo.b + 46],
      [w * 0.62, b.b - 40],
    ];
  if (kind === 'faq')
    return [
      [w - 46, b.t + 60],
      [w - 34, cy(b)],
      [w - 44, b.b - 130],
      [w * 0.76, b.b - 50],
      [w * 0.55, b.b - 44],
    ];
  if (kind === 'contacts' && p.button) {
    const a = p.button;
    return [
      [w * 0.3, b.t + 40],
      [a.l - 56, a.t - 50],
      [a.l - 40, cy(a)],
      [cx(a), cy(a) + 6],
      [a.r + 60, cy(a)],
      [a.r + 40, a.t - 40],
      [a.r - 4, a.t - 44, 'end'],
    ];
  }
  return [
    [w - 34, b.t + 40],
    [w - 34, b.b - 40],
  ];
}

function phone(
  w: number,
  kind: string,
  b: Box,
  p: Record<string, Box>,
  list: Box[],
  left: boolean,
): Anchor[] {
  if (kind === 'hero' && p.photo && p.button)
    return [
      [w + 50, b.t + 10],
      [w * 0.55, b.t + 26],
      [14, p.photo.t - 60],
      [p.photo.l + 10, p.photo.t - 18],
      [cx(p.photo), p.photo.t + 10],
      [w - 8, p.photo.t + 40],
      [w - 9, p.photo.b + 10],
      [w - 10, Math.max(p.photo.b + 20, p.button.t - 40)],
      [Math.max(w - 48, Math.min(w - 26, p.button.r + 28)), cy(p.button), 'intro'],
      [w * 0.5, b.b - 24],
    ];
  if (kind === 'approach' && list.length) {
    const points: Anchor[] = [[14, b.t + 34]];
    list.forEach((n, i) => {
      const next = list[i + 1];
      points.push(
        [8, n.t - 30],
        [cx(n), cy(n), 'marker'],
        [w * 0.6, cy(n) - 12],
        [w - 10, cy(n) + 30],
        [w - 10, next ? next.t - 70 : b.b - 40],
      );
    });
    return points;
  }
  if (kind === 'ages' && p.art)
    return [
      [w * 0.5, b.t + 14],
      [10, b.t + 120],
      [10, p.art.t - 40],
      [w * 0.5, p.art.b + 22],
      [w - 10, b.b - 20],
    ];
  if (kind === 'contacts' && p.button) {
    const a = p.button;
    return [
      [10, b.t + 60],
      [10, a.t - 30],
      [a.l - 10, cy(a)],
      [cx(a), cy(a) + 6],
      [Math.min(w - 26, a.r + 34), cy(a), 'end'],
    ];
  }
  const near = left ? 11 : w - 11;
  const far = left ? w * 0.7 : w * 0.3;
  return [
    [w * 0.5, b.t + 14],
    [near, b.t + (b.b - b.t) * 0.3],
    [near, b.t + (b.b - b.t) * 0.7],
    [w * 0.5, b.b - 40],
    [far, b.b - 14],
  ];
}

function distance(x: number, y: number, b: Box) {
  return Math.hypot(Math.max(b.l - x, 0, x - b.r), Math.max(b.t - y, 0, y - b.b));
}

export function buildRoute(input: LandingBoxes): Route | null {
  const { width: w, viewport } = input;
  const mobile = w <= 850;
  const anchors: Anchor[] = [];
  input.sections.forEach(({ kind, box, parts, list }, i) =>
    anchors.push(
      ...(mobile
        ? phone(w, kind, box, parts, list, i % 2 === 0)
        : desktop(w, kind, box, parts, list)),
    ),
  );
  if (anchors.length < 3) return null;

  // Centripetal Catmull–Rom: no cusps or loops between unevenly spaced anchors.
  const at = (i: number) => anchors[Math.max(0, Math.min(anchors.length - 1, i))];
  const raw: [number, number][] = [];
  const marks: number[] = [];
  const knot = (p: Anchor, q: Anchor) =>
    Math.max(1e-3, Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1])));
  const mix = (
    p: readonly number[],
    q: readonly number[],
    from: number,
    to: number,
    t: number,
  ): [number, number] => {
    const k = (t - from) / (to - from);
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  };
  for (let i = 0; i < anchors.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const t1 = knot(a, b);
    const t2 = t1 + knot(b, c);
    const t3 = t2 + knot(c, d);
    marks.push(raw.length);
    for (let j = 0; j < 40; j++) {
      const t = t1 + ((t2 - t1) * j) / 40;
      const ab = mix(a as number[], b as number[], 0, t1, t);
      const bc = mix(b as number[], c as number[], t1, t2, t);
      const cd = mix(c as number[], d as number[], t2, t3, t);
      raw.push(mix(mix(ab, bc, 0, t2, t), mix(bc, cd, t1, t3, t), t1, t2, t));
    }
  }
  marks.push(raw.length);
  const tail = anchors[anchors.length - 1];
  raw.push([tail[0], tail[1]]);
  const along = [0];
  for (let i = 1; i < raw.length; i++)
    along.push(along[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = along[along.length - 1];
  const points: RoutePoint[] = [];
  for (let length = 0, i = 0; length < total; length += STEP) {
    while (along[i + 1] < length) i++;
    const k = (length - along[i]) / (along[i + 1] - along[i] || 1);
    points.push({
      length,
      x: raw[i][0] + (raw[i + 1][0] - raw[i][0]) * k,
      y: raw[i][1] + (raw[i + 1][1] - raw[i][1]) * k,
      nx: 0,
      ny: 0,
      ribbon: 1,
      bird: 1,
    });
  }
  // Text always wins: the desktop ribbon and the bird fade out before reaching it.
  const half = ribbonWidth(mobile) / 2 + ribbonSway(mobile);
  const bird = birdRadius(mobile);
  const reach = bird + 40;
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const size = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    p.nx = -(b.y - a.y) / size;
    p.ny = (b.x - a.x) / size;
    let near = Infinity;
    for (const box of input.text) {
      if (box.t > p.y + reach || box.b < p.y - reach) continue;
      near = Math.min(near, distance(p.x, p.y, box));
    }
    p.ribbon = Math.max(0, Math.min(1, (near - half) / 14));
    p.bird = Math.max(0, Math.min(1, (near - bird) / 16));
  });

  const lengths = anchors.map((_, i) => along[marks[i]]);
  const first = Math.max(
    0,
    anchors.findIndex((a) => a[2] === 'intro'),
  );
  const stops: [number, number][] = [[0, lengths[first]]];
  for (let i = first + 1; i < anchors.length; i++) {
    const travel = lengths[i] - lengths[i - 1];
    stops.push([
      Math.max(stops[stops.length - 1][0] + travel * 0.05, anchors[i][1] - viewport * 0.6),
      lengths[i],
    ]);
  }
  let limit = Math.max(1, input.height - viewport - 6);
  for (let i = stops.length - 1; i > 0; i--) {
    const anchor = anchors[first + i];
    // Long sideways stretches must not make the ribbon late for a marker.
    const due = anchor[2] === 'marker' ? anchor[1] - viewport * 0.5 : Infinity;
    stops[i][0] = Math.min(stops[i][0], limit, due);
    limit =
      stops[i][0] - Math.min((stops[i][1] - stops[i - 1][1]) * 0.05, Math.max(0, limit) / (i + 1));
  }
  return {
    points,
    total,
    intro: lengths[first],
    markers: anchors.flatMap((a, i) => (a[2] === 'marker' ? [lengths[i]] : [])),
    stops,
    mobile,
  };
}

export function lengthAt(route: Route, scroll: number) {
  const { stops } = route;
  for (let i = 1; i < stops.length; i++) {
    const [to, b] = stops[i];
    if (scroll > to) continue;
    const [from, a] = stops[i - 1];
    return a + (b - a) * Math.max(0, Math.min(1, (scroll - from) / (to - from || 1)));
  }
  return route.total;
}

/** Boxes relative to `main`. Must stay self-contained: browser tests run it inside the page. */
export function collectBoxes(main: HTMLElement): LandingBoxes {
  const origin = main.getBoundingClientRect();
  const box = (r: DOMRect): Box => ({
    l: r.left - origin.left,
    t: r.top - origin.top,
    r: r.right - origin.left,
    b: r.bottom - origin.top,
  });
  const kinds: [string, string][] = [
    ['landing-hero', 'hero'],
    ['landing-approach', 'approach'],
    ['landing-ages', 'ages'],
    ['landing-formats', 'formats'],
    ['landing-prices', 'prices'],
    ['public-schedule', 'schedule'],
    ['landing-visit', 'visit'],
    ['landing-coach', 'coach'],
    ['landing-faq', 'faq'],
    ['landing-contacts', 'contacts'],
  ];
  const named: Record<string, string> = {
    photo: 'figure',
    intro: '.landing-section-intro',
    list: '.landing-formats-list, .landing-price-list',
    art: '.ages-art',
    button: '.button',
  };
  const sections = Array.from(main.children)
    .filter((el) => el.tagName === 'SECTION')
    .map((el) => {
      const parts: Record<string, Box> = {};
      for (const [name, selector] of Object.entries(named)) {
        const found = el.querySelector(selector);
        if (found) parts[name] = box(found.getBoundingClientRect());
      }
      // A section narrower than the page (the schedule) still spans the whole ribbon field.
      return {
        kind: kinds.find(([name]) => el.classList.contains(name))?.[1] ?? 'other',
        box: box(el.getBoundingClientRect()),
        parts,
        list: Array.from(el.querySelectorAll('.approach-grid .number')).map((n) =>
          box(n.getBoundingClientRect()),
        ),
      };
    });
  const text: Box[] = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const seen = new Set<Element>();
  const add = (r: DOMRect) => {
    if (r.width > 1 && r.height > 1) text.push(box(r));
  };
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim()) continue;
    // Opaque surfaces cover the ribbon, so it may pass behind them.
    if (parent.closest('noscript, .number, .poster-card, .poster-day, .button, .visually-hidden'))
      continue;
    // Closed answers keep their boxes in some browsers although nothing is painted.
    if (!parent.closest('summary') && parent.closest('details:not([open])')) continue;
    // Words may be shifted inside their mask during a reveal; the mask itself never moves.
    const word = parent.closest('.word');
    if (word) {
      if (!seen.has(word)) add(word.getBoundingClientRect());
      seen.add(word);
      continue;
    }
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) add(r);
  }
  return {
    width: main.clientWidth,
    height: document.documentElement.scrollHeight - (origin.top + scrollY),
    viewport: innerHeight,
    sections,
    text,
  };
}
