/** What a normal connection needs to load the page, rounded up; above it the page says loading is slower than usual. */
export const USUAL_LOAD_SECONDS = 5

/** Above what the slowest connection we tested needs, and never under ten; above it the page offers to try again. */
export const TOO_LONG_LOAD_SECONDS = 15

/** After a failure that repeating did not mend, how long before the page quietly loads the workspace again. */
export const QUIET_RETRY_SECONDS = 30
