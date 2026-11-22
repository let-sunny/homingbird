import { Task as T } from '@homingbird/kernel'
import type { PrincipleProposal } from '@homingbird/protocol'
import { setAutoSend } from '../domain/auto-send-settings.ts'
import {
  channelTeachingFor,
  channelTeachingForDrafting,
  createChannelPrinciple,
  deleteChannelPrinciple,
  reorderChannelPrinciples,
  setChannelTeaching,
  updateChannelPrinciple,
} from '../domain/channel-teaching.ts'
import { myInsights } from '../domain/insights.ts'
import { myPrinciples } from '../domain/my-principles.ts'
import { recordMiss } from '../domain/principle-applications.ts'
import { dismissOffer } from '../domain/principle-offers.ts'
import {
  acceptProposal,
  acceptProposals,
  discardProposal,
  openProposals,
  proposePrinciple,
} from '../domain/principle-proposals.ts'
import {
  createPrinciple,
  deletePrinciple,
  principlesForDrafting,
  reorderPrinciples,
  updatePrinciple,
} from '../domain/principles.ts'
import { setTeachingDocument, teachingInterview, teachingMaterial } from '../domain/teaching-material.ts'
import type { Handlers } from './handlers.ts'

/** What a person teaches their agent, or a channel's managers its agent, and how often drafts are sent as written. */
export const teachingHandlers = {
  'insights.mine': (_, caller) => myInsights(caller.member.id),
  'principles.list': (_, caller) => myPrinciples(caller.member.id),
  'principles.create': ({ body }, caller) => createPrinciple(caller.member.id, body),
  'principles.update': ({ params, body }, caller) => updatePrinciple(caller.member.id, params.id, body),
  'principles.autoSend.set': ({ params, body }, caller) => setAutoSend(caller.member.id, params.id, body),
  'principles.reorder': ({ body }, caller) => reorderPrinciples(caller.member.id, body.ids),
  'principles.delete': ({ params }, caller) => deletePrinciple(caller.member.id, params.id),
  'principles.miss': ({ params, body }, caller) => recordMiss(caller.member.id, params.id, body.noteId),
  'principles.offers.dismiss': ({ params, body }, caller) =>
    T.as({})(dismissOffer(caller.member.id, params.id, body.stopAskingHere === true)),
  'principles.drafting': ({ query }, caller) =>
    caller.member.kind === 'channel_agent'
      ? channelTeachingForDrafting(caller.member.id, query.conversationId)
      : principlesForDrafting(caller.member.id, query.conversationId),
  'teaching.material': (_, caller) => teachingMaterial(caller),
  'teaching.document.set': ({ body }, caller) =>
    T.as({})(setTeachingDocument(caller.member.id, body.document)),
  'principleProposals.list': (_, caller) =>
    T.flatMap((proposals: PrincipleProposal[]) => teachingInterview(caller.member.id, proposals))(
      openProposals(caller.member.id),
    ),
  'principleProposals.create': ({ body }, caller) => proposePrinciple(caller, body),
  'principleProposals.accept': ({ params, body }, caller) => acceptProposal(caller, params.id, body),
  'principleProposals.acceptAll': ({ body }, caller) => acceptProposals(caller, body.ids),
  'principleProposals.discard': ({ params }, caller) => T.as({})(discardProposal(caller, params.id)),
  'channels.agent.teaching.get': ({ params }, caller) => channelTeachingFor(caller, params.slug),
  'channels.agent.teaching.set': ({ params, body }, caller) => setChannelTeaching(caller, params.slug, body),
  'channels.agent.principles.create': ({ params, body }, caller) =>
    createChannelPrinciple(caller, params.slug, body),
  'channels.agent.principles.update': ({ params, body }, caller) =>
    updateChannelPrinciple(caller, params.slug, params.id, body),
  'channels.agent.principles.reorder': ({ params, body }, caller) =>
    reorderChannelPrinciples(caller, params.slug, body.ids),
  'channels.agent.principles.delete': ({ params }, caller) =>
    deleteChannelPrinciple(caller, params.slug, params.id),
} satisfies Partial<Handlers>
