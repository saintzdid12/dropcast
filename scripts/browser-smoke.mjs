// Optional real-Chromium integration check. Uses an installed Chrome/Edge; no download.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

const candidates = [
  process.env.CHROME_PATH,
  `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe`,
  `${process.env["ProgramFiles(x86)"]}/Microsoft/Edge/Application/msedge.exe`,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browser = candidates.find((file) => file && existsSync(file));
if (!browser)
  throw new Error(
    "Set CHROME_PATH to an installed Chrome, Chromium, or Edge executable.",
  );
const temp = await mkdtemp(path.join(os.tmpdir(), "dropcast-browser-"));
const server = await createApp({ dataFile: path.join(temp, "show.json") });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--user-data-dir=${path.join(temp, "profile")}`,
    "--remote-debugging-port=0",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error("Browser startup timed out.")),
      20000,
    );
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.on("error", reject);
  });
  const port = new URL(endpoint).port;
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(
    tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timeout);
        pending.delete(message.id);
        message.error
          ? request.reject(new Error(message.error.message))
          : request.resolve(message.result);
      }
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      const timeout = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`Timed out: ${method}`));
      }, 10000);
      pending.set(key, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression) => {
    const result = await evaluate(
      `new Promise((resolve, reject) => { const started = Date.now(); const check = () => { if (${expression}) resolve(true); else if (Date.now() - started > 5000) reject(new Error('Condition timed out')); else setTimeout(check, 40); }; check(); })`,
    );
    assert.equal(result, true);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: base });
  await wait(
    `document.querySelector('#connection')?.textContent === 'Connected to show'`,
  );
  await evaluate(
    `(() => { const el = document.querySelector('#estimatedQual'); el.value = 350; el.dispatchEvent(new Event('change', {bubbles:true})); })()`,
  );
  await wait(
    `document.querySelector('.qual-bar')?.textContent.includes('350')`,
  );
  await evaluate(
    `document.querySelector('[data-feature="417e41751d5049f0b2253dbb933e88a8"]').click()`,
  );
  await wait(
    `document.querySelector('[data-feature="417e41751d5049f0b2253dbb933e88a8"]')?.textContent === 'Featured'`,
  );
  await evaluate(`document.querySelector('#view-featured').click()`);
  await wait(
    `document.querySelector('.featured-name')?.textContent === 'dzd glo + ARM Saynxǃ'`,
  );
  assert.deepEqual(
    await evaluate(
      `[...document.querySelectorAll('.featured-stats span')].map(el => el.textContent)`,
    ),
    ["Matches", "Wins", "Elims", "Points"],
  );
  assert.deepEqual(
    await evaluate(
      `[...document.querySelectorAll('.featured-stats strong')].map(el => el.textContent)`,
    ),
    ["3", "2", "44", "200"],
  );
  await evaluate(`document.querySelector('#toggle-clock').click()`);
  await wait(
    `document.querySelector('#toggle-clock')?.textContent === 'Pause clock'`,
  );
  await evaluate(`document.querySelector('#visibility').click()`);
  await wait(
    `document.querySelector('#visibility')?.textContent === 'Show overlay'`,
  );
  await send("Page.navigate", { url: `${base}/overlay?view=featured` });
  await wait(
    `document.querySelector('.board.is-hidden') && document.querySelector('.featured-name')?.textContent === 'dzd glo + ARM Saynxǃ'`,
  );
  assert.equal(
    await evaluate(`getComputedStyle(document.body).backgroundColor`),
    "rgba(0, 0, 0, 0)",
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.documentElement).backgroundColor`,
    ),
    "rgba(0, 0, 0, 0)",
  );
  const state = await (await fetch(`${base}/api/state`)).json();
  state.visible = true;
  state.currentQualOverride = 275;
  state.teams[1].placeOverride = 42;
  const update = await fetch(`${base}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  assert.equal(update.status, 200);
  await wait(
    `document.querySelector('.board:not(.is-hidden)') && document.querySelector('.qual-bar')?.textContent.includes('275') && document.querySelector('.featured-place')?.textContent.includes('#42')`,
  );
  for (const width of [320, 375, 768, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await send("Page.navigate", { url: base });
    await wait(
      `document.querySelector('#connection')?.textContent === 'Connected to show'`,
    );
    assert.equal(
      await evaluate(`document.documentElement.scrollWidth <= ${width}`),
      true,
      `Page overflow at ${width}px`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: operator edits, featured selection, timer, visibility, transparent overlay, cross-page live updates, manual rank/cutoff, and 320/375/768/1440px overflow.",
  );
} finally {
  if (socket) socket.close();
  child.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
