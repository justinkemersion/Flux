/**
 * Minimal SMTP client for short ops alert mail.
 * Supports implicit TLS (smtps / port 465), STARTTLS, AUTH PLAIN, AUTH LOGIN.
 */

import { createConnection, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type SmtpMail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};

export type SmtpTransportConfig = {
  host: string;
  port: number;
  /** Implicit TLS from connect (smtps / 465). */
  secure: boolean;
  user?: string;
  pass?: string;
  timeoutMs: number;
};

type SmtpSocket = Socket | TLSSocket;

export type SmtpReply = {
  code: number;
  text: string;
};

export function encodeSmtpAuthPlain(user: string, pass: string): string {
  return Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
}

export function smtpDotStuff(body: string): string {
  return body.replace(/^\./gm, "..");
}

export function formatSmtpData(mail: SmtpMail, now: Date = new Date()): string {
  const toHeader = mail.to.join(", ");
  const date = now.toUTCString();
  const subject = encodeSmtpHeaderValue(mail.subject);
  const text = smtpDotStuff(mail.text.replace(/\r?\n/g, "\r\n"));
  return [
    `From: ${mail.from}`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
  ].join("\r\n");
}

function encodeSmtpHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

type LineWaiter = {
  resolve: (line: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class LineReader {
  private leftover = "";
  private readonly queue: string[] = [];
  private waiter: LineWaiter | null = null;
  private closedError: Error | null = null;
  private socket: SmtpSocket | null = null;
  private readonly onData = (chunk: Buffer | string) => {
    this.leftover += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.flush();
  };
  private readonly onEnd = () => this.close(new Error("SMTP connection closed"));
  private readonly onError = (err: Error) => this.close(err);

  constructor(socket: SmtpSocket) {
    this.bind(socket);
  }

  bind(socket: SmtpSocket): void {
    this.unbind();
    this.socket = socket;
    socket.on("data", this.onData);
    socket.on("end", this.onEnd);
    socket.on("error", this.onError);
  }

  unbind(): void {
    if (!this.socket) return;
    this.socket.off("data", this.onData);
    this.socket.off("end", this.onEnd);
    this.socket.off("error", this.onError);
    this.socket = null;
  }

  async readLine(timeoutMs: number): Promise<string> {
    if (this.closedError) throw this.closedError;
    if (this.queue.length > 0) return this.queue.shift()!;
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter?.resolve === resolve) this.waiter = null;
        reject(new Error(`SMTP timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  private flush(): void {
    let idx: number;
    while ((idx = this.leftover.indexOf("\n")) >= 0) {
      const raw = this.leftover.slice(0, idx);
      this.leftover = this.leftover.slice(idx + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (this.waiter) {
        const wait = this.waiter;
        this.waiter = null;
        clearTimeout(wait.timer);
        wait.resolve(line);
      } else {
        this.queue.push(line);
      }
    }
  }

  private close(err: Error): void {
    this.closedError = err;
    if (!this.waiter) return;
    const wait = this.waiter;
    this.waiter = null;
    clearTimeout(wait.timer);
    wait.reject(err);
  }
}

function isTlsSocket(socket: SmtpSocket): socket is TLSSocket {
  return "encrypted" in socket && Boolean((socket as TLSSocket).encrypted);
}

async function connectSmtp(config: SmtpTransportConfig): Promise<SmtpSocket> {
  return await new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    if (config.secure) {
      const socket = tlsConnect(
        {
          host: config.host,
          port: config.port,
          servername: config.host,
          timeout: config.timeoutMs,
        },
        () => {
          socket.off("error", onError);
          resolve(socket);
        },
      );
      socket.once("error", onError);
      socket.setTimeout(config.timeoutMs, () => {
        socket.destroy();
        reject(new Error(`SMTP TLS connect timed out after ${String(config.timeoutMs)}ms`));
      });
      return;
    }
    const socket = createConnection({ host: config.host, port: config.port }, () => {
      socket.off("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
    socket.setTimeout(config.timeoutMs, () => {
      socket.destroy();
      reject(new Error(`SMTP connect timed out after ${String(config.timeoutMs)}ms`));
    });
  });
}

async function upgradeToTls(
  socket: Socket,
  host: string,
  timeoutMs: number,
): Promise<TLSSocket> {
  return await new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    const tlsSocket = tlsConnect(
      {
        socket,
        servername: host,
        timeout: timeoutMs,
      },
      () => {
        tlsSocket.off("error", onError);
        resolve(tlsSocket);
      },
    );
    tlsSocket.once("error", onError);
  });
}

export async function readSmtpReply(
  readLine: () => Promise<string>,
): Promise<SmtpReply> {
  const first = await readLine();
  if (!/^\d{3}[ -]/.test(first)) {
    throw new Error(`Malformed SMTP reply: ${first}`);
  }
  const code = Number.parseInt(first.slice(0, 3), 10);
  const lines = [first.slice(4)];
  let current = first;
  while (current[3] === "-") {
    current = await readLine();
    if (!current.startsWith(String(code))) {
      throw new Error(`SMTP reply code mismatch: ${current}`);
    }
    lines.push(current.slice(4));
  }
  return { code, text: lines.join("\n") };
}

export async function sendSmtpMail(
  config: SmtpTransportConfig,
  mail: SmtpMail,
): Promise<void> {
  if (mail.to.length === 0) {
    throw new Error("SMTP send requires at least one recipient");
  }
  let socket: SmtpSocket | null = null;
  try {
    socket = await connectSmtp(config);
    socket.setTimeout(config.timeoutMs);
    let reader = new LineReader(socket);
    const timeoutMs = config.timeoutMs;
    const write = (line: string) => {
      socket!.write(`${line}\r\n`);
    };
    const expect = async (ok: (code: number) => boolean, label: string) => {
      const reply = await readSmtpReply(() => reader.readLine(timeoutMs));
      if (!ok(reply.code)) {
        throw new Error(`SMTP ${label} failed (${String(reply.code)}): ${reply.text}`);
      }
      return reply;
    };

    await expect((c) => c === 220, "greeting");
    write("EHLO flux");
    let ehlo = await expect((c) => c === 250, "EHLO");

    if (!config.secure && !isTlsSocket(socket) && /STARTTLS/i.test(ehlo.text)) {
      write("STARTTLS");
      await expect((c) => c === 220, "STARTTLS");
      reader.unbind();
      socket = await upgradeToTls(socket as Socket, config.host, timeoutMs);
      socket.setTimeout(timeoutMs);
      reader = new LineReader(socket);
      write("EHLO flux");
      ehlo = await expect((c) => c === 250, "EHLO after STARTTLS");
    }

    if (config.user && config.pass) {
      const authLine = ehlo.text.toUpperCase();
      if (authLine.includes("PLAIN") || !authLine.includes("LOGIN")) {
        write(`AUTH PLAIN ${encodeSmtpAuthPlain(config.user, config.pass)}`);
        await expect((c) => c === 235, "AUTH PLAIN");
      } else {
        write("AUTH LOGIN");
        await expect((c) => c === 334, "AUTH LOGIN");
        write(Buffer.from(config.user, "utf8").toString("base64"));
        await expect((c) => c === 334, "AUTH LOGIN username");
        write(Buffer.from(config.pass, "utf8").toString("base64"));
        await expect((c) => c === 235, "AUTH LOGIN password");
      }
    }

    write(`MAIL FROM:<${mail.from}>`);
    await expect((c) => c === 250, "MAIL FROM");
    for (const rcpt of mail.to) {
      write(`RCPT TO:<${rcpt}>`);
      await expect((c) => c === 250, "RCPT TO");
    }
    write("DATA");
    await expect((c) => c === 354, "DATA");
    socket.write(`${formatSmtpData(mail)}\r\n.\r\n`);
    await expect((c) => c === 250, "message body");
    write("QUIT");
    try {
      await expect((c) => c === 221, "QUIT");
    } catch {
      // Some servers close immediately after 250; ignore QUIT read failures.
    }
  } finally {
    socket?.destroy();
  }
}
