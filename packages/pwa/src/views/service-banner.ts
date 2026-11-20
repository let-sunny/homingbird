import { h } from '@homingbird/ui'
import type { ServiceBannerModel } from '../models/service-banner.ts'

/** On Connection: that no desk has connected, the command that signs one in, and where to enter its code. */
export const serviceBanner = (model: ServiceBannerModel | null): HTMLElement | null =>
  model === null
    ? null
    : h(
        'div',
        { class: 'flow-warning service-banner', role: 'note' },
        h('strong', {}, model.title),
        h('p', {}, model.body),
        h('pre', {}, h('code', {}, model.command)),
        h('a', { href: model.link.href }, model.link.label),
      )
