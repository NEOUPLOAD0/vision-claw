# Vision Claw

A real-time AI vision assistant for Android. Point your phone camera at anything, hold the mic button to ask a question, and Gemini analyzes what it sees and hears — then speaks the answer back to you.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/mobile run dev` — run the Expo dev server (scan QR with Expo Go)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54 (React Native 0.81), Expo Router, expo-camera, expo-av, expo-speech, expo-file-system
- API: Express 5 with 50 MB body limit (for base64 image/audio payloads)
- AI: Google Gemini `gemini-2.5-flash` via `@google/genai` SDK (user's own API key)
- Validation: Zod + Orval codegen from OpenAPI spec

## Where Things Live

- `artifacts/mobile/app/index.tsx` — main camera + voice screen
- `artifacts/mobile/constants/colors.ts` — dark cyber color palette
- `artifacts/api-server/src/routes/vision.ts` — Gemini vision analysis endpoint
- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/src/generated/` — generated hooks (do not edit)

## Architecture Decisions

- Gemini API key (`GEMINI_API_KEY`) lives exclusively in the backend — never exposed to the mobile client.
- Base64 image + audio are POSTed as JSON to `/api/vision/analyze`; Express body limit is 50 MB.
- `expo-av` is used for audio recording (SDK 54 deprecated it but it still works for recording).
- Single-screen app — no tab bar, no header chrome. Camera fills the screen.

## User preferences

- User wants to run the app on their Android phone using Expo Go / Termux.

## Gotchas

- After any API spec change, run `pnpm --filter @workspace/api-spec run codegen` before editing frontend code.
- `FileSystem.EncodingType.Base64` type is missing from some expo-file-system versions — use `'base64' as FileSystem.EncodingType` as a workaround.
- `expo-speech` package installation can corrupt (`_tmp_NNN` dir) — if it does, `rm -rf node_modules/.pnpm/expo-speech*` then reinstall.
