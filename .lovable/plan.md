# Calling and chat screen upgrade

## Build
- Request microphone access before creating or accepting a voice call, and microphone plus camera access for video calls. Distinguish denied, unavailable-device, insecure-browser, and connection failures with clear recovery guidance.
- Keep the approved media tracks for the LiveKit connection, confirm audio publication, and expose an in-call connection/audio state. Preserve short-lived, server-validated room tokens.
- Add voice and video call actions to the conversation header and render this conversation’s call history inline with direction, outcome, time, and call-back action.
- Give the conversation a dark patterned treatment with rounded message bubbles, compact reaction pills, and sent/delivered/read tick states.
- Replace generic attachments with signed image previews, playable video previews, playable voice-message cards, and named file cards.
- Add camera and GIF controls to the composer. Camera captures through the device camera/file picker; GIF accepts an animated image upload without introducing a new external provider.

## Technical details
- Merge message and call rows chronologically without changing message storage or existing realtime behavior.
- Treat a sent message as delivered when another member has a read timestamp after its creation, and read when all other members do; label the distinction accessibly.
- Use existing semantic color tokens and button components, with browser media APIs called only from user actions.
- Extend realtime refreshes to call rows and keep attachment access through existing signed storage URLs.

## Verification
- Confirm the project builds and inspect the chat at mobile and desktop sizes when an authenticated conversation is available.
- Capture screenshots containing an inline call, attachment preview, and reaction.
- Record a real two-account connected call only when two authenticated participants/devices are available; verify remote audio is subscribed and the local microphone track is published. Report any authentication or second-device blocker explicitly rather than claiming success.
