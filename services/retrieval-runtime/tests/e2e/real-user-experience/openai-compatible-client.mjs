import http from "node:http";
import https from "node:https";

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error("missing model base url");
  }
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function requestJson(url, payload, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const body = JSON.stringify(payload);
    const request = client.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "content-length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                `model request failed with ${response.statusCode}: ${
                  typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed).slice(0, 500)
                }`,
              ),
            );
            return;
          }

          resolve(parsed);
        });
      },
    );

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error(`model request timed out after ${timeoutMs}ms`));
    });
    request.write(body);
    request.end();
  });
}

export async function callOpenAiCompatibleChat({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  maxTokens = 1600,
  timeoutMs = 120000,
}) {
  const url = new URL("chat/completions", normalizeBaseUrl(baseUrl));
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const startedAt = Date.now();
  const raw = await requestJson(
    url,
    {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    },
    headers,
    timeoutMs,
  );
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`model response did not include choices[0].message.content: ${JSON.stringify(raw).slice(0, 500)}`);
  }

  return {
    content,
    raw,
    duration_ms: Date.now() - startedAt,
  };
}

export function extractJsonObject(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start >= 0) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
        inString = false;
        escaped = false;
      }
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // Keep scanning; local models sometimes wrap JSON with prose.
        }
        start = -1;
      }
    }
  }

  if (objects.length === 0) {
    throw new Error(`no JSON object found in text: ${text.slice(0, 500)}`);
  }

  return objects[objects.length - 1];
}
