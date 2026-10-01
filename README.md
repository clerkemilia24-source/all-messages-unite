# All-In Messenger

Can you build everything imessage have features and and everything

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://all-messages-unite.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7b9358b4-9fa1-4f27-a48c-aca2a256c5ef).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Feed Moderation

Public feed posts and comments are published only after the server-side moderation service approves them. Configure `CONTENT_MODERATION_URL` and `CONTENT_MODERATION_API_KEY` in the server runtime. The endpoint receives a JSON `POST` with `body`, `mediaType`, and `mediaUrl`; the media URL is a short-lived signed URL for private review storage. It must inspect text and any supplied photo or video, and return `{"approved": true}` only when the content passes policy. Missing configuration, service errors, invalid responses, and rejected content all fail closed. The API key is sent as a Bearer token and must never be exposed to browser code.
