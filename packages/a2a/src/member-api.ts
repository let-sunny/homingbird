import { type Api, type Contract, type RouteName, contract } from '@homingbird/protocol'

export type MemberRouteName = {
  [N in RouteName]: Contract[N]['access'] extends 'member' | 'public' ? N : never
}[RouteName]

export type MemberApi = Pick<Api, MemberRouteName>

export const MEMBER_ROUTES = (Object.keys(contract) as RouteName[]).filter(
  (name): name is MemberRouteName => contract[name].access === 'member' || contract[name].access === 'public',
)

export const memberApiOf = (api: Api): MemberApi =>
  Object.fromEntries(MEMBER_ROUTES.map((name) => [name, api[name]])) as unknown as MemberApi
