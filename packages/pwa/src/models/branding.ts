/** The product name as the header and the sign-in page write it: the default one in lower case. */
export const wordmark = (name: string): string => (name === 'Homingbird' ? 'homingbird' : name)

/** The logo an organization chose, or the default mark. */
export const logoOf = (logo: string | null): string => logo ?? '/icons/mark.svg'
