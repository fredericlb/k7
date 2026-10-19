// parse.rs — k7x text → the span-carrying tree of ast.rs, decision for decision the parser of ../src/parse.ts.
// A reader would get wrong where the tree lives: in the caller's Bump, so dropping it is one arena reset (docs/rust.md).

mod lex;

use crate::ast::{Entry, ListForm, MapForm, MapNode, Node, Scalar};
use bumpalo::Bump;
use std::collections::HashSet;
use std::fmt;

/// How deep values may nest: far past any real file, and short of the stack a hostile one would exhaust.
pub const MAX_DEPTH: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntaxError {
    pub message: String,
    pub offset: usize,
    pub line: usize,
    /// Counted in UTF-16 units, as the TypeScript parser counts it.
    pub column: usize,
}

impl fmt::Display for SyntaxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({}:{})", self.message, self.line, self.column)
    }
}

impl std::error::Error for SyntaxError {}

type Res<T> = Result<T, SyntaxError>;

struct Parser<'a> {
    src: &'a str,
    b: &'a [u8],
    bump: &'a Bump,
    pos: usize,
    depth: usize,
    /// Set when a lone surrogate escape was read as U+FFFD, which TypeScript would have kept.
    lossy: bool,
    /// Children being collected, shared by every open container: each is copied into the arena once, at its size.
    nodes: Vec<Node<'a>>,
    entries: Vec<Entry<'a>>,
}

