# WhatsApp voice agents (LiveKit Cloud)

wacrm-fusion routes inbound WhatsApp voice calls through **LiveKit Cloud** (WhatsApp Connector + Agents + Inference). No custom audio bridge or separate STT/TTS API keys are required for v1.

## Architecture

```
Meta calls webhook → wacrm (accept via ConnectorClient)
  → LiveKit room + agent dispatch (metadata: prompt, voice, callback)
  → wacrm-voice worker (LiveKit Inference: STT / LLM / TTS)
  → POST transcript + ended → wacrm → LLM summary → inbox message
```

One **worker deployment per LiveKit Cloud project** (per wacrm account). Agent prompts and voices are passed per call via dispatch metadata — you do not redeploy the worker when editing agents in wacrm.

## 1. wacrm environment

Add to `.env.local` (and Vercel):

```bash
VOICE_CALLBACK_SECRET="<openssl rand -hex 32>"
WHATSAPP_CLOUD_API_VERSION="24.0"
AUTH_URL="https://your-app.vercel.app"
```

`AUTH_URL` must be the public URL workers use to POST call summaries.

Run migrations:

```bash
npm run db:push
```

Use the **same** `VOICE_CALLBACK_SECRET` in the worker (step 4).

## 2. Meta webhook

In Meta App → WhatsApp → Configuration, subscribe your webhook to the **`calls`** field (in addition to `messages`).

Voice calling must already be enabled on your WABA.

## 3. LiveKit Cloud project (per account)

1. Create a project at [cloud.livekit.io](https://cloud.livekit.io).
2. Copy **URL**, **API key**, and **API secret**.
3. In wacrm → **Settings → LiveKit voice**, paste credentials and **Save & test connection**.
4. Set **Worker agent name** (default `wacrm-voice`) — must match the deployed worker.

## 4. Deploy the worker (once per LiveKit project)

This runs **on your Mac in Terminal**, not in Vercel. Repeat for each new LiveKit Cloud project / wacrm account that uses voice.

### Install LiveKit CLI (once per machine)

```bash
brew install livekit-cli
lk --version
```

### Prepare secrets file

```bash
cd packages/wacrm-voice-agent
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
VOICE_CALLBACK_SECRET="<same value as wacrm / Vercel>"
```

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are optional here — `lk cloud auth` injects them on deploy. You need them only for **local dev** (`python -m wacrm_voice_agent.agent dev`).

### Authenticate with LiveKit Cloud

```bash
lk cloud auth
```

Log in and select the project that matches what you saved in wacrm Settings → LiveKit voice.

### First deploy

**Important:** Do not keep a `livekit.toml` with an empty `subdomain = ""` — the CLI will fail with `project does not match agent subdomain []`. If you see that error, delete `livekit.toml` and run create again.

```bash
cd packages/wacrm-voice-agent
lk agent create
```

When prompted for a secrets file, choose **`.env`** (Enter). LiveKit uploads `VOICE_CALLBACK_SECRET` into the cloud agent.

On success you should see:

- `Created agent with ID [...]`
- `registered worker` with `"agent_name": "wacrm-voice"`

`lk agent create` writes **`livekit.toml`** in this folder (project subdomain + agent id). That file is **per deployment** — do not commit it; use `livekit.toml.example` as reference only.

### After code changes

```bash
cd packages/wacrm-voice-agent
lk agent deploy
```

### Useful commands

```bash
lk agent status
lk agent logs
lk agent update-secrets --secrets "VOICE_CALLBACK_SECRET=<new value>"
```

## 5. Enable voice on an AI agent

1. **Settings → AI & LLM** — configure at least one LLM (used for post-call summaries).
2. **Agents** → edit agent → **Voice** tab:
   - Enable **Voice calls**
   - Optional: Cartesia voice ID for TTS
   - Optional: custom call summary prompt
3. Enable **Auto-connect** (or bind the agent to a conversation) so inbound calls resolve to a voice-enabled agent.

## Inference models (defaults)

The worker uses LiveKit Inference (billed via LiveKit Cloud):

| Stage | Model |
|-------|--------|
| STT | `deepgram/nova-3` |
| LLM | `openai/gpt-4.1-mini` |
| TTS | `cartesia/sonic-3` |

Edit `packages/wacrm-voice-agent/src/wacrm_voice_agent/agent.py` to change models.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `project does not match agent subdomain []` | Delete `livekit.toml` (or fix `subdomain`) and run `lk agent create` again |
| Calls not answered | Meta `calls` webhook subscribed; LiveKit settings saved & tested; agent has voice enabled |
| Worker not joining | Agent name in settings is `wacrm-voice`; `lk agent status` shows registered worker |
| No inbox summary | `VOICE_CALLBACK_SECRET` matches wacrm + worker; `AUTH_URL` is correct |
| Accept fails | WhatsApp token valid; Cloud API version; voice enabled on WABA |

Worker logs: `lk agent logs`

See also: [packages/wacrm-voice-agent/README.md](../packages/wacrm-voice-agent/README.md)
