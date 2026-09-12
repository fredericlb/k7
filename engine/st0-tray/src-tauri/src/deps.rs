// deps.rs — the two CLIs the stack shells out to and cannot work without, probed before any
// of it is spawned. The tray is where this belongs: the supervisor and the file service are
// its descendants and inherit its environment, so what THIS process finds on PATH is exactly
// what they will find. A missing one is terminal rather than a warning — see docs/tray.md.

use std::process::Command;

/// One dependency: the arguments that prove `git` can do it, the name to say, and where to get it.
type Dep = (&'static str, &'static [&'static str], &'static str);

const NEEDED: [Dep; 2] = [
    ("git", &["--version"], "https://git-scm.com"),
    ("git-lfs", &["lfs", "version"], "https://git-lfs.com"),
];

/// What a missing one costs, said where the person can still act on it.
const WHY: &str = "\nEvery workspace is a git repository, and a song's audio is kept in git LFS. \
Without both, importing a repository fails, and its audio arrives as pointer text rather than \
sound — a project that opens, draws all its tracks and plays silence.\n\n\
Install what is listed above, then start st0 again.";

/// Run one probe. Anything but a clean exit reads as absent, an executable that is not there included.
fn present(program: &str, args: &[&str]) -> bool {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — the tray is windowless
    }
    command
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// The words shown for a given set of absentees — apart from the probing, so it reads without a machine.
fn message_for(absent: &[Dep]) -> String {
    let mut out = String::from("st0 cannot start.\n\n");
    for (name, _, url) in absent {
        out.push_str(&format!("    {name} is not installed — {url}\n"));
    }
    out.push_str(WHY);
    out
}

/// The message naming everything missing and where to get it, or None when the machine is ready.
pub fn missing() -> Option<String> {
    let absent: Vec<Dep> = NEEDED
        .into_iter()
        .filter(|(_, probe, _)| !present("git", probe))
        .collect();
    if absent.is_empty() {
        return None;
    }
    Some(message_for(&absent))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_each_missing_dependency_and_where_to_get_it() {
        let text = message_for(&NEEDED);
        assert!(text.contains("git is not installed — https://git-scm.com"));
        assert!(text.contains("git-lfs is not installed — https://git-lfs.com"));
    }

    #[test]
    fn says_what_a_missing_one_costs() {
        // Without this the dialog reads as a formality, and a person clicks past it.
        assert!(message_for(&NEEDED[..1]).contains("plays silence"));
    }

    #[test]
    fn an_executable_that_is_not_there_reads_as_absent() {
        // The real failure on a machine without git: the spawn itself fails, rather than exiting non-zero.
        assert!(!present("st0-no-such-program", &["--version"]));
    }
}
