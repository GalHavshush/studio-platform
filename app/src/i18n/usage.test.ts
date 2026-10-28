/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import { en } from "./en";

// All source files that can ask for a key: not the dictionary itself, the generated API types or tests.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    const code = /\.tsx?$/.test(name) && !/\.test\.tsx?$|schema\.d\.ts$/.test(name) && name !== "en.ts";
    return code ? [readFileSync(path, "utf8")] : [];
  });
}

test("every key is used somewhere, so the dictionary has no dead text", () => {
  const code = sources(join(__dirname, "..")).join("\n");
  // "plan.seatsLeft.one" and ".other" are asked for together as "plan.seatsLeft".
  const unused = Object.keys(en).filter((key) => !code.includes(`"${key.replace(/\.(one|other)$/, "")}"`));

  expect(unused).toEqual([]);
});
