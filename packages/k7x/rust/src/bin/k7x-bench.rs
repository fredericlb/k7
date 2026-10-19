// k7x-bench.rs — the Rust half of ../../bench/compare.ts: dumps every tree for the parity check, and times the parse.
// A reader would get wrong what one pass is: every file parsed once and its tree freed, the text already in memory.

use k7x::json::{map_tree_json, utf16_offsets};
use k7x::{Bump, parse_tree};
use std::hint::black_box;
use std::io::Write;
use std::time::Instant;
use std::{env, fs};

fn load(list: &str) -> Vec<String> {
    let names = fs::read_to_string(list).expect("file list");
    names
        .lines()
        .filter(|l| !l.is_empty())
        .map(|f| fs::read_to_string(f).expect(f))
        .collect()
}

fn dump(files: &[String], out: &str) {
    let mut w = std::io::BufWriter::new(fs::File::create(out).expect("dump file"));
    for text in files {
        let u = utf16_offsets(text);
        let bump = Bump::new();
        let mut line = String::new();
        match parse_tree(text, &bump) {
            Ok(tree) => map_tree_json(&tree, &u, &mut line),
            Err(e) => {
                let msg = e.message.replace('\\', "\\\\").replace('"', "\\\"");
                line = format!(
                    "{{\"error\":{{\"message\":\"{msg}\",\"offset\":{},\"line\":{},\"column\":{}}}}}",
                    u[e.offset], e.line, e.column
                );
            }
        }
        writeln!(w, "{line}").unwrap();
    }
}

/// `fresh` gives each file an arena of its own, as a cached document would hold; `reuse` resets one between files.
fn pass(files: &[String], reuse: &mut Option<Bump>) -> f64 {
    let t = Instant::now();
    for text in files {
        if let Some(bump) = reuse.as_mut() {
            let _ = black_box(parse_tree(black_box(text), bump));
            bump.reset();
        } else {
            let bump = Bump::new();
            let _ = black_box(parse_tree(black_box(text), &bump));
        }
    }
    t.elapsed().as_secs_f64() * 1000.0
}

fn bench(files: &[String], iters: usize, mode: &str) {
    let mut reuse = (mode == "reuse").then(Bump::new);
    let cold = pass(files, &mut reuse);
    let mut runs: Vec<f64> = (0..iters).map(|_| pass(files, &mut reuse)).collect();
    runs.sort_by(f64::total_cmp);
    let bytes: usize = files.iter().map(String::len).sum();
    println!(
        "{{\"cold\":{cold},\"min\":{},\"median\":{},\"files\":{},\"bytes\":{bytes}}}",
        runs[0],
        runs[runs.len() / 2],
        files.len()
    );
}

fn main() {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("dump") => dump(&load(&args[2]), &args[3]),
        Some("bench") => bench(
            &load(&args[2]),
            args.get(3).map_or(50, |n| n.parse().unwrap()),
            args.get(4).map_or("fresh", String::as_str),
        ),
        _ => eprintln!(
            "usage: k7x-bench dump <list> <out.jsonl> | bench <list> [iters] [fresh|reuse]"
        ),
    }
}
