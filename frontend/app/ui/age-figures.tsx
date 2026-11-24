import type { CSSProperties } from 'react';
import type { components } from '../api/schema';

type Direction = components['schemas']['AgeDirectionView'];
type Pose = { head: [number, number]; lines: string[] };

// Drawn from the floor (y = 0) up, about 150 units tall and within 60 units of the centre.
const poses: Pose[] = [
  { head: [0, -126], lines: ['M0 -102V-58', 'M-36 -134L0 -100L36 -134', 'M-28 0L0 -58L28 0'] },
  {
    head: [36, -136],
    lines: [
      'M0 -62Q6 -86 16 -106',
      'M16 -106L56 -122',
      'M16 -106Q-4 -126 20 -158',
      'M-24 0L0 -62L22 0',
    ],
  },
  {
    head: [0, -128],
    lines: ['M0 -104V-64', 'M-48 -108Q0 -96 48 -108', 'M0 0V-64L34 -46L4 -28'],
  },
  {
    head: [-46, -116],
    lines: ['M2 0V-74', 'M2 -74L-28 -98', 'M-26 -96L-60 -84', 'M-26 -96L4 -122', 'M2 -74L58 -104'],
  },
  {
    head: [10, -138],
    lines: [
      'M0 0V-74',
      'M0 -74Q2 -98 8 -114',
      'M8 -110L-26 -150',
      'M8 -110L46 -142',
      'M0 -74Q-36 -74 -58 -112',
    ],
  },
];
const scaled = (path: string, k: number) =>
  path.replace(/-?\d+(\.\d+)?/g, (n) => (Number(n) * k).toFixed(1));

/** Decorative: the same ages are listed as text in the schedule. */
export function AgeFigures({ directions }: { directions?: Direction[] }) {
  const named = directions && directions.length >= 1 && directions.length <= 7 ? directions : null;
  const count = named?.length ?? poses.length;
  return Array.from({ length: count }, (_, index) => {
    const pose = poses[count === 1 ? 3 : index % poses.length];
    const k = count === 1 ? 1 : 0.55 + (0.45 * index) / (count - 1);
    const age = named?.[index];
    return (
      <span className="ages-figure" key={index} style={{ '--figure': index } as CSSProperties}>
        <svg viewBox="-68 -172 136 178">
          {pose.lines.map((line) => (
            <path key={line} pathLength="1" d={scaled(line, k)} strokeWidth={7 + 4 * k} />
          ))}
          <circle cx={pose.head[0] * k} cy={pose.head[1] * k} r={8 + 6 * k} />
        </svg>
        {age && (
          <span className="ages-label">
            {age.ageFrom}
            {age.ageOpenEnded || age.ageTo == null ? '+' : `–${age.ageTo}`}
          </span>
        )}
      </span>
    );
  });
}
