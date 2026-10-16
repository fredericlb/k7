// processChain.ts — apply a chain to MATERIAL: bounce a track's clips (or one clip, or one
// audio file) through a chain of the project or of this machine's médiathèque cache, write the
// render beside the original, and point the clip files at it. A bounce in place.
// The package's public face: resolveChain.ts picks the chain, bounce.ts runs it. See docs/processChain.md.

export {
  bounceDoc,
  bounceThroughChain,
  type ProcessResult,
  processWithChain,
  renderPath,
  repointClips,
  resolveTargets,
  type Scope,
  type Targets,
} from "./bounce";
export {
  type ColdChain,
  chainNames,
  coldChains,
  type ResolvedChain,
  resolveChain,
} from "./resolveChain";
