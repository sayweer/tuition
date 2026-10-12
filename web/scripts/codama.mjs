// Regenerates the typed program client from the Anchor IDL: `pnpm codama`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";

const idl = JSON.parse(
  readFileSync(new URL("../../idl/tuition_escrow.json", import.meta.url), "utf8"),
);
const codama = createFromRoot(rootNodeFromAnchor(idl));
await codama.accept(
  renderVisitor(fileURLToPath(new URL("..", import.meta.url)), {
    generatedFolder: "src/generated/tuition-escrow",
    kitImportStrategy: "rootOnly",
    syncPackageJson: false,
  }),
);
