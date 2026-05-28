/**
 * Benchmark catalog — the fixed set of prompts and models the Lab's Benchmark
 * tool pits against each other (ported from the legacy lab.html). Pure data, so
 * both the client (checkboxes) and the server action (runner) import it.
 * Thinking and web tools are OFF during benchmarks for a fair comparison.
 */

export type BenchPrompt = { id: string; label: string; prompt: string; maxTokens: number };

export const BENCH_PROMPTS: BenchPrompt[] = [
  {
    id: "math",
    label: "Quick math",
    prompt: "What is 47 × 83? Respond with just the number and a one-sentence verification.",
    maxTokens: 120,
  },
  {
    id: "code",
    label: "Code generation",
    prompt:
      "Write a Python function `is_palindrome(s)` that returns True if the string is a palindrome, ignoring case and non-alphanumeric characters. Return only the function.",
    maxTokens: 320,
  },
  {
    id: "reason",
    label: "Reasoning puzzle",
    prompt:
      "If today is Wednesday, what day of the week will it be 100 days from now? Show your reasoning.",
    maxTokens: 240,
  },
  {
    id: "summary",
    label: "Summarization",
    prompt:
      "Summarize this in exactly one sentence: The domestic cat (Felis catus) is a small, carnivorous mammal kept by humans for companionship and to hunt pests. It is the only domesticated species of the family Felidae and is valued for its agility, independence, and affectionate nature.",
    maxTokens: 120,
  },
  {
    id: "haiku",
    label: "Creative — haiku",
    prompt:
      "Write a 5-7-5 haiku about debugging code at 3am. Just the three lines, no preamble.",
    maxTokens: 80,
  },
  {
    id: "recall",
    label: "Knowledge recall",
    prompt:
      'Who composed Symphony No. 3 in E♭ major, "Eroica", and in what year was it completed? Answer in one sentence.',
    maxTokens: 100,
  },
];

export type BenchModel = { id: string; label: string };

export const BENCH_MODELS: BenchModel[] = [
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export type BenchResult = {
  model: string;
  promptId: string;
  ok: boolean;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number; // exact dollars (unrounded — benchmark costs are sub-cent)
  text: string;
  error?: string;
};
