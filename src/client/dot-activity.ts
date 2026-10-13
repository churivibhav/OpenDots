export type DotPose =
  | 'idle'
  | 'paused'
  | 'connecting'
  | 'thinking'
  | 'researching'
  | 'wiki'
  | 'writing'
  | 'computer';

interface ChatMessage {
  role: string;
  toolCalls?: { id: string; function: { name: string } }[];
  toolCallId?: string;
}

function poseForTool(name: string): DotPose {
  if (name === 'search_web' || name === 'read_public_page')
    return 'researching';
  if (name === 'opencode_task') return 'wiki';
  if (name === 'create_space_page' || name === 'edit_space_page')
    return 'writing';
  if (name.startsWith('computer_')) return 'computer';
  return 'thinking';
}

/** Picks the avatar pose from what the Dot is doing right now: the tool still waiting on a result, if any. */
export function dotActivity({
  messages,
  running,
  connecting,
  paused,
}: {
  messages: readonly ChatMessage[];
  running: boolean;
  connecting: boolean;
  paused: boolean;
}): DotPose {
  if (running) {
    const finished = new Set(
      messages.flatMap((message) =>
        message.role === 'tool' && message.toolCallId
          ? [message.toolCallId]
          : [],
      ),
    );
    const inFlight = messages
      .flatMap((message) =>
        message.role === 'assistant' ? (message.toolCalls ?? []) : [],
      )
      .findLast((call) => !finished.has(call.id));
    return inFlight ? poseForTool(inFlight.function.name) : 'thinking';
  }
  if (paused) return 'paused';
  return connecting ? 'connecting' : 'idle';
}
