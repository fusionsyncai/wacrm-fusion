import "server-only";

import { generateText } from "ai";

import { getLlmModel } from "@/lib/llm/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_SUMMARY_PROMPT =
  "Summarize this WhatsApp voice call in 2-4 sentences for a CRM inbox. Include the caller intent, key facts, and outcome.";

export async function generateCallSummary(args: {
  accountId: string;
  transcript: string;
  callSummaryPrompt?: string | null;
  agentName?: string;
}): Promise<string> {
  const transcript = args.transcript.trim();
  if (!transcript) {
    return "Voice call completed. No transcript was captured.";
  }

  const { model } = await getLlmModel(args.accountId);
  const prompt = args.callSummaryPrompt?.trim() || DEFAULT_SUMMARY_PROMPT;

  const result = await generateText({
    model,
    system: prompt,
    prompt: `Agent: ${args.agentName ?? "Assistant"}\n\nTranscript:\n${transcript}`,
  });

  return result.text.trim() || "Voice call completed.";
}

export async function finalizeVoiceSession(args: {
  sessionId: string;
  transcript?: string;
}): Promise<void> {
  const session = await prisma.voiceSession.findUnique({
    where: { id: args.sessionId },
    include: {
      aiAgent: { select: { name: true, callSummaryPrompt: true } },
      conversation: {
        select: { id: true, accountId: true, userId: true },
      },
    },
  });

  if (!session || session.status === "completed") return;

  const transcript = (args.transcript ?? session.transcript ?? "").trim();
  const summary = await generateCallSummary({
    accountId: session.accountId,
    transcript,
    callSummaryPrompt: session.aiAgent?.callSummaryPrompt,
    agentName: session.aiAgent?.name,
  });

  const endedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.voiceSession.update({
      where: { id: session.id },
      data: {
        status: "completed",
        transcript: transcript || null,
        summary,
        endedAt,
      },
    });

    if (session.conversationId) {
      await tx.message.create({
        data: {
          conversationId: session.conversationId,
          senderType: "bot",
          contentType: "text",
          contentText: `📞 Voice call summary\n\n${summary}`,
          status: "sent",
        },
      });

      await tx.conversation.update({
        where: { id: session.conversationId },
        data: {
          lastMessageText: summary.slice(0, 200),
          lastMessageAt: endedAt,
        },
      });
    }
  });
}
