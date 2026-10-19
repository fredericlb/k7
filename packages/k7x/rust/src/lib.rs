// lib.rs — k7x parsed in Rust: the tree of ../src/ast.ts, built by a port of ../src/parse.ts.
// Spans are BYTE offsets into the UTF-8 text, where the TypeScript ones count UTF-16 units (docs/rust.md).

pub mod ast;
pub mod json;
mod parse;

pub use ast::{Entry, ListForm, MapForm, MapNode, Node, PathSeg, Scalar};
pub use bumpalo::Bump;
pub use parse::{MAX_DEPTH, SyntaxError, parse_tree};
