// assemblySchema.ts — the two files an ASSEMBLY is, in Zod. A template in the library declares
// the plugs and the params promoted onto the box (`assembly.yaml`, beside an ordinary `graph.yaml`
// and `nodes/`); a project's `assemblies/<name>.yaml` says which of its nodes are that box.
// An assembly is a DRAWING and AUTHORING fact: nothing here reaches the compiler or the engine.
// Full rationale: packages/song/docs/assemblies.md.

import { z } from "zod";

/** The folder a project keeps its assemblies in, and the library family they are authored in. */
export const ASSEMBLIES_DIR = "assemblies";

/** The file that makes a library folder an assembly rather than a chain template. */
export const ASSEMBLY_FILE = "assembly.yaml";

/** One PLUG: a port on the box, plus the member whose own port it stands for. */
export const AssemblyPlugSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["audio", "midi", "video"]),
    // The template MEMBER this plug is, by the name its own `graph.yaml` uses.
    node: z.string().min(1),
    // …and which of that member's ports, written only when the member declares several.
    port: z.string().min(1).optional(),
    mandatory: z.boolean().optional(),
  })
  .strict();

export type AssemblyPlug = z.infer<typeof AssemblyPlugSchema>;

/** One PROMOTED param: a knob on the box's face, and the member param it writes. */
export const AssemblyParamSchema = z
  .object({ node: z.string().min(1), param: z.string().min(1) })
  .strict();

export type AssemblyParam = z.infer<typeof AssemblyParamSchema>;

/** `assembly.yaml` — what the box IS, in the library. Its members and their wiring are the graph beside it. */
export const AssemblyTemplateSchema = z
  .object({
    // What the box is CALLED on the graph; absent, the instance's own name is drawn.
    label: z.string().min(1).optional(),
    inputs: z.array(AssemblyPlugSchema).optional(),
    outputs: z.array(AssemblyPlugSchema).optional(),
    params: z.record(z.string().min(1), AssemblyParamSchema).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    // A plug name is an address (`turntableA#mix`), so two of them on one side is a cable with no reading.
    for (const side of ["inputs", "outputs"] as const) {
      const seen = new Set<string>();
      for (const [i, p] of (a[side] ?? []).entries())
        if (seen.has(p.name))
          ctx.addIssue({
            code: "custom",
            path: [side, i, "name"],
            message: `two ${side} are called '${p.name}' — a plug name is what a cable names`,
          });
        else seen.add(p.name);
    }
  });

export type AssemblyTemplate = z.infer<typeof AssemblyTemplateSchema>;

/** `assemblies/<name>.yaml` — which of THIS project's nodes are that box. */
export const AssemblyFileSchema = z
  .object({
    // The template, by the ref a chain template is named by: `@k7-core/turntable`.
    uses: z.string().min(1),
    // The template's member name -> this project's node name; the indirection is what lets a
    // migration fold nodes that already exist without renaming one (docs/assemblies.md).
    members: z.record(z.string().min(1), z.string().min(1)),
  })
  .strict();

export type AssemblyFile = z.infer<typeof AssemblyFileSchema>;
