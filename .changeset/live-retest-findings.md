---
"@homingbird/pwa": patch
"@homingbird/dovecote": patch
---

Fixes from the live retest.

- In a narrow header, the connection badge no longer shows as a bare square. Connected, it is hidden and stays readable to assistive technology; connecting and offline always show their word.
- A tour step for a header control sits under that control with its usual width, instead of stretching across the page.
- A channel's address is now `#/channel/<name>`; old `#/t/<name>` links still open it.
- Archiving a channel stops showing an agent as drafting in it, and an agent that tries to reply there is told that no reply is possible because the channel was archived.
- With development login and no `HB_ADMIN_EMAILS`, the startup warning says that the first member to sign in becomes an administrator.
