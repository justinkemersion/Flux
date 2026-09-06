import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import {
  DEFAULT_ALERT_EMAIL_FROM,
  formatOpsAlertBody,
  parseOpsAlertConfig,
  parseSmtpUrl,
  resetOpsAlertStateForTests,
  sendOpsAlert,
  setOpsAlertTestHooks,
  type OpsAlertTransport,
} from "./ops-alert-email.ts";
import { logBackupSchedulerError } from "./backup-scheduler-log.ts";
import {
  encodeSmtpAuthPlain,
  formatSmtpData,
  readSmtpReply,
  sendSmtpMail,
  smtpDotStuff,
} from "./ops-alert-smtp.ts";

const ENABLED_ENV = {
  FLUX_ALERT_EMAIL_TO: "justin@vsl-base.com",
  FLUX_SMTP_HOST: "mail.vsl-base.com",
  FLUX_SMTP_PORT: "587",
  FLUX_SMTP_USER: "flux",
  FLUX_SMTP_PASS: "secret",
  FLUX_ALERT_EMAIL_DEDUPE_HOURS: "6",
} as const;

function mockTransport(): OpsAlertTransport & { sent: Array<{ from: string; to: string[]; subject: string; text: string }> } {
  const sent: Array<{ from: string; to: string[]; subject: string; text: string }> = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
    },
  };
}

test("parseOpsAlertConfig is null without TO", () => {
  assert.equal(
    parseOpsAlertConfig({
      FLUX_SMTP_HOST: "mail.example.com",
    }),
    null,
  );
});

test("parseOpsAlertConfig is null without SMTP host or URL", () => {
  assert.equal(
    parseOpsAlertConfig({
      FLUX_ALERT_EMAIL_TO: "justin@vsl-base.com",
    }),
    null,
  );
});

test("parseOpsAlertConfig reads discrete SMTP fields and defaults", () => {
  const cfg = parseOpsAlertConfig({ ...ENABLED_ENV });
  assert.ok(cfg);
  assert.deepEqual(cfg!.to, ["justin@vsl-base.com"]);
  assert.equal(cfg!.from, DEFAULT_ALERT_EMAIL_FROM);
  assert.equal(cfg!.smtp.host, "mail.vsl-base.com");
  assert.equal(cfg!.smtp.port, 587);
  assert.equal(cfg!.smtp.secure, false);
  assert.equal(cfg!.smtp.user, "flux");
  assert.equal(cfg!.smtp.pass, "secret");
  assert.equal(cfg!.dedupeMs, 6 * 60 * 60 * 1000);
});

test("parseOpsAlertConfig uses implicit TLS on port 465", () => {
  const cfg = parseOpsAlertConfig({
    FLUX_ALERT_EMAIL_TO: "justin@vsl-base.com",
    FLUX_SMTP_HOST: "mail.vsl-base.com",
    FLUX_SMTP_PORT: "465",
  });
  assert.equal(cfg?.smtp.secure, true);
});

test("parseOpsAlertConfig accepts FLUX_SMTP_URL", () => {
  const cfg = parseOpsAlertConfig({
    FLUX_ALERT_EMAIL_TO: "justin@vsl-base.com, ops@vsl-base.com",
    FLUX_ALERT_EMAIL_FROM: "alerts@vsl-base.com",
    FLUX_SMTP_URL: "smtps://user%40vsl-base.com:p%40ss@mail.vsl-base.com:465",
  });
  assert.ok(cfg);
  assert.deepEqual(cfg!.to, ["justin@vsl-base.com", "ops@vsl-base.com"]);
  assert.equal(cfg!.from, "alerts@vsl-base.com");
  assert.equal(cfg!.smtp.host, "mail.vsl-base.com");
  assert.equal(cfg!.smtp.port, 465);
  assert.equal(cfg!.smtp.secure, true);
  assert.equal(cfg!.smtp.user, "user@vsl-base.com");
  assert.equal(cfg!.smtp.pass, "p@ss");
});

