/** Adapta el cliente del hub al contrato callHub de Code Mode. */
export function createHubCallAdapter(client) {
  return async function callHub(name, args = {}) {
    if (name === 'agent_session_create') {
      const created = await client.createSession(
        args.agent,
        args.prompt,
        args.workspace,
        args.model || undefined,
      );
      return { content: [{ type: 'text', text: JSON.stringify(created ?? {}) }] };
    }
    if (name === 'agent_session_status') {
      let status;
      try {
        status = await client.getSessionStatus(args.sessionId);
      } catch {
        const list = await client.listSessions();
        status = list.find((s) => s.sessionId === args.sessionId) || { sessionId: args.sessionId, status: 'completed' };
      }
      return { content: [{ type: 'text', text: JSON.stringify(status ?? {}) }] };
    }
    if (name === 'agent_session_cancel') {
      await client.cancelSession(args.sessionId);
      return { content: [{ type: 'text', text: JSON.stringify({ sessionId: args.sessionId, status: 'cancelled' }) }] };
    }
  };
}