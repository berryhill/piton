# Same-origin application host

The TypeScript host serves compiled browser assets and `/api/chat/*` under one origin. API routes never fall through to SPA HTML. This is transport integration, not proof of a connected agent or runtime isolation.

Build the browser and Node host with `pnpm run build` and `pnpm run build:chat`, then use `pnpm run start:chat`. The Node host always listens on loopback. Supply explicit non-secret startup settings:

- `PITON_ORIGIN`: exact browser origin; HTTPS except localhost/loopback.
- `PITON_PORT`: loopback listener port, an integer from 1 to 65535.
- `PITON_DIST`: absolute compiled browser `dist` directory.
- `PITON_CHAT_STATE`: absolute private transport-state directory outside public assets. Never place transcripts, request receipts or authentication records under `dist`.
- `PITON_TAILSCALE_LOGIN`: exact trusted operator login when using verified Tailscale Serve provenance. Do not forward client-supplied identity headers through another proxy.
- `PITON_LOCAL_BOOTSTRAP=1`: optional anonymous bootstrap ONLY for isolated loopback testing. Public origins reject this setting.

The origin must remain unchanged during workstation updates to preserve the browser's OPFS data. The host sets COOP `same-origin`, COEP `require-corp`, and CORP `same-origin`.

## Deliberate default denial

The executable does not manufacture a runtime-isolation verifier. Even with an upstream credential present, availability remains false and no model turn may start until a genuine trusted restricted-session invocation path is wired and independently verified. An environment flag, injected constant-true callback, empty advertised capability list or prompt instruction is not sufficient.

`PITON_HERMES_UPSTREAM` and `API_SERVER_KEY`, when required by the supported adapter, are server-owned protected environment references. Never pass credentials in CLI arguments, log them or send them to the browser. Their existence is not proof of runtime confinement.

## Current evidence boundary

The parent exercised the compiled Node entrypoint with a real isolated browser: project creation, local authentication bootstrap and JSON availability returned HTTP 200, `available=false`, and an empty capability list. This proves startup and transport routing only. No real model reply was produced. Production runtime isolation, crash-lock recovery, complete Stop semantics, agent-to-modeling proposals, publication and live-agent acceptance remain separate gates. The workstation test app currently remains on the manual-modeling release until explicitly updated after review.
