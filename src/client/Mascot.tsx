import type { ReactNode } from 'react';

const characters = [
  'blue',
  'mint',
  'orange',
  'purple',
  'gold',
  'pink',
  'red',
  'teal',
] as const;
type Character = (typeof characters)[number];
const assigned = new Map<string, Character>();

/** Gives Dots distinct characters in creation order, so up to eight never collide. */
export function assignCharacters(ids: string[]) {
  assigned.clear();
  ids.forEach((id, index) =>
    assigned.set(id, characters[index % characters.length]),
  );
}

/** Stable identity keeps each specialist recognizable across views and reloads. */
function characterFor(identity?: string) {
  if (!identity) return characters[0];
  const character = assigned.get(identity);
  if (character) return character;
  let hash = 0;
  for (const character of identity)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return characters[hash % characters.length];
}

interface Face {
  // Midpoint between the eyes and their spacing, as % of the image.
  x: number;
  y: number;
  gap: number;
  // Head tilt in degrees, for faces drawn at an angle.
  tilt: number;
}
// Measured from each character's artwork so props like glasses sit on the eyes.
const standardFace: Face = { x: 49.8, y: 46.7, gap: 28.6, tilt: 0 };
const faces: Record<Character, Face> = {
  blue: standardFace,
  gold: standardFace,
  pink: standardFace,
  red: standardFace,
  teal: standardFace,
  mint: { x: 49.5, y: 50.1, gap: 23.7, tilt: 0 },
  orange: { x: 51, y: 40.8, gap: 25.6, tilt: -9.5 },
  purple: { x: 49.5, y: 43.9, gap: 28.4, tilt: 0 },
};

const ink = '#2b2730';

function Glasses({ face }: { face: Face }) {
  const r = face.gap * 0.3;
  const left = face.x - face.gap / 2;
  const right = face.x + face.gap / 2;
  return (
    <g transform={`rotate(${face.tilt} ${face.x} ${face.y})`}>
      <g className="dot-glasses">
        {[left, right].map((cx) => (
          <g key={cx}>
            <circle
              cx={cx}
              cy={face.y}
              r={r}
              fill="#d9eeff"
              fillOpacity={0.28}
              stroke={ink}
              strokeWidth={2.2}
            />
            <path
              d={`M${cx - r * 0.55} ${face.y - r * 0.35} q${r * 0.3} -${r * 0.4} ${r * 0.75} -${r * 0.4}`}
              stroke="#fff"
              strokeOpacity={0.85}
              strokeWidth={1.2}
              strokeLinecap="round"
              fill="none"
            />
          </g>
        ))}
        <path
          d={`M${left + r} ${face.y - 1} q${face.x - left - r} -3 ${2 * (face.x - left - r)} 0`}
          stroke={ink}
          strokeWidth={2}
          fill="none"
        />
        <path
          d={`M${left - r} ${face.y - 1} l-5 -2 M${right + r} ${face.y - 1} l5 -2`}
          stroke={ink}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

function Book() {
  const page = (side: 1 | -1) =>
    `M50 64 Q${50 - 9 * side} 60.5 ${50 - 19 * side} 62.5 L${50 - 19 * side} 80 Q${50 - 9 * side} 78 50 81.5 Z`;
  const lines = (side: 1 | -1) =>
    [67, 71, 75].map((y) => (
      <path
        key={y}
        d={`M${50 - 4 * side} ${y} L${50 - 15 * side} ${y - 1.2}`}
        stroke="#b9ab92"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
    ));
  return (
    <g className="dot-book">
      <path
        d="M29 63.5 L50 66 L71 63.5 L71 82.5 L50 85 L29 82.5 Z"
        fill="#a4483a"
        stroke={ink}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <path d={page(1)} fill="#fbf4e2" stroke={ink} strokeWidth={1.1} />
      <path d={page(-1)} fill="#fbf4e2" stroke={ink} strokeWidth={1.1} />
      {lines(1)}
      {lines(-1)}
      <path
        className="dot-book-page"
        d={page(-1)}
        fill="#fffaf0"
        stroke={ink}
        strokeWidth={1.1}
      />
    </g>
  );
}

function Notepad() {
  return (
    <g className="dot-notepad">
      <rect
        x={36}
        y={60}
        width={26}
        height={25}
        rx={2.5}
        fill="#fffdf6"
        stroke={ink}
        strokeWidth={1.4}
      />
      <rect x={36} y={60} width={26} height={4.5} rx={2} fill="#6f9ad8" />
      {[69, 73.5, 78].map((y) => (
        <path
          key={y}
          d={`M40 ${y} H${y === 78 ? 50 : 58}`}
          stroke="#9fb3cf"
          strokeWidth={1}
          strokeLinecap="round"
        />
      ))}
      <g className="dot-pencil">
        <path
          d="M51 80 L68 59 L72.5 62.5 L55.5 83.5 Z"
          fill="#f2c443"
          stroke={ink}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        <path d="M68 59 L72.5 62.5 L74 60.5 L69.5 57 Z" fill="#e88a9a" />
        <path
          d="M51 80 L55.5 83.5 L49.5 86 Z"
          fill="#f1d9b5"
          stroke={ink}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}

function Magnifier() {
  return (
    <g className="dot-magnifier">
      <path
        d="M56.5 64.5 L67 75"
        stroke="#7a5532"
        strokeWidth={4.5}
        strokeLinecap="round"
      />
      <circle
        cx={50}
        cy={58}
        r={9.5}
        fill="#cfe9ff"
        fillOpacity={0.4}
        stroke={ink}
        strokeWidth={2.4}
      />
      <path
        d="M44.5 54.5 q2.5 -3.5 6.5 -3.8"
        stroke="#fff"
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

function ThoughtDots() {
  return (
    <g className="dot-thought" fill="#fff" stroke={ink} strokeWidth={1}>
      <circle cx={80} cy={15} r={2.4} />
      <circle cx={87} cy={8} r={3.3} />
      <circle cx={95.5} cy={0} r={4.6} />
    </g>
  );
}

const props: Partial<Record<string, (face: Face) => ReactNode>> = {
  thinking: () => <ThoughtDots />,
  researching: () => <Book />,
  wiki: (face) => <Glasses face={face} />,
  writing: () => <Notepad />,
  computer: () => <Magnifier />,
};
const labels: Record<string, string> = {
  idle: 'here',
  connecting: 'connecting',
  thinking: 'thinking',
  researching: 'reading',
  wiki: 'working in your wiki',
  writing: 'writing',
  computer: 'looking closely',
};

export function Mascot({
  state = 'idle',
  small = false,
  identity,
  name = 'Dot',
  decorative = false,
}: {
  state?: string;
  small?: boolean;
  identity?: string;
  name?: string;
  decorative?: boolean;
}) {
  // Older callers say "working"; it is the thinking pose.
  const pose = state === 'working' ? 'thinking' : state;
  const character = characterFor(identity);
  const prop = decorative ? undefined : props[pose];
  return (
    <span
      className={`mascot ${decorative ? 'idle' : pose} ${small ? 'small' : ''}`}
    >
      <span className="dot-rig">
        <img
          className="dot-body"
          src={`/dots/${character}.png`}
          alt={decorative ? '' : `${name} is ${labels[pose] ?? pose}`}
          width={512}
          height={512}
          draggable={false}
        />
        {prop && (
          <svg className="dot-prop" viewBox="0 0 100 100" aria-hidden="true">
            {prop(faces[character])}
          </svg>
        )}
      </span>
    </span>
  );
}
