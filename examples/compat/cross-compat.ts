/**
 * Cross-compatibility example: Start a conversation with OpenAI, continue on-device.
 *
 * Demonstrates that the tsfm compat layer accepts the same message format as
 * OpenAI, so you can seamlessly hand off a conversation between providers.
 *
 * Requires OPENAI_API_KEY in .env.local (see .env.local.example)
 *
 * Run: npm run example -- cross-compat
 */
import RealOpenAI from "openai";
import LocalOpenAI from "../../src/compat/index.js";

const cloud = new RealOpenAI();
const local = new LocalOpenAI();

// Keep a running messages array — same format for both providers
const messages: RealOpenAI.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: "You are a helpful travel advisor. Be concise — one or two sentences.",
  },
];

// ---------------------------------------------------------------------------
// Turn 1: OpenAI (cloud) — start the conversation
// ---------------------------------------------------------------------------
messages.push({
  role: "user",
  content: "I'm planning a trip to Japan. What city should I visit first?",
});

console.log("=== Turn 1 (OpenAI cloud) ===");
console.log("User:", messages[messages.length - 1].content);

const turn1 = await cloud.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});
const reply1 = turn1.choices[0].message.content!;
console.log("Assistant:", reply1);
messages.push({ role: "assistant", content: reply1 });
console.log();

// ---------------------------------------------------------------------------
// Turn 2: tsfm (on-device) — continue with the same messages
// ---------------------------------------------------------------------------
messages.push({ role: "user", content: "How many days should I spend there?" });

console.log("=== Turn 2 (Apple Intelligence on-device) ===");
console.log("User:", messages[messages.length - 1].content);

const turn2 = await local.chat.completions.create({
  model: "apple-intelligence",
  messages: messages as Parameters<typeof local.chat.completions.create>[0]["messages"],
});
const reply2 = turn2.choices[0].message.content!;
console.log("Assistant:", reply2);
messages.push({ role: "assistant", content: reply2 });
console.log();

// ---------------------------------------------------------------------------
// Turn 3: Back to OpenAI — it sees the full conversation including local turn
// ---------------------------------------------------------------------------
messages.push({ role: "user", content: "What's one must-see attraction there?" });

console.log("=== Turn 3 (OpenAI cloud) ===");
console.log("User:", messages[messages.length - 1].content);

const turn3 = await cloud.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
});
const reply3 = turn3.choices[0].message.content!;
console.log("Assistant:", reply3);
messages.push({ role: "assistant", content: reply3 });
console.log();

// ---------------------------------------------------------------------------
// Turn 4: Local again — seamless continuation
// ---------------------------------------------------------------------------
messages.push({ role: "user", content: "Summarize the trip plan so far in one sentence." });

console.log("=== Turn 4 (Apple Intelligence on-device) ===");
console.log("User:", messages[messages.length - 1].content);

const turn4 = await local.chat.completions.create({
  model: "apple-intelligence",
  messages: messages as Parameters<typeof local.chat.completions.create>[0]["messages"],
});
const reply4 = turn4.choices[0].message.content!;
console.log("Assistant:", reply4);
console.log();

// ---------------------------------------------------------------------------
// Print full transcript
// ---------------------------------------------------------------------------
console.log("=== Full transcript ===");
for (const msg of [...messages, { role: "assistant", content: reply4 }]) {
  const role = msg.role.toUpperCase().padEnd(10);
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  console.log(`${role} ${content}`);
}

local.close();
console.log("\nDone!");
