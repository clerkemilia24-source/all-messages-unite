# Ripple messaging extension

## Approach

Extend the existing app, preserving current conversations, accounts, iMessage-inspired appearance, and the previous security fixes. Deliver the features in dependency order rather than adding controls that do not work.

LiveKit, Upstash Redis, and OneSignal secret names are configured. Their connectivity, permissions, and production configuration still need verification.

## 1. Foundation, navigation, and search

- Add four bottom tabs: **Chat · Status · Contact · Settings/Profile**. Keep call history inside Contact.
- Upgrade the existing inbox search from names/latest-message previews to paginated full-message and contact search. Selecting a result opens the matching message.
- Add saved contacts, favorites, invitations, block/report, and group-add approval.
- Preserve existing public URLs and chat data throughout the extension.. Conversation experience

- Voice recording with waveform, timer, swipe cancellation, hands-free lock, and playable voice bubbles.
- Sticker library with immediate sending and transparent rendering.
- Swipe-to-reply and long-press menus for reply, copy, forward, delete, reactions, and multi-select actions.
- Forward/reply composer context, pinned messages, safe URL previews, and a zoomable media viewer with swipe navigation.
- Accurate sent/delivered/read states and header typing indicators.
- Server-enforced edit and unsend windows; default to 15 minutes for editing and 2 minutes for unsending. Distinguish deleting for yourself from unsending for everyone.. Calls

- LiveKit audio/video calls for direct and group conversations: ringing, accept/decline, mute, camera toggle, camera switching where supported, and hang-up.
- Missed/incoming/outgoing history within Contact, with quick call actions in contacts and chats.
- Validate membership before issuing short-lived room tokens; verify call webhooks and handle disconnects and declined calls.

## 2. Status and groups

- Photo/video/text statuses with customizable backgrounds, 24-hour expiry, audience controls, timestamped viewers, reactions, and direct-message replies.
- Unviewed-first ordering and explicit permanent highlights, separate from expiring posts.
- Group administration, invitations/approval, membership management, mentions, shared media, and group calls.

## 3. Privacy and timed delivery

- Scheduled messages with a dedicated editable/cancelable list, delivered by a server-side scheduler even when the app is closed.
- View-once, one-minute, and custom timed media. Opening atomically starts the timer; repeat access is denied after consumption or expiry.
- A separate Secret Chat pipeline with a vetted client-side cryptography library, device keys, authenticated key exchange, identity verification, and encrypted attachments. Never store plaintext or keys on the server, send plaintext push previews, or include secret threads in cloud backups/search indexes.
- Secret Chat opens a separate encrypted thread; existing plaintext history is not relabeled as encrypted. Self-destruct timers revoke server access, but cannot erase a recipient's screenshots or offline copies.
- PIN-based chat lock with rate limiting and protected unlock sessions; biometric unlock only where supported. Conceal locked content in inbox/search/notifications.
- 4. Contacts, settings, and devices

- Alphabetical contact directory with saved-contact-only media auto-download, favorites, presence, invitations, and message/audio/video actions.
- Device contact import through permission-based browser support where available, with manual/file import fallback; do not claim continuous native address-book sync.
- Profile photo/name/bio/username plus separate last-seen, profile-photo, status, and read-receipt privacy controls.
- Put chat lock, last-seen, and read receipts directly on Settings home. Add blocked contacts, wallpapers, font size, storage usage, and linked-device/session revocation.
- Sync standard chats across concurrent web/mobile sessions. Secret-chat device linking requires explicit secure enrollment, not ordinary cloud restore.

## 5. Reliability and verification

- OneSignal opt-in, authenticated recipient binding, service worker, delivery retries, deduplication, and visible notification failure states.
- Large groups muted by default (initial threshold: 20 members), priority-contact preferences, and low-priority digests.
- Standard-chat export/restore with versioned formats, validation, checksums, duplicate prevention, explicit progress/errors, and restore tests. Exclude secret and expired content.
- Test permissions, nonmember access, privacy changes, timers, scheduler retries, missed calls, two-account messaging, and multi-device behavior.
- Test desktop and mobile layouts and microphone/camera permission failures. Real background push, operating-system battery restrictions, incoming-call wakeup, and biometrics need physical-device checks; web apps cannot guarantee delivery under every OS restriction.

## Technical implementation

- Keep TanStack Start and Lovable Cloud for durable account/chat data and access policies. Use authenticated server functions for app operations and signature-verified public routes for provider callbacks and cron.
- Add the requested packages plus LiveKit client/server SDK dependencies and a vetted encryption implementation as needed. Keep private service credentials server-only; expose only intended public client configuration, including the OneSignal app ID.
- Use Upstash Redis for standard-message event coordination, presence/typing, rate limits, deduplication, and expiring access keys. Retain durable standard-message history in the existing database, with an outbox/retry mechanism so partial service failures do not lose messages.
- Use Redis TTL as authoritative status/timed-media access enforcement. TTL expiry alone does not delete stored media: add a retryable cleanup queue and private-media access checks. Avoid long-lived signed URLs for timed media.
- Use authenticated cron processing with durable scheduled-message records and atomic claims; Redis alone is not a scheduler. Verify available scheduling support without assuming QStash credentials exist.
- Add narrowly scoped policies and explicit grants for every new table. Preserve the hardened function and attachment/avatar access restrictions. Keep role assignments separate from profiles.
- Use query-backed fetching/mutations and clean up every real-time subscription. Add route-specific page metadata for new screens.

## Completion standard

No placeholder calls, pretend encryption, client-only expiry/scheduling, or unverified reliability claims. Track unfinished features and external/device-testing blockers explicitly. No AI features are included.