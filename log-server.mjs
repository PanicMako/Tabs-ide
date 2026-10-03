import http from "http";
import fs from "fs";

http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "OPTIONS, POST");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      if (body) {
        console.log("RECEIVED LOG:", body);
        fs.appendFileSync("slider-debug.log", `[${new Date().toISOString()}] ${body}\n`);
      }
      res.writeHead(200);
      res.end("ok");
    });
  })
  .listen(9999, () => console.log("Log server listening on 9999"));
