import { type FeatureName, type ServerInfo, isFeatureOn } from '@homingbird/protocol'
import { serverInfo } from './state.ts'

/** Whether a feature is on in this organization; the web client leaves out what is off. */
export const featureOn = (name: FeatureName, info: ServerInfo | null = serverInfo.get()): boolean =>
  isFeatureOn(info?.features, name)
