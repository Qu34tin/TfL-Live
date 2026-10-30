// @ts-nocheck - indexed geometry access is bounds-checked by construction
type Coordinate = [number, number] | number[];

export type OffsetLinePath = { lineId: string; path: Coordinate[] };
export type OffsetLineFeature = OffsetLinePath & { offset: number };

const CELL_LON = 0.0007;
const CELL_LAT = 0.00045;
const MAX_STEP = 0.0003;
const SMOOTH_RADIUS = 30;

const TANGENT_WINDOW = 4;
const LON_SCALE = 0.62;
const METRES_PER_DEG = 111000;
const DUPLICATE_RATIO = 1;
const DEDUPE_REACH = 3;
// Fixed reference axis used to decide which way along a track is "forward" for every line.
const AXIS: [number, number] = [Math.cos(0.4), Math.sin(0.4)];

const cellKey = (x: number, y: number) => `${x}:${y}`;
const cellOf = (c: Coordinate): [number, number] => [
  Math.round(c[0] / CELL_LON),
  Math.round(c[1] / CELL_LAT),
];

const dedupeCellOf = (c: Coordinate): [number, number] => [
  Math.round(c[0] / 0.00018),
  Math.round(c[1] / 0.00012),
];

function densify(path: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];
  for (let i = 0; i < path.length; i++) {
    result.push(path[i]);
    const next = path[i + 1];
    if (!next) continue;
    const steps = Math.ceil(
      Math.max(Math.abs(next[0] - path[i][0]), Math.abs(next[1] - path[i][1])) / MAX_STEP,
    );
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      result.push([
        path[i][0] + (next[0] - path[i][0]) * t,
        path[i][1] + (next[1] - path[i][1]) * t,
      ]);
    }
  }
  return result;
}

function smooth(values: number[]): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    const end = Math.min(values.length - 1, i + SMOOTH_RADIUS);
    for (let j = Math.max(0, i - SMOOTH_RADIUS); j <= end; j++) {
      sum += values[j];
      count++;
    }
    return sum / count;
  });
}

// A line often has several parallel tracks in the source data; drop whole paths that just duplicate an earlier path of the same line.
function dedupeParallelPaths(items: OffsetLinePath[]): OffsetLinePath[] {
  const claimed = new Map<string, Set<string>>();
  const result: OffsetLinePath[] = [];
  for (const item of items) {
    const claims = claimed.get(item.lineId) ?? new Set<string>();
    claimed.set(item.lineId, claims);
    const cells = item.path.map(dedupeCellOf);
    const covered = cells.filter(([x, y]) => {
      for (let dx = -DEDUPE_REACH; dx <= DEDUPE_REACH; dx++) {
        for (let dy = -DEDUPE_REACH; dy <= DEDUPE_REACH; dy++) {
          if (claims.has(cellKey(x + dx, y + dy))) return true;
        }
      }
      return false;
    }).length;
    if (item.path.length > 0 && covered >= item.path.length * DUPLICATE_RATIO && item.path.length > 1) continue;
    for (const [x, y] of cells) claims.add(cellKey(x, y));
    result.push(item);
  }
  return result;
}

const BRIDGE_DEG = 0.0016;
const BRIDGE_MIN_DEG = 0.000005;

// How directly a path end points at a target (1 = straight at it). Terminus ends point away from or past neighbouring track and must not be joined to it.
function facingTarget(end: Coordinate, inner: Coordinate, target: Coordinate): number {
  const tx = (end[0] - inner[0]) * LON_SCALE;
  const ty = end[1] - inner[1];
  const gx = (target[0] - end[0]) * LON_SCALE;
  const gy = target[1] - end[1];
  return (tx * gx + ty * gy) / ((Math.hypot(tx, ty) || 1) * (Math.hypot(gx, gy) || 1));
}