impl<'a> Parser<'a> {
    fn root(&mut self) -> Res<MapNode<'a>> {
        let mut groups = Vec::new();
        self.skip()?;
        while self.pos < self.b.len() {
            if self.cur() == b';' {
                self.pos += 1;
                self.skip()?;
                continue;
            }
            let first = self.entries.len();
            self.chain_entries()?;
            groups.push((first, self.entries.len()));
            self.skip()?;
        }
        self.check_unique(&self.entries)?;
        Ok(MapNode {
            entries: self.take_entries(0),
            form: MapForm::Root,
            groups: self.bump.alloc_slice_copy(&groups),
            start: 0,
            end: self.b.len(),
        })
    }

    /// A chain's calls, left on the entry stack and checked for duplicates.
    fn chain_entries(&mut self) -> Res<usize> {
        let mark = self.entries.len();
        let head = self.call(None)?;
        self.entries.push(head);
        while self.next_is(b'.')? {
            self.skip()?;
            let dot = self.pos;
            self.pos += 1;
            self.skip()?;
            let e = self.call(Some(dot))?;
            self.entries.push(e);
        }
        self.check_unique(&self.entries[mark..])?;
        Ok(mark)
    }

    fn chain(&mut self) -> Res<MapNode<'a>> {
        let start = self.pos;
        let mark = self.chain_entries()?;
        let entries = self.take_entries(mark);
        Ok(MapNode {
            entries,
            form: MapForm::Chain,
            groups: &[],
            start,
            end: entries[entries.len() - 1].end,
        })
    }

    fn take_entries(&mut self, mark: usize) -> &'a [Entry<'a>] {
        let out = self.bump.alloc_slice_copy(&self.entries[mark..]);
        self.entries.truncate(mark);
        out
    }

    fn take_nodes(&mut self, mark: usize) -> &'a [Node<'a>] {
        let out = self.bump.alloc_slice_copy(&self.nodes[mark..]);
        self.nodes.truncate(mark);
        out
    }

    fn call(&mut self, dot: Option<usize>) -> Res<Entry<'a>> {
        let key_start = self.pos;
        let key = self.key()?;
        let key_end = self.pos;
        self.skip()?;
        if self.cur() != b'(' {
            return self.fail(format!("expected \"(\" after {key}"), self.pos);
        }
        self.pos += 1;
        let open = self.pos;
        let mark = self.nodes.len();
        self.skip()?;
        while self.cur() != b')' {
            let v = self.value()?;
            self.nodes.push(v);
            self.skip()?;
            match self.cur() {
                b',' => {
                    self.pos += 1;
                    self.skip()?;
                }
                b')' => {}
                _ => return self.fail("expected \",\" or \")\"", self.pos),
            }
        }
        let close = self.pos;
        self.pos += 1;
        let value = match self.nodes.len() - mark {
            0 => Node::Scalar {
                value: Scalar::Bool(true),
                start: open,
                end: open,
            },
            1 => self.nodes.pop().unwrap(),
            _ => {
                let items = self.take_nodes(mark);
                Node::List {
                    items,
                    form: ListForm::Args,
                    start: items[0].start(),
                    end: items[items.len() - 1].end(),
                }
            }
        };
        Ok(Entry {
            key,
            value,
            start: dot.unwrap_or(key_start),
            end: close + 1,
            dot,
            key_start,
            key_end,
        })
    }

    fn key(&mut self) -> Res<&'a str> {
        let c = self.cur();
        if c == b'"' || c == b'\'' {
            return self.quoted();
        }
        match self.ident(self.pos) {
            Some(end) => {
                let k = &self.src[self.pos..end];
                self.pos = end;
                Ok(k)
            }
            None => self.fail("expected a key", self.pos),
        }
    }

    fn value(&mut self) -> Res<Node<'a>> {
        if self.depth >= MAX_DEPTH {
            return self.fail(format!("nested deeper than {MAX_DEPTH}"), self.pos);
        }
        self.depth += 1;
        let v = self.value_at();
        self.depth -= 1;
        v
    }

    fn value_at(&mut self) -> Res<Node<'a>> {
        let start = self.pos;
        match self.cur() {
            b'[' => return self.list(),
            b'{' => return self.object().map(Node::Map),
            b'`' => {
                let s = self.raw()?;
                return Ok(self.scalar(Scalar::Str(s), start));
            }
            b'"' | b'\'' => {
                let s = self.quoted()?;
                if !self.next_is(b'(')? {
                    return Ok(self.scalar(Scalar::Str(s), start));
                }
                self.pos = start;
                return self.chain().map(Node::Map);
            }
            b'-' | b'0'..=b'9' => {
                let Some(end) = self.number(start) else {
                    return self.fail("malformed number", self.pos);
                };
                self.pos = end;
                let n: f64 = self.src[start..end].parse().unwrap_or(f64::NAN);
                return Ok(self.scalar(Scalar::Num(n), start));
            }
            _ => {}
        }
        let Some(end) = self.ident(start) else {
            return self.fail("expected a value", self.pos);
        };
        self.pos = end;
        if self.next_is(b'(')? {
            self.pos = start;
            return self.chain().map(Node::Map);
        }
        let value = match &self.src[start..end] {
            "true" => Scalar::Bool(true),
            "false" => Scalar::Bool(false),
            "null" => Scalar::Null,
            w => {
                return self.fail(
                    format!("bare word \"{w}\": quote a string, or call it as {w}(…)"),
                    start,
                );
            }
        };
        Ok(self.scalar(value, start))
    }

    #[inline]
    fn scalar(&self, value: Scalar<'a>, start: usize) -> Node<'a> {
        Node::Scalar {
            value,
            start,
            end: self.pos,
        }
    }

    fn list(&mut self) -> Res<Node<'a>> {
        let start = self.pos;
        self.pos += 1;
        let mark = self.nodes.len();
        self.skip()?;
        while self.cur() != b']' {
            if self.pos >= self.b.len() {
                return self.fail("unclosed \"[\"", start);
            }
            let v = self.value()?;
            self.nodes.push(v);
            self.skip()?;
            match self.cur() {
                b',' => {
                    self.pos += 1;
                    self.skip()?;
                }
                b']' => {}
                _ => return self.fail("expected \",\" or \"]\"", self.pos),
            }
        }
        self.pos += 1;
        Ok(Node::List {
            items: self.take_nodes(mark),
            form: ListForm::Brackets,
            start,
            end: self.pos,
        })
    }

    fn object(&mut self) -> Res<MapNode<'a>> {
        let start = self.pos;
        self.pos += 1;
        let mark = self.entries.len();
        self.skip()?;
        while self.cur() != b'}' {
            if self.pos >= self.b.len() {
                return self.fail("unclosed \"{\"", start);
            }
            let key_start = self.pos;
            let key = self.key()?;
            let key_end = self.pos;
            self.skip()?;
            if self.cur() != b':' {
                return self.fail(format!("expected \":\" after {key}"), self.pos);
            }
            self.pos += 1;
            self.skip()?;
            let value = self.value()?;
            self.entries.push(Entry {
                key,
                value,
                start: key_start,
                end: value.end(),
                dot: None,
                key_start,
                key_end,
            });
            self.skip()?;
            match self.cur() {
                b',' => {
                    self.pos += 1;
                    self.skip()?;
                }
                b'}' => {}
                _ => return self.fail("expected \",\" or \"}\"", self.pos),
            }
        }
        self.pos += 1;
        self.check_unique(&self.entries[mark..])?;
        Ok(MapNode {
            entries: self.take_entries(mark),
            form: MapForm::Object,
            groups: &[],
            start,
            end: self.pos,
        })
    }

    fn check_unique(&self, entries: &[Entry<'a>]) -> Res<()> {
        let dup = if entries.len() <= 16 {
            entries
                .iter()
                .enumerate()
                .find(|(i, e)| entries[..*i].iter().any(|p| p.key == e.key))
                .map(|(_, e)| e)
        } else {
            let mut seen = HashSet::with_capacity(entries.len());
            entries.iter().find(|e| !seen.insert(e.key))
        };
        match dup {
            Some(e) => self.fail(format!("duplicate key \"{}\"", e.key), e.key_start),
            None => Ok(()),
        }
    }
}

/// The tree of a whole file, allocated in `bump`. An empty file is an empty map.
///
/// # Errors
/// A `SyntaxError` where the text is not k7x, with the TypeScript parser's message and position.
pub fn parse_tree<'a>(text: &'a str, bump: &'a Bump) -> Result<MapNode<'a>, SyntaxError> {
    parser(text, bump).root()
}

/// The same tree, or None where it differs from the TypeScript parser's: a lone surrogate escape read as U+FFFD.
///
/// # Errors
/// A `SyntaxError` where the text is not k7x, as `parse_tree`.
pub fn parse_tree_lossless<'a>(
    text: &'a str,
    bump: &'a Bump,
) -> Result<Option<MapNode<'a>>, SyntaxError> {
    let mut p = parser(text, bump);
    let tree = p.root()?;
    Ok((!p.lossy).then_some(tree))
}

fn parser<'a>(text: &'a str, bump: &'a Bump) -> Parser<'a> {
    Parser {
        src: text,
        b: text.as_bytes(),
        bump,
        pos: 0,
        depth: 0,
        lossy: false,
        nodes: Vec::new(),
        entries: Vec::new(),
    }
}
