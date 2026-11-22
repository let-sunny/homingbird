# Security rules

These nine rules are never broken. Each has a test; keep it passing and keep it meaningful.

1. Only a human credential can approve a note. Agent credentials can draft, read and pick up, never
   approve. The contract marks approval routes `access: 'human'` and the domain function checks again.
   A person approves their own drafts; a channel's agent's draft is approved by one person who manages
   its channel when they send it and did not ask the question it answers, and the note records who.
   A saved answer its person switched to send automatically, in the web client, counts as that
   person's approval for a draft whose text is exactly that answer, sent where they allowed.
2. Drafts are invisible to recipients: inbox, stream, search, and lookup by id. A channel's agent's
   draft is shown only through the review routes, to the managers of its channel, never to the person
   whose question it answers, a manager included. A person may let chosen people or channels see their
   own agent's unconfirmed drafts, in the web client; such a preview is shown as unconfirmed, cannot be
   replied to or quoted, and disappears when the draft is discarded.
   Nothing of a draft is posted to an outside chat tool such as Slack: a person who may decide a draft
   may be told there, in a message only they receive, that it waits, with a link and nothing of it.
3. No tool exposed to a model can approve, change contacts, or read credentials. No agent integration
   can approve: approval happens only in a client where the person signed in themself, the web client.
   No tool exposed to a model can create, rename, retire or connect a channel's agent, ask it
   privately, or read or decide its drafts as a reviewer. No tool exposed to a model can connect an outside chat
   tool such as Slack, link a person or a channel to it, post to it, or read its token.
4. Every received note is passed to a model wrapped as quoted data from a colleague, never as
   instructions. `wrapNote` in `packages/protocol/src/wrap.ts` is the only wrapper; never format a
   note for a model any other way.
5. Credentials are stored hashed and never logged. Tokens appear in exactly one response, when issued.
   A token a person gives Homingbird to wake an outside service cannot be hashed: it is stored
   encrypted, used only in the request that wakes that service, never shown again, and deleted when
   the person removes it.
6. A member sees only conversations they participate in. An administrator, as a person in the web
   client only, may also see which private channels exist and who is in them, never their notes, and
   may read private debate rooms. A private channel's managers are the members of the group that
   manages it, and only that group's members add people to the channel or to the group: an
   administrator outside the group can add no one, themself included. Every member sees teams and who is
   in them; a group made for one channel is shown only to people who can see that channel. Deactivating
   a member removes them from every group. An administrator's agent credentials get no such exception.
   A channel's agent is not a person: it is in its channel's room and its private questions only, and
   cannot sign in, be messaged, or be added to a group or a channel. Only its channel's managers run
   it; an administrator outside the managing group cannot. A private question is seen by its asker,
   the agent and the channel's current managers only; an administrator gets no view of it.
7. No tool exposed to a model can save or change a profile character. Only a person's click saves, and
   the server validates again; it never trusts a client's check.
8. No tool exposed to a model can save, change, enable, disable or delete a principle. Only a person's
   action in the web client saves, and the server validates it again.
9. No tool exposed to a model can open a debate room, opt an agent in, change its limits, or approve,
   post or export its result. A room's content leaves it only through a person: a member exports the
   closed room, or a person whose agent took a turn posts its result, which is sent like any note
   only after that person approves it. A turn is shown to the room without approval, so a debate tool returns nothing but room
   content wrapped by `wrapNote`.

When adding a route, a tool, or a query:

- New route: choose `access` deliberately. Anything that sends, discards, changes contacts or blocks,
  changes a principle or a profile character, or touches credentials is `human`.
- New model-facing tool (MCP, plugin, A2A): it may only call `member` routes, and note content it returns
  must come through `wrapNote`. A character tool may check and preview, never save.
- New note query: filter by participation, and by `status = 'sent' OR author_id = viewer`, OR an
  allowed preview for the viewer.
- Never write a token, authorization header, cookie, or secret into a log line, an audit entry, or an
  error message.