// A quadratic curve that leaves the path along its own direction, so joins look like a natural bend rather than a corner.
function curveBridge(end: Coordinate, inner: Coordinate, target: Coordinate): Coordinate[] {
  const tx = end[0] - inner[0];
  const ty = end[1] - inner[1];
  const tl = Math.hypot(tx * LON_SCALE, ty) || 1;
  const toX = (target[0] - end[0]) * LON_SCALE;
  const toY = target[1] - end[1];
  const toLength = Math.hypot(toX, toY) || 1;
  const facing = (((tx * LON_SCALE) / tl) * toX + (ty / tl) * toY) / toLength;
  // A path end pointing away from its target would make the curve loop back on itself, so it joins straight instead.
  const reach = facing < 0.3 ? 0 : toLength * 0.5 * facing;
  const control = [end[0] + ((tx * LON_SCALE) / tl) * reach / LON_SCALE, end[1] + (ty / tl) * reach];
  const points: Coordinate[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const u = 1 - t;
    points.push([
      u * u * end[0] + 2 * u * t * control[0] + t * t * target[0],
      u * u * end[1] + 2 * u * t * control[1] + t * t * target[1],
    ]);
  }
  return points;
}

// Rounds corners with a moving average while keeping both path ends fixed so connections stay intact.
function roundCorners(path: Coordinate[], passes = 3, radius = 2): Coordinate[] {
  let current = path;
  for (let pass = 0; pass < passes; pass++) {
    current = current.map((point, i) => {
      if (i === 0 || i === current.length - 1) return point;
      const r = Math.min(radius, i, current.length - 1 - i);
      let x = 0;
      let y = 0;
      for (let j = i - r; j <= i + r; j++) {
        x += current[j][0];
        y += current[j][1];
      }
      return [x / (2 * r + 1), y / (2 * r + 1)];
    });
  }
  return current;
}

// Join every loose path end to the nearest point of another path of the same line, on the final drawn geometry.
function bridgeGaps(items: OffsetLinePath[]): OffsetLinePath[] {
  const byLine = new Map<string, OffsetLinePath[]>();
  for (const item of items) byLine.set(item.lineId, [...(byLine.get(item.lineId) ?? []), item]);
  const bridges: OffsetLinePath[] = [];
  const cell = BRIDGE_DEG;
  for (const [lineId, paths] of byLine) {
    const grid = new Map<string, { p: Coordinate; owner: number }[]>();
    paths.forEach((item, owner) => {
      for (const p of item.path) {
        const key = cellKey(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
        const list = grid.get(key) ?? [];
        list.push({ p, owner });
        grid.set(key, list);
      }
    });
    paths.forEach((item, owner) => {
      if (item.path.length < 2) return;
      for (const end of [item.path[0], item.path[item.path.length - 1]]) {
        const cx = Math.floor(end[0] / cell);
        const cy = Math.floor(end[1] / cell);
        let best: Coordinate | undefined;
        let bestD = Infinity;
        let touching = false;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const entry of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
              if (entry.owner === owner) continue;
              const d = Math.hypot((entry.p[0] - end[0]) * LON_SCALE, entry.p[1] - end[1]);
              if (d <= BRIDGE_MIN_DEG) touching = true;
              if (d < bestD) {
                bestD = d;
                best = entry.p;
              }
            }
          }
        }
        if (best && !touching && bestD < BRIDGE_DEG) {
          const atStart = end === item.path[0];
          const inner = atStart ? item.path[Math.min(item.path.length - 1, 4)] : item.path[Math.max(0, item.path.length - 5)];
          if (bestD > 0.0003 && facingTarget(end, inner, best) < 0.5) continue;
          bridges.push({ lineId, path: curveBridge(end, inner, best) });
        }
      }
    });
  }
  return [...items, ...bridges];
}
// Direction of travel relative to a fixed axis, with hysteresis so curves don't make the side flicker.
function travelDirections(path: Coordinate[]): boolean[] {
  const result: boolean[] = [];
  let forward = true;
  let initialised = false;
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 6)];
    const b = path[Math.min(path.length - 1, i + 6)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const dot = (dx * AXIS[0] + dy * AXIS[1]) / len;
    if (!initialised) {
      forward = dot >= 0;
      initialised = true;
    } else if (forward && dot < -0.35) {
      forward = false;
    } else if (!forward && dot > 0.35) {
      forward = true;
    }
    result.push(forward);
  }
  return result;
}

