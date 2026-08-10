import { readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const sourceConfigurationUrl = new URL(
  "public/assets/configuration.json",
  root,
);
const builtConfigurationUrl = new URL("dist/assets/configuration.json", root);
const builtHtmlUrl = new URL("dist/index.html", root);
const builtScriptUrl = new URL("dist/assets/index.js", root);

await Promise.all(
  [builtHtmlUrl, builtScriptUrl, builtConfigurationUrl].map(async (url) => {
    const details = await stat(url);
    if (!details.isFile() || details.size === 0) {
      throw new Error(`Missing or empty build artifact: ${url.pathname}`);
    }
  }),
);

const [sourceConfiguration, builtConfiguration, builtScript] =
  await Promise.all([
    readFile(sourceConfigurationUrl),
    readFile(builtConfigurationUrl),
    readFile(builtScriptUrl, "utf8"),
  ]);

if (!sourceConfiguration.equals(builtConfiguration)) {
  throw new Error("dist/assets/configuration.json differs from its source");
}

const configuration = JSON.parse(sourceConfiguration.toString("utf8"));
for (const catalog of Object.values(configuration.localization)) {
  for (const message of Object.values(catalog)) {
    if (typeof message === "string" && builtScript.includes(message)) {
      throw new Error("Localized copy was embedded in dist/assets/index.js");
    }
  }
}

console.log(
  "Verified dist/index.html, dist/assets/index.js, and dist/assets/configuration.json",
);