test("parseSmtpUrl rejects non-smtp schemes", () => {
  assert.throws(() => parseSmtpUrl("https://mail.example.com"), /smtp:\/\/ or smtps:\/\//);
});

test("formatOpsAlertBody stays short and includes project + timestamp", () => {
  const body = formatOpsAlertBody({
    source: "backup-scheduler",
    message: "platform freshness pipeline failed demo:abc1234",
    error: "restore_failed: no user tables",
    when: new Date("2026-09-06T08:00:00.000Z"),
    projectSlug: "demo",
    projectHash: "abc1234",
    backupId: "bkp_1",
  });
  assert.match(body, /source: backup-scheduler/);
  assert.match(body, /when: 2026-09-06T08:00:00.000Z/);
  assert.match(body, /project: demo:abc1234/);
  assert.match(body, /backupId: bkp_1/);
  assert.match(body, /error: platform freshness pipeline failed demo:abc1234/);
  assert.match(body, /detail: restore_failed: no user tables/);
});

test("sendOpsAlert is a no-op when SMTP env is unset and debug-logs once", async () => {
  resetOpsAlertStateForTests();
  const debug: string[] = [];
  const orig = console.debug;
  console.debug = (msg: unknown) => {
    debug.push(String(msg));
  };
  const transport = mockTransport();
  try {
    const first = await sendOpsAlert(
      { fingerprint: "tick", subject: "x", body: "y" },
      { env: {}, transport },
    );
    const second = await sendOpsAlert(
      { fingerprint: "tick", subject: "x", body: "y" },
      { env: {}, transport },
    );
    assert.equal(first.status, "skipped");
    assert.equal(first.status === "skipped" && first.reason, "disabled");
    assert.equal(second.status, "skipped");
    assert.equal(transport.sent.length, 0);
    assert.equal(debug.length, 1);
    assert.match(debug[0]!, /ops-alert-email: disabled/);
  } finally {
    console.debug = orig;
    resetOpsAlertStateForTests();
  }
});

test("sendOpsAlert uses mocked transport and dedupes the same fingerprint", async () => {
  resetOpsAlertStateForTests();
  const transport = mockTransport();
  const env = { ...ENABLED_ENV };
  const first = await sendOpsAlert(
    {
      fingerprint: "backup-scheduler:offsite replication failed backupId=abc",
      subject: "[Flux] backup-scheduler: offsite failed",
      body: "error: R2 timeout",
    },
    { env, transport, nowMs: 1_000 },
  );
  const again = await sendOpsAlert(
    {
      fingerprint: "backup-scheduler:offsite replication failed backupId=abc",
      subject: "[Flux] backup-scheduler: offsite failed",
      body: "error: R2 timeout again",
    },
    { env, transport, nowMs: 1_000 + 60 * 60 * 1000 },
  );
  const later = await sendOpsAlert(
    {
      fingerprint: "backup-scheduler:offsite replication failed backupId=abc",
      subject: "[Flux] backup-scheduler: offsite failed",
      body: "error: still failing",
    },
    { env, transport, nowMs: 1_000 + 7 * 60 * 60 * 1000 },
  );
  const other = await sendOpsAlert(
    {
      fingerprint: "backup-scheduler:tick failed",
      subject: "[Flux] backup-scheduler: tick failed",
      body: "error: boom",
    },
    { env, transport, nowMs: 1_000 },
  );
  assert.equal(first.status, "sent");
  assert.equal(again.status, "skipped");
  assert.equal(again.status === "skipped" && again.reason, "deduped");
  assert.equal(later.status, "sent");
  assert.equal(other.status, "sent");
  assert.equal(transport.sent.length, 3);
  assert.equal(transport.sent[0]!.to[0], "justin@vsl-base.com");
  assert.equal(transport.sent[0]!.from, DEFAULT_ALERT_EMAIL_FROM);
  resetOpsAlertStateForTests();
});

test("sendOpsAlert swallows transport failures and does not throw", async () => {
  resetOpsAlertStateForTests();
  const errors: string[] = [];
  const orig = console.error;
  console.error = (msg: unknown) => {
    errors.push(String(msg));
  };
  try {
    const result = await sendOpsAlert(
      { fingerprint: "x", subject: "s", body: "b" },
      {
        env: { ...ENABLED_ENV },
        transport: {
          async send() {
            throw new Error("relay down");
          },
        },
      },
    );
    assert.equal(result.status, "failed");
    assert.equal(result.status === "failed" && result.error, "relay down");
    assert.match(errors.join("\n"), /ops-alert-email: send failed/);
  } finally {
    console.error = orig;
    resetOpsAlertStateForTests();
  }
});

test("logBackupSchedulerError queues an alert with project context", async () => {
  resetOpsAlertStateForTests();
  const transport = mockTransport();
  setOpsAlertTestHooks({ env: { ...ENABLED_ENV }, transport });
  const origError = console.error;
  console.error = () => {};
  try {
    logBackupSchedulerError(
      "platform freshness pipeline failed bloom-atelier:0a1b2c3",
      new Error("restore_failed"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(transport.sent.length, 1);
    assert.equal(
      transport.sent[0]!.subject,
      "[Flux] backup-scheduler: platform freshness pipeline failed bloom-atelier:0a1b2c3",
    );
    assert.match(transport.sent[0]!.text, /project: bloom-atelier:0a1b2c3/);
    assert.match(transport.sent[0]!.text, /restore_failed/);
    assert.equal(transport.sent[0]!.to[0], "justin@vsl-base.com");
  } finally {
    console.error = origError;
    resetOpsAlertStateForTests();
  }
});

test("smtp helpers encode AUTH PLAIN and dot-stuff DATA", () => {
  assert.equal(
    encodeSmtpAuthPlain("user", "pass"),
    Buffer.from("\0user\0pass").toString("base64"),
  );
  assert.equal(smtpDotStuff("ok\n.hidden\nend"), "ok\n..hidden\nend");
  const data = formatSmtpData({
    from: "flux-alerts@vsl-base.com",
    to: ["justin@vsl-base.com"],
    subject: "hello",
    text: "line1\n.line2",
  });
  assert.match(data, /^From: flux-alerts@vsl-base.com/m);
  assert.match(data, /^To: justin@vsl-base.com/m);
  assert.match(data, /\r\n\.\.line2/);
});

test("readSmtpReply joins hyphen continuations", async () => {
  const lines = ["250-mail.example", "250-STARTTLS", "250 AUTH PLAIN"];
  let i = 0;
  const reply = await readSmtpReply(async () => lines[i++]!);
  assert.equal(reply.code, 250);
  assert.match(reply.text, /STARTTLS/);
  assert.match(reply.text, /AUTH PLAIN/);
});

test("sendSmtpMail talks to a mocked SMTP server", async () => {
  const captured: string[] = [];
  const server = createServer((socket) => {
    let buf = "";
    let dataMode = false;
    socket.write("220 mock ESMTP\r\n");
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (dataMode) {
        if (buf.includes("\r\n.\r\n")) {
          captured.push(buf);
          buf = "";
          dataMode = false;
          socket.write("250 OK\r\n");
        }
        return;
      }
      const parts = buf.split("\r\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        captured.push(line);
        if (line.startsWith("EHLO")) {
          socket.write("250-mock\r\n250 AUTH PLAIN\r\n");
        } else if (line.startsWith("AUTH PLAIN")) {
          socket.write("235 2.7.0 OK\r\n");
        } else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) {
          socket.write("250 OK\r\n");
        } else if (line === "DATA") {
          dataMode = true;
          socket.write("354 go\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await sendSmtpMail(
      {
        host: "127.0.0.1",
        port,
        secure: false,
        user: "flux",
        pass: "secret",
        timeoutMs: 3000,
      },
      {
        from: "flux-alerts@vsl-base.com",
        to: ["justin@vsl-base.com"],
        subject: "Flux alert",
        text: "tick failed",
      },
    );
    assert.ok(captured.some((l) => l.startsWith("EHLO")));
    assert.ok(
      captured.some((l) => l.startsWith(`AUTH PLAIN ${encodeSmtpAuthPlain("flux", "secret")}`)),
    );
    assert.ok(captured.some((l) => l.startsWith("MAIL FROM:<flux-alerts@vsl-base.com>")));
    assert.ok(captured.some((l) => l.startsWith("RCPT TO:<justin@vsl-base.com>")));
    const data = captured.find((l) => l.includes("Subject: Flux alert"));
    assert.ok(data);
    assert.match(data!, /tick failed/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