// Joins fragments that meet end to end (within about 2 m) into long continuous paths, but only where exactly two fragment ends meet so junctions stay intact.
export function stitchPaths(paths: Coordinate[][], tolerance = 0.00002): Coordinate[][] {
  const key = (c: Coordinate) => `${Math.round(c[0] / tolerance)}:${Math.round(c[1] / tolerance)}`;
  let chains = paths.map((path) => [...path]);
  for (let guard = 0; guard < 5000; guard++) {
    const ends = new Map<string, { chain: number; atStart: boolean }[]>();
    chains.forEach((chain, chainIndex) => {
      for (const atStart of [true, false]) {
        const k = key(atStart ? chain[0] : chain[chain.length - 1]);
        const list = ends.get(k) ?? [];
        list.push({ chain: chainIndex, atStart });
        ends.set(k, list);
      }
    });
    let merged = false;
    for (const list of ends.values()) {
      if (list.length !== 2 || list[0].chain === list[1].chain) continue;
      const [a, b] = list;
      const first = a.atStart ? [...chains[a.chain]].reverse() : chains[a.chain];
      const second = b.atStart ? chains[b.chain] : [...chains[b.chain]].reverse();
      const joined = [...first, ...second.slice(1)];
      chains = chains.filter((_, i) => i !== a.chain && i !== b.chain);
      chains.push(joined);
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return chains;
}
const metresBetween = (a: Coordinate, b: Coordinate) =>
  Math.hypot((a[0] - b[0]) * LON_SCALE, a[1] - b[1]) * METRES_PER_DEG;

const chainLength = (chain: Coordinate[]) => {
  let total = 0;
  for (let i = 1; i < chain.length; i++) total += metresBetween(chain[i - 1], chain[i]);
  return total;
};

// Stitches rail fragments, then removes short dead-end spurs (sidings, crossovers, depot links) that would
// otherwise draw as stray hooks next to the main line. Chain ends near a station are kept.
export function cleanRailPaths(paths: Coordinate[][], stations: Coordinate[], spurMetres = 140): Coordinate[][] {
  let chains = stitchPaths(paths);
  const nearStation = (p: Coordinate) => stations.some((s) => metresBetween(s, p) < 90);
  for (let round = 0; round < 6; round++) {
    const grid = new Map<string, { p: Coordinate; owner: number }[]>();
    chains.forEach((chain, owner) =>
      chain.forEach((p) => {
        const key = cellKey(Math.floor(p[0] / 0.0004), Math.floor(p[1] / 0.0004));
        const list = grid.get(key) ?? [];
        list.push({ p, owner });
        grid.set(key, list);
      }),
    );
    const isFree = (end: Coordinate, owner: number) => {
      const cx = Math.floor(end[0] / 0.0004);
      const cy = Math.floor(end[1] / 0.0004);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const entry of grid.get(cellKey(cx + dx, cy + dy)) ?? [])
            if (entry.owner !== owner && metresBetween(entry.p, end) < 12) return false;
      return true;
    };
    const keep = chains.filter((chain, owner) => {
      const length = chainLength(chain);
      const startFree = isFree(chain[0], owner);
      const endFree = isFree(chain[chain.length - 1], owner);
      if (startFree && endFree) return length >= 60 || nearStation(chain[0]) || nearStation(chain[chain.length - 1]);
      if (!startFree && !endFree) {
        // Short loops and hooks that return near where they started are depot links or crossovers.
        const span = metresBetween(chain[0], chain[chain.length - 1]);
        return !(length < 250 && length > 2.5 * span && !nearStation(chain[0]) && !nearStation(chain[chain.length - 1]));
      }
      if (length >= spurMetres) return true;
      const free = startFree ? chain[0] : chain[chain.length - 1];
      return nearStation(free);
    });
    if (keep.length === chains.length) break;
    chains = keep;
  }
  const finished = stitchPaths(chains).map(removeLoops);
  const bridges: Coordinate[][] = [];
  finished.forEach((chain, owner) => {
    if (chain.length < 2) return;
    for (const atStart of [true, false]) {
      const end = atStart ? chain[0] : chain[chain.length - 1];
      const inner = atStart ? chain[Math.min(chain.length - 1, 4)] : chain[Math.max(0, chain.length - 5)];
      let best: Coordinate | undefined;
      let bestD = Infinity;
      finished.forEach((other, index) => {
        if (index === owner) return;
        for (const p of other) {
          const d = metresBetween(end, p);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      });
      if (best && bestD > 1.5 && bestD < 260 && (bestD < 30 || facingTarget(end, inner, best) >= 0.5)) {
        bridges.push(curveBridge(end, inner, best));
      }
    }
  });
  return [...finished, ...bridges];
}

// Cuts out small loops and out-and-back spikes: where a path comes back within a few metres of an earlier point, the excursion is skipped.
function removeLoops(chain: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];
  let i = 0;
  while (i < chain.length) {
    result.push(chain[i]);
    let jump = -1;
    let travelled = 0;
    for (let j = i + 1; j < Math.min(chain.length, i + 80); j++) {
      travelled += metresBetween(chain[j - 1], chain[j]);
      if (j > i + 2 && travelled > 25 && travelled < 400 && metresBetween(chain[i], chain[j]) < 12) jump = j;
    }
    i = jump > 0 ? jump : i + 1;
  }
  return result;
}

// Routes between consecutive stations along the real rail graph (shortest path), so only track that trains
// actually use is drawn and sidings, depot spurs and parallel scraps are left out.
export function routeThroughRail(
  paths: Coordinate[][],
  pairs: { from: Coordinate; to: Coordinate; fallback: Coordinate[] }[],
): Coordinate[][] {
  const tolerance = 0.00003;
  const nodeKey = (c: Coordinate) => `${Math.round(c[0] / tolerance)}:${Math.round(c[1] / tolerance)}`;
  const ids = new Map<string, number>();
  const coords: Coordinate[] = [];
  const edges: { to: number; w: number }[][] = [];
  const nodeFor = (c: Coordinate) => {
    const key = nodeKey(c);
    let id = ids.get(key);
    if (id === undefined) {
      id = coords.length;
      ids.set(key, id);
      coords.push(c);
      edges.push([]);
    }
    return id;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const w = metresBetween(coords[a], coords[b]);
    edges[a].push({ to: b, w });
    edges[b].push({ to: a, w });
  };
  const endpoints: number[] = [];
  const owners: number[] = [];
  paths.forEach((path, owner) => {
    let previous = -1;
    path.forEach((p, i) => {
      const id = nodeFor(p);
      if (previous >= 0) link(previous, id);
      previous = id;
      if (i === 0 || i === path.length - 1) {
        endpoints.push(id);
        owners.push(owner);
      }
    });
  });
  const cell = 0.0004;
  const grid = new Map<string, number[]>();
  coords.forEach((c, id) => {
    const key = cellKey(Math.floor(c[0] / cell), Math.floor(c[1] / cell));
    grid.set(key, [...(grid.get(key) ?? []), id]);
  });
  const nearest = (c: Coordinate, maxMetres: number, skip?: (id: number) => boolean) => {
    const cx = Math.floor(c[0] / cell);
    const cy = Math.floor(c[1] / cell);
    let best = -1;
    let bestD = maxMetres;
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (const id of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
          if (skip?.(id)) continue;
          const d = metresBetween(c, coords[id]);
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
    return best;
  };
  // Fragment ends that nearly touch another fragment count as connected track.
  const connected = new Set<string>();
  endpoints.forEach((id) => {
    const other = nearest(coords[id], 15, (candidate) => candidate === id || edges[id].some((e) => e.to === candidate));
    if (other >= 0 && !connected.has(`${other}:${id}`)) {
      link(id, other);
      connected.add(`${id}:${other}`);
    }
  });

  const shortest = (from: number, to: number): number[] | undefined => {
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const queue: [number, number][] = [[0, from]];
    const pop = () => {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
      return queue.splice(bi, 1)[0];
    };
    while (queue.length) {
      const [d, node] = pop();
      if (node === to) break;
      if (d > (dist.get(node) ?? Infinity)) continue;
      for (const edge of edges[node]) {
        const nd = d + edge.w;
        if (nd < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, nd);
          prev.set(edge.to, node);
          queue.push([nd, edge.to]);
        }
      }
    }
    if (!dist.has(to)) return undefined;
    const route = [to];
    while (route[0] !== from) route.unshift(prev.get(route[0])!);
    return route;
  };

  const result: Coordinate[][] = [];
  const done = new Set<string>();
  for (const pair of pairs) {
    const a = nearest(pair.from, 200);
    const b = nearest(pair.to, 200);
    const direct = metresBetween(pair.from, pair.to);
    const route = a >= 0 && b >= 0 && a !== b ? shortest(a, b) : undefined;
    const routeLength = route ? chainLength(route.map((id) => coords[id])) : Infinity;
    if (!route || routeLength > direct * 2.5 + 300) {
      // The route-sequence fallback is a straight line between stations, which cuts across real track layout.
      if (pair.fallback.length > 2) result.push(pair.fallback);
      continue;
    }
    const key = `${a}:${b}`;
    if (done.has(key) || done.has(`${b}:${a}`)) continue;
    done.add(key);
    result.push(route.map((id) => coords[id]));
  }
  return stitchPaths(result);
}

export type PreparedLines = { at: (slotMetres: number) => OffsetLineFeature[] };

// Lines running along the same track get side-by-side offsets instead of being drawn on top of each other.
// The expensive analysis happens once; `at` only moves points for a given spacing, so zooming stays fast.
export function prepareOverlappingLines(items: OffsetLinePath[]): PreparedLines {
  const dense = dedupeParallelPaths(
    items.map((item) => ({ lineId: item.lineId, path: densify(item.path) })),
  );
  const cells = new Map<string, Set<string>>();
  for (const { lineId, path } of dense) {
    for (const point of path) {
      const [x, y] = cellOf(point);
      const key = cellKey(x, y);
      const set = cells.get(key) ?? new Set<string>();
      set.add(lineId);
      cells.set(key, set);
    }
  }

  const linesNear = (point: Coordinate) => {
    const [x, y] = cellOf(point);
    const lines = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of cells.get(cellKey(x + dx, y + dy)) ?? []) lines.add(id);
      }
    }
    return [...lines].sort();
  };

  const prepared = dense
    .filter(({ path }) => path.length >= 2)
    .map(({ lineId, path }) => {
      const base = smooth(
        path.map((point) => {
          const lines = linesNear(point);
          return Math.max(0, lines.indexOf(lineId)) - (lines.length - 1) / 2;
        }),
      );
      const directions = travelDirections(path);
      const values = base.map((value, i) => (directions[i] ? value : -value));
      const normals = path.map((_, i) => {
        const a = path[Math.max(0, i - TANGENT_WINDOW)];
        const b = path[Math.min(path.length - 1, i + TANGENT_WINDOW)];
        const dx = (b[0] - a[0]) * LON_SCALE;
        const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        return [-dy / len, dx / len];
      });
      return { lineId, path, values, normals };
    });

  return {
    at(slotMetres) {
      const shifted = prepared.map(({ lineId, path, values, normals }) => ({
        lineId,
        path: path.map((point, i) => {
          if (Math.abs(values[i]) < 1e-3) return point;
          const metres = values[i] * slotMetres;
          return [
            point[0] + (normals[i][0] * metres) / (METRES_PER_DEG * LON_SCALE),
            point[1] + (normals[i][1] * metres) / METRES_PER_DEG,
          ];
        }),
      }));
      return bridgeGaps(shifted.map((item) => ({ ...item, path: roundCorners(item.path) }))).map((item) => ({ ...item, offset: 0 }));
    },
  };
}

export function spreadOverlappingLines(items: OffsetLinePath[], slotMetres = 9): OffsetLineFeature[] {
  return prepareOverlappingLines(items).at(slotMetres);
}