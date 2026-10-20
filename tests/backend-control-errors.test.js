const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadErrorMessage() {
  const source = fs.readFileSync("dist/backend-control-workspace.js", "utf8");
  const asText = source.slice(source.indexOf("  const asText ="), source.indexOf("  const safeJSON ="));
  const redactText = source.slice(source.indexOf("  const redactText ="), source.indexOf("  const redactUrl ="));
  const error = source.slice(source.indexOf("  const errorMessage ="), source.indexOf("\n\n  function domainDefinition"));
  const context = {URL, location: {origin: "http://localhost"}};
  vm.runInNewContext(`${asText}${redactText}${error}\nthis.errorMessage = errorMessage;`, context);
  return context.errorMessage;
}

function response(status, statusText, contentType) {
  return {status, statusText, headers: {get: name => name === "content-type" ? contentType : ""}};
}

test("backend controls replace HTML failures with a concise diagnostic", () => {
  const message = loadErrorMessage()("<!doctype html><html><body>proxy details</body></html>", response(502, "Bad Gateway", "text/html"));
  assert.match(message, /^HTTP 502 Bad Gateway\./);
  assert.match(message, /Technical details/);
  assert.doesNotMatch(message, /<html|proxy details/i);
});

test("backend controls keep structured API errors useful", () => {
  const message = loadErrorMessage()({detail: "Profile not found"}, response(404, "Not Found", "application/json"));
  assert.equal(message, "Profile not found");
});

test("backend controls bound and redact plain-text failures", () => {
  const body = `token: secret-value ${"x".repeat(400)}`;
  const message = loadErrorMessage()(body, response(500, "Internal Server Error", "text/plain"));
  assert.ok(message.length <= 241);
  assert.doesNotMatch(message, /secret-value/);
  assert.match(message, /\[redacted\]/);
});
