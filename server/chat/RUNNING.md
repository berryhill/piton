# Same-origin application host

The TypeScript host serves compiled browser assets and `/api/chat/*` under one origin. API routes never fall through to SPA HTML. This is transport integration, not proof of a connected agent or runtime isolation.

Build the browser and Node host with `pnpm run build` and `pnpm run build:chat`, then use `pnpm run start:chat`. The Node host always listens on loopback. Supply explicit non-secret startup settings:

- `PITON_ORIGIN`: exact browser origin; HTTPS except localhost/loopback.
- `PITON_PORT`: loopback listener port, an integer from 1 to 65535.
- `PITON_DIST`: absolute compiled browser `dist` directory.
- `PITON_CHAT_STATE`: absolute private transport-state directory outside public assets. Never place transcripts, request receipts or authentication records under `dist`.
- `PITON_TAILSCALE_LOGIN`: exact trusted operator login when using verified Tailscale Serve provenance. Do not forward client-supplied identity headers through another proxy.
- `PITON_LOCAL_BOOTSTRAP=1`: optional anonymous bootstrap ONLY for isolated loopback testing. Public origins reject this setting.
- `PITON_RUNTIME_CONFIG`: optional absolute path to private server-owned Hermes launch configuration; see `runtime/README.md`. Without it, model execution remains unavailable. Browser settings cannot supply executable paths, credentials or privilege flags.

The origin must remain unchanged during workstation updates to preserve the browser's OPFS data. The host sets COOP `same-origin`, COEP `require-corp`, and CORP `same-origin`.

## Deliberate default denial

The executable does not manufacture a runtime-isolation verifier. With `PITON_RUNTIME_CONFIG`, it verifies the pinned native source manifest and starts a private loopback ACP normalization service. Each actual Hermes session must report matching enforced conversation-only policy before discovery or inference is admitted. A source mismatch, absent/false policy, malformed protocol, or unsupported agentic provider transport fails closed. An environment flag, injected constant-true callback, empty advertised capability list or prompt instruction is not sufficient.

The ACP adapter generates its private loopback authorization token in memory and supplies `PITON_HERMES_UPSTREAM` and `API_SERVER_KEY` to the existing bridge internally; do not configure or expose that token in the browser or argv. Provider credentials stay in Hermes's existing protected custody. Their existence is not proof of runtime confinement.

## Acceptance boundary

Require the exact deployed source/build identity, authenticated browser runtime settings and actual connection-test reply, two project-scoped turns, reload/history, a different project's context isolation, Stop during streamed generation, and explicit recovery without replaying stopped work. Do not claim live delivery from mock tests or a model-list response. Restricted Hermes child sessions are ephemeral; Piton's private application ledger owns durable history. The ordinary `hermes acp` command is not the restricted entrypoint; use the pinned dedicated `python -m acp_adapter --conversation-only` launcher. CAD MCP tools and assistant-to-modeling proposals remain separate capabilities; conversation mode grants neither.
