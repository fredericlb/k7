// k7x-bench.rs — the Rust half of ../../bench/compare.ts: dumps every tree for the parity check, and times the parse.
// A reader would get wrong what one pass is: every file of the list parsed once, its text already in memory.

use k7x::json::{map_tree_json, utf16_offsets};
use k7x::parse_tree;
use std::hint::black_box;
use std::io::Write;
use std::time::Instant;
use std::{env, fs};

fn load(list: &str) -> Vec<(String, String)> {
    let names = fs::read_to_string(list).expect("file list");
    names
        .lines()
        .filter(|l| !l.is_empty())
        .map(|f| (f.to_owned(), fs::read_to_string(f).expect(f)))
        .collect()
}

fn dump(files: &[(String, String)], out: &str) {
    let mut w = std::io::BufWriter::new(fs::File::create(out).expect("dump file"));
    for (_, text) in files {
        let u = utf16_offsets(text);
        let mut line = String::new();
        match parse_tree(text) {
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

fn pass(files: &[(String, String)]) -> f64 {
    let t = Instant::now();
    for (_, text) in files {
        let _ = black_box(parse_tree(black_box(text)));
    }
    t.elapsed().as_secs_f64() * 1000.0
}

fn bench(files: &[(String, String)], iters: usize) {
    let cold = pass(files);
    let mut runs: Vec<f64> = (0..iters).map(|_| pass(files)).collect();
    runs.sort_by(f64::total_cmp);
    let bytes: usize = files.iter().map(|(_, t)| t.len()).sum();
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
        ),
        Some("one") => {
            let text = fs::read_to_string(&args[2]).unwrap();
            let start = Instant::now();
            let tree = parse_tree(&text);
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            println!("{{\"ok\":{},\"ms\":{ms}}}", tree.is_ok());
        }
        _ => eprintln!(
            "usage: k7x-bench dump <list> <out.jsonl> | bench <list> [iters] | one <file>"
        ),
    }
}
