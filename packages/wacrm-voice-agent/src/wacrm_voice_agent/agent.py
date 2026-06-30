import json
import logging
import os
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    TurnHandlingOptions,
    cli,
    inference,
)

load_dotenv(".env.local")

logger = logging.getLogger("wacrm-voice-agent")

DEFAULT_VOICE = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
DEFAULT_AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "wacrm-voice").strip() or "wacrm-voice"


@dataclass
class CallMetadata:
    voice_session_id: str
    system_prompt: str
    callback_url: str
    voice_id: str
    agent_name: str


def parse_metadata(raw: str | None) -> CallMetadata:
    data = json.loads(raw or "{}")
    return CallMetadata(
        voice_session_id=str(data.get("voice_session_id") or ""),
        system_prompt=(
            data.get("system_prompt")
            or "You are a helpful WhatsApp voice assistant. Keep replies brief and conversational."
        ),
        callback_url=str(data.get("callback_url") or ""),
        voice_id=str(data.get("voice_id") or DEFAULT_VOICE).strip() or DEFAULT_VOICE,
        agent_name=str(data.get("agent_name") or "Assistant"),
    )


async def post_callback(
    meta: CallMetadata,
    event: str,
    transcript: str | None = None,
) -> None:
    secret = os.environ.get("VOICE_CALLBACK_SECRET", "").strip()
    if not meta.callback_url:
        logger.warning("No callback_url in job metadata — skipping %s", event)
        return
    if not secret:
        logger.warning("VOICE_CALLBACK_SECRET is not set — skipping %s", event)
        return

    payload: dict[str, str] = {"event": event}
    if transcript is not None:
        payload["transcript"] = transcript

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            meta.callback_url,
            json=payload,
            headers={
                "content-type": "application/json",
                "x-voice-callback-key": secret,
            },
        )
        response.raise_for_status()


server = AgentServer()


@server.rtc_session(agent_name=DEFAULT_AGENT_NAME)
async def wacrm_voice_agent(ctx: JobContext) -> None:
    meta = parse_metadata(ctx.job.metadata)
    transcript_lines: list[str] = []

    ctx.log_context_fields = {
        "room": ctx.room.name,
        "voice_session_id": meta.voice_session_id,
    }

    class VoiceAssistant(Agent):
        def __init__(self) -> None:
            super().__init__(
                instructions=(
                    f"{meta.system_prompt}\n\n"
                    "You are on a live phone call. Speak naturally, keep answers concise, "
                    "and avoid markdown or bullet lists."
                ),
            )

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(model="cartesia/sonic-3", voice=meta.voice_id),
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
        ),
        preemptive_generation=True,
    )

    @session.on("user_input_transcribed")
    def on_user_input(ev):  # type: ignore[no-untyped-def]
        if getattr(ev, "is_final", False) and getattr(ev, "transcript", ""):
            transcript_lines.append(f"Caller: {ev.transcript}")

    @session.on("conversation_item_added")
    def on_item(ev):  # type: ignore[no-untyped-def]
        item = getattr(ev, "item", None)
        if not item:
            return
        role = getattr(item, "role", None)
        text = getattr(item, "text_content", None) or getattr(item, "content", None)
        if not text:
            return
        label = "Caller" if role == "user" else "Agent"
        line = f"{label}: {text}".strip()
        if line and (not transcript_lines or transcript_lines[-1] != line):
            transcript_lines.append(line)

    async def on_shutdown() -> None:
        transcript = "\n".join(transcript_lines).strip()
        try:
            if transcript:
                await post_callback(meta, "transcript", transcript)
            await post_callback(meta, "ended", transcript or None)
        except Exception:
            logger.exception("Failed to POST voice session callback")

    ctx.add_shutdown_callback(on_shutdown)

    await session.start(agent=VoiceAssistant(), room=ctx.room)
    await ctx.connect()
    await session.generate_reply(
        instructions="Greet the caller briefly and ask how you can help.",
    )


def main() -> None:
    cli.run_app(server)


if __name__ == "__main__":
    main()
