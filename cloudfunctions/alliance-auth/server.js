"use strict";

const http = require("http");
const { main } = require("./index");

const server = http.createServer(async (req, res) => {
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const result = await main({
        httpMethod: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.statusCode = result.statusCode || 200;
      for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
      res.end(result.body || "");
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: error.message || "internal_error" }));
    }
  });
});

server.listen(Number(process.env.PORT || 9000), "0.0.0.0");
