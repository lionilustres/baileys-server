const WORKER_URL = "https://chat.hostweb.workers.dev";

await fetch(`${WORKER_URL}/incoming?token=UID`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chatId, text })
});