import { createServer } from "node:http";

const port = Number(process.env.E2E_GROQ_PORT || 3101);
const requests: { question: string; context: any; model: string }[] = [];

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function reply(context: any) {
  const focus = context.focusedInvestigation;
  if (focus) {
    const apps = focus.package.applicationsAffected.map((a: any) => a.name).join(", ");
    return {
      answer: `Focused answer about **${focus.finding.id}** in ${focus.package.name}@${focus.package.installedVersion}. It reaches ${apps}.`,
      actions: [
        { type: "trace", target: focus.package.handle },
        { type: "evidence", target: "V1" },
      ],
      outOfScope: false,
    };
  }
  const app = context.pageFocus?.selectedApplication;
  const top = context.topPriorities?.[0];
  return {
    answer: `Global answer on ${context.currentPage.section}${app ? ` for ${app.name}` : ""}.`,
    actions: [
      { type: "section", target: "coverage" },
      ...(top ? [{ type: "package", target: top.handle }] : []),
    ],
    outOfScope: false,
  };
}

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (req.url === "/__requests") return send(res, 200, requests);
    if (req.headers.authorization !== "Bearer e2e-groq-key")
      return send(res, 401, { error: { message: "bad key" } });
    if (req.url === "/openai/v1/models")
      return send(res, 200, {
        data: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "whisper-large-v3-turbo"].map((id) => ({
          id,
          active: true,
        })),
      });
    if (req.url === "/openai/v1/audio/transcriptions")
      return send(res, 200, { text: "Which applications are affected?" });
    if (req.url === "/openai/v1/chat/completions") {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const system: string = body.messages[0].content;
      const context = JSON.parse(system.slice(system.indexOf("ROOTLINE_CONTEXT = ") + 19));
      requests.push({ question: body.messages.at(-1).content, context, model: body.model });
      return send(res, 200, { choices: [{ message: { content: JSON.stringify(reply(context)) } }] });
    }
    send(res, 404, { error: { message: "not found" } });
  });
}).listen(port, "127.0.0.1");
