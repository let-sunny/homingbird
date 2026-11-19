import { type AsRead, FEATURES, type FeatureName, isFeatureOffered } from '@homingbird/protocol'

/** Whether a feature is on in this organization; the web client leaves out what is off or what the server lacks. */
export const featureOn = (name: FeatureName, info: AsRead.ServerInfo | null): boolean =>
  info === null ? FEATURES[name].default : isFeatureOffered(info, name)
