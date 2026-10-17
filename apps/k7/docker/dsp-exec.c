// dsp-exec.c — installed setuid root, executable by group `node` only: it drops to the fixed `dsp` user,
// clears the environment and execs node with the caller's arguments. A jsdsp module runs through it.
// What a reader gets wrong: it can only LOWER privilege, to one compiled-in uid that owns nothing —
// packages/song/docs/jsdspJail.md.

#define _GNU_SOURCE
#include <grp.h>
#include <stdio.h>
#include <unistd.h>

#ifndef DSP_UID
#error "build with -DDSP_UID=<uid> -DDSP_GID=<gid>"
#endif

int main(int argc, char **argv) {
    (void)argc;
    if (setgroups(0, NULL) != 0 || setgid(DSP_GID) != 0 || setuid(DSP_UID) != 0) {
        perror("dsp-exec: drop to dsp");
        return 126;
    }
    // A process that could take root back has not dropped anything.
    if (setuid(0) == 0 || getuid() != DSP_UID || geteuid() != DSP_UID) {
        fputs("dsp-exec: privileges not dropped\n", stderr);
        return 126;
    }
    char *const envp[] = {NULL};
    argv[0] = "node";
    execve("/usr/local/bin/node", argv, envp);
    perror("dsp-exec: node");
    return 127;
}
