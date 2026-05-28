"use server";

import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getAnthropic } from "@/lib/anthropic";
import { recordUsage } from "@/lib/usage";
import { costOf } from "@/lib/models";
import { BENCH_MODELS, BENCH_PROMPTS, type BenchResult } from "@/lib/benchmark";

/**
 * Run the benchmark matrix (selected models × selected prompts). Admin-only, and
 * billed to the server's Anthropic key. Calls run in parallel (so total time ≈
 * the slowest single call, well under the nginx read timeout), thinking + tools
 * OFF for a fair comparison. Each call is also logged to the usage ledger.
 */
export async function runBenchmark(
  modelIds: string[],
  promptIds: string[],
): Promise<BenchResult[]> {
  const session = await getSession();
  if (!session || !isAdmin(session.user)) throw new Error("Admins only.");

  const anthropic = getAnthropic();
  const models = BENCH_MODELS.filter((m) => modelIds.includes(m.id));
  const prompts = BENCH_PROMPTS.filter((p) => promptIds.includes(p.id));

  const jobs: Promise<BenchResult>[] = [];
  for (const m of models) {
    for (const p of prompts) {
      jobs.push(
        (async (): Promise<BenchResult> => {
          const t0 = Date.now();
          try {
            const msg = await anthropic.messages.create({
              model: m.id,
              max_tokens: p.maxTokens,
              messages: [{ role: "user", content: p.prompt }],
            });
            const ms = Date.now() - t0;
            const inputTokens = msg.usage.input_tokens ?? 0;
            const outputTokens = msg.usage.output_tokens ?? 0;
            const text = msg.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("");

            await recordUsage({
              userId: session.user.id,
              model: m.id,
              inputTokens,
              outputTokens,
              meta: { feature: "benchmark", promptId: p.id },
            });

            return {
              model: m.id,
              promptId: p.id,
              ok: true,
              ms,
              inputTokens,
              outputTokens,
              costUsd: costOf(m.id, { inputTokens, outputTokens }),
              text,
            };
          } catch (e) {
            return {
              model: m.id,
              promptId: p.id,
              ok: false,
              ms: Date.now() - t0,
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
              text: "",
              error: e instanceof Error ? e.message : "failed",
            };
          }
        })(),
      );
    }
  }

  return Promise.all(jobs);
}
