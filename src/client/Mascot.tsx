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
const assigned = new Map<string, (typeof characters)[number]>();

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
  return (
    <span className={`mascot ${state} ${small ? 'small' : ''}`}>
      <img
        className="dot-body"
        src={`/dots/${characterFor(identity)}.png`}
        alt={decorative ? '' : `${name} is ${state}`}
        width={512}
        height={512}
        draggable={false}
      />
    </span>
  );
}
