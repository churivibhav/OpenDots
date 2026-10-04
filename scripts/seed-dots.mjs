// Creates or updates this deployment's specialist Dots. Safe to re-run.
// Run on the server: node --env-file=.env scripts/seed-dots.mjs
const base = `http://127.0.0.1:${process.env.PORT ?? 4310}/api`;
const token = process.env.OWNER_TOKEN;

async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${method} ${path}: ${data.error ?? response.status}`);
  return data;
}

const shared =
  'You are one of five specialist Dots: Atlas (helpdesk, read-only), Scout (research), Juno (tasks, daily journal, calendar), Sage (study coach), and Marquee (watchlists). Point the owner to the right Dot when a request is outside your role.';
const dots = [
  {
    name: 'Atlas',
    previous: 'Dot',
    opencodeAgent: 'opendots-helpdesk',
    researchAllowed: true,
    instructions: `You are Atlas, the helpdesk: a calm librarian who knows where everything is and touches nothing. Answer questions about the owner's wiki, notes, tasks, daily journal, calendar and the web, and say where each answer came from. You are strictly read-only: never offer to change anything, and if asked to, explain which Dot can (Juno handles tasks and the journal). ${shared}`,
  },
  {
    name: 'Scout',
    opencodeAgent: 'opendots-researcher',
    researchAllowed: true,
    space: 'Research',
    computer: true,
    instructions: `You are Scout, the researcher: curious, thorough and a little dogged. Investigate questions with web research, your computer's browser, and the wiki. Cite sources and flag uncertainty. Write findings up as documents: Space pages in Research (offer review before saving), or wiki reports under notes/research via OpenCode. For long or recurring research, use start_background_task and say you will report back here. ${shared}`,
  },
  {
    name: 'Juno',
    opencodeAgent: 'opendots-chief',
    researchAllowed: true,
    tasks: [
      {
        prompt:
          "Morning brief: check today's tasks, calendar events and anything overdue in notes-editor; if today's top focus is empty, set it from the most important tasks; then summarize the day and the single most important next action.",
        intervalSeconds: 86_400,
        replaces: ["Morning brief: refresh today's plan"],
      },
    ],
    instructions: `You are Juno, the chief of staff, named for the Roman guardian of the calendar: warm, organised and protective of the owner's time. Through OpenCode you manage the owner's tasks and whole daily journal page in notes-editor (water, meals, medicines, routines, exercise, vitals, headaches, mood, focus, notes, wins, tomorrow setup) and read their calendar. When the owner mentions something to log ("had two glasses of water", "lunch was poha"), log it. Confirm exact dates for relative ones. Keep answers short and always end with the next action. ${shared}`,
  },
  {
    name: 'Sage',
    opencodeAgent: 'opendots-coach',
    researchAllowed: false,
    instructions: `You are Sage, the study coach: patient and Socratic. Quiz the owner from their knowledge base, notebooks and learning notes, one question at a time, asking before telling and celebrating streaks. Keep spoken questions short. Save flashcards and progress only through OpenCode in notes/learn/coach. ${shared}`,
  },
  {
    name: 'Marquee',
    opencodeAgent: 'opendots-watchlist',
    researchAllowed: true,
    tasks: [
      {
        prompt:
          'Weekly watchlist check: resolve anything new in the watchlist inbox, then look up notable new or upcoming releases related to items on the watchlists and summarize them.',
        intervalSeconds: 604_800,
      },
    ],
    instructions: `You are Marquee, the watchlist curator: an enthusiastic culture buff who knows what's out, what's coming and what the owner would like. Maintain the movie, TV, book and comic watchlists through OpenCode and check releases on the web. ${shared}`,
  },
];

const workspace = await api('/workspace');
const agents = new Set(workspace.setup.opencodeAgents);
const defaultSpace = workspace.spaces[0];
for (const spec of dots) {
  if (!agents.has(spec.opencodeAgent))
    throw new Error(`Add ${spec.opencodeAgent} to OPENCODE_AGENTS first.`);
  let spaceId = defaultSpace.id;
  if (spec.space) {
    const current = (await api('/workspace')).spaces;
    spaceId =
      current.find((space) => space.name === spec.space)?.id ??
      (
        await api('/spaces', 'POST', {
          name: spec.space,
          description: `Documents written by ${spec.name}.`,
        })
      ).id;
  }
  const body = {
    name: spec.name,
    instructions: spec.instructions,
    researchAllowed: spec.researchAllowed,
    memoryAllowed: true,
    spaceId,
    spaceIds: [...new Set([spaceId, defaultSpace.id])],
    opencodeAgent: spec.opencodeAgent,
  };
  const existing =
    workspace.dots.find((dot) => dot.name === spec.name) ??
    workspace.dots.find((dot) => dot.name === spec.previous);
  const dot = existing
    ? await api(`/dots/${existing.id}`, 'PUT', body)
    : await api('/dots', 'POST', body);
  if (spec.computer)
    await api(`/dots/${dot.id}/computer/permissions`, 'PATCH', {
      enabled: true,
      browser: true,
      files: true,
      shell: false,
    });
  const title = `Talk with ${spec.name}`;
  let thread = workspace.conversations.find(
    (conversation) =>
      conversation.dotId === dot.id && conversation.title === title,
  );
  if (!thread)
    thread = await api('/conversations', 'POST', { dotId: dot.id, title });
  // Tasks are matched by prompt: retire replaced prompts, create missing ones.
  const existingTasks = (await api('/state')).tasks.filter(
    (task) => task.status !== 'canceled',
  );
  for (const { replaces = [], ...task } of spec.tasks ?? []) {
    for (const old of existingTasks.filter((item) =>
      replaces.some((prefix) => item.prompt.startsWith(prefix)),
    ))
      await api(`/tasks/${old.id}/actions`, 'POST', { action: 'cancel' });
    if (!existingTasks.some((item) => item.prompt === task.prompt))
      await api('/tasks', 'POST', { ...task, threadId: thread.id });
  }
  console.log(
    `${existing ? 'Updated' : 'Created'} ${spec.name} (${spec.opencodeAgent})`,
  );
}
