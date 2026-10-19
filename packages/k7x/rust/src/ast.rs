// ast.rs — the tree a k7x file parses to, field for field the one of ../src/ast.ts.
// A reader would get wrong that a chain and an object are different data: both are maps, the form is only how it was written.

use std::borrow::Cow;

#[derive(Debug, Clone, PartialEq)]
pub enum Scalar<'a> {
    Str(Cow<'a, str>),
    Num(f64),
    Bool(bool),
    Null,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListForm {
    Brackets,
    Args,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapForm {
    Root,
    Chain,
    Object,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Node<'a> {
    Scalar {
        value: Scalar<'a>,
        start: usize,
        end: usize,
    },
    List {
        items: Vec<Node<'a>>,
        form: ListForm,
        start: usize,
        end: usize,
    },
    Map(MapNode<'a>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry<'a> {
    pub key: Cow<'a, str>,
    pub value: Node<'a>,
    pub start: usize,
    pub end: usize,
    /// Offset of the `.` that introduces a chained call; None for a chain's head and an object entry.
    pub dot: Option<usize>,
    pub key_start: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MapNode<'a> {
    pub entries: Vec<Entry<'a>>,
    pub form: MapForm,
    /// For the root, each statement's entries as [first, end) indices.
    pub groups: Vec<(usize, usize)>,
    pub start: usize,
    pub end: usize,
}

impl<'a> Node<'a> {
    pub fn start(&self) -> usize {
        match self {
            Node::Scalar { start, .. } | Node::List { start, .. } => *start,
            Node::Map(m) => m.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            Node::Scalar { end, .. } | Node::List { end, .. } => *end,
            Node::Map(m) => m.end,
        }
    }

    /// The node at a path of map keys and list indices, as nodeAt does.
    pub fn at(&self, path: &[PathSeg]) -> Option<&Node<'a>> {
        let mut node = self;
        for seg in path {
            node = match (node, seg) {
                (Node::Map(m), PathSeg::Key(k)) => &m.entries.iter().find(|e| e.key == *k)?.value,
                (Node::List { items, .. }, PathSeg::Index(i)) => items.get(*i)?,
                _ => return None,
            };
        }
        Some(node)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathSeg {
    Key(String),
    Index(usize),
}
