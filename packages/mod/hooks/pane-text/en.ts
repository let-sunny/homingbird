import { CONFIGURE_COMMAND } from '../command-line'
import type { PaneText } from '../pane-text'

export const en: PaneText = {
  connection: {
    idle: 'not the desk',
    starting: 'starting',
    live: 'desk · live',
    reconnecting: 'desk · reconnecting',
    'signed-out': 'not signed in',
    unavailable: 'command line not found',
  },
  waiting: (count) => `${count} waiting`,
  keepOpen: 'Keep this session open for Homingbird.',
  moved: 'Another session is your Homingbird desk now. This one no longer reacts to notes.',
  becomeDesk: 'Make this the desk',
  confirmSignIn: 'Confirm the sign-in in your browser. If it did not open:',
  openSignInPage: 'Open the sign-in page',
  signInCode: (code) => `Code ${code}. Keep "approve button" ticked to approve notes from this pane.`,
  signInPrompt: "Sign in to your organization's Homingbird server to make this session your desk.",
  serverUrl: 'Server address',
  signIn: 'Sign in',
  memberOn: (member, server) => `${member} on ${server}`,
  draftsWaiting: 'Drafts waiting for your approval',
  none: 'None.',
  noneYet: 'None yet.',
  notesWaiting: 'Notes waiting for a reply',
  draftReady: 'draft ready',
  drafting: 'drafting',
  askedForDraft: 'You asked for a draft',
  askedForDraftWith: (instruction) => `You asked for a draft: ${instruction}`,
  conversations: 'Conversations',
  unread: (count) => `${count} unread`,
  newNote: 'New note',
  reply: 'Reply',
  newNoteBy: (agent) => `New note drafted by ${agent}`,
  replyBy: (agent) => `Reply drafted by ${agent}`,
  editThenSend: 'Edit, then send',
  send: 'Send',
  approve: 'Approve',
  edit: 'Edit',
  cancel: 'Cancel',
  discard: 'Discard',
  approveInWebClient: 'Approve, edit or discard drafts in the Homingbird web client. Each draft links there.',
  openInWebClient: 'Approve in the web client',
  deskStatus: (waiting) =>
    waiting === 0
      ? 'Homingbird desk'
      : `Homingbird desk · ${waiting} ${waiting === 1 ? 'draft' : 'drafts'} waiting for approval`,
  toast: (text) => `Homingbird: ${text}`,
  noteArrived: (author) => `A note from ${author} arrived. Drafting a reply.`,
  aColleague: 'a colleague',
  draftReadyNotice: 'A draft is ready for your approval in the Homingbird pane.',
  draftingRequest: 'Drafting what you asked for.',
  streamStopped: 'The live stream stopped. Reconnecting in half a minute.',
  noApproveButton: 'This device has no approve button. Approve in the Homingbird web client.',
  couldNotSignIn: (reason) => `Could not sign in: ${reason}`,
  noNode: (olderVersion) =>
    `${olderVersion === null ? 'Node 22 or newer was not found' : `Node ${olderVersion} is too old; Homingbird needs Node 22 or newer`}. Start Claude Code from a terminal where node -v works and shows 22 or newer, or set the mod's "Homingbird command" to the full path of node with ${CONFIGURE_COMMAND}.`,
  serverHeading: 'Enter your Homingbird server address',
  serverHelp: 'The address your organization gave you, such as https://homingbird.example.com.',
  serverByCommand:
    'Or type /homingbird followed by the address, such as /homingbird https://homingbird.example.com.',
  checkingServer: 'Checking the address…',
  useServer: 'Continue',
  serverRefused: (reason, typed) =>
    reason === 'not-https'
      ? `"${typed}" is not an https address. Type the whole address, starting with https://.`
      : `No Homingbird server was found at ${typed}. Check the address with whoever gave it to you.`,
  changeServer: `To use another server, type /homingbird followed by its address, or change "Homingbird server address" with ${CONFIGURE_COMMAND}.`,
  serverUsuallySet:
    'Your organization usually sets this address when the mod is installed. If it did not, ask whoever runs Homingbird for it.',
  signInTo: (host) => `Sign in to ${host}`,
  openWeb: 'Open web',
  waitingForApproval: 'Waiting for you to approve in the browser.',
  signInDenied: 'The sign-in was refused in the browser. Nothing was connected.',
  signInExpired: 'The code expired before it was approved. Start again to get a new one.',
  signInUnreachable: 'The Homingbird server could not be reached to finish signing in.',
  tryAgain: 'Try again',
  characterStarted:
    'Making your character: your agent drafts and checks it, then gives you a link to the editor. Only your click on "Use this character" saves it.',
}
