// Pins every dependency on a sibling package to that sibling's current version
// (e.g. "*" -> "^0.2.0"), so a published package installs the versions it was
// built and tested against rather than whatever the registry holds. npm
// workspaces still link the local copies, as each local version satisfies its
// own range. Run after bumping versions and before publishing.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const { workspaces } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const pkgs = workspaces.map((dir) => {
   const file = join(root, dir, "package.json");
   return { file, json: JSON.parse(readFileSync(file, "utf8")) };
});
const versions = new Map(pkgs.map(({ json }) => [json.name, json.version]));

for (const { file, json } of pkgs) {
   let changed = false;
   for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
      for (const dep of Object.keys(json[field] ?? {})) {
         if (!versions.has(dep)) continue;
         const range = `^${versions.get(dep)}`;
         if (json[field][dep] !== range) {
            console.log(`${json.name}: ${dep} ${json[field][dep]} -> ${range}`);
            json[field][dep] = range;
            changed = true;
         }
      }
   }
   if (changed) writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}
