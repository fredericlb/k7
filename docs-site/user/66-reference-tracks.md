# Reference tracks

A **reference track** is a finished recording you keep in the workspace to listen against: a commercial master you are aiming for, the previous version of your mix, a band's last album. It is never part of a project.

Reference tracks are played by your **browser**, not by the engine. That means a reference can sound over a live rig or over an arrangement that is playing, without stopping either, and that it comes out of the browser's audio output, which may not be your interface.

## Where they live

Reference tracks are audio files in `_references/` at the root of the workspace, in sub-folders if you like. They are the same whichever project of the workspace is open.

Accepted formats: `.wav`, `.flac`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.aif`, `.aiff`, `.webm`. Whether a file actually plays depends on what your browser can decode.

## The reference panel

Open it with the headphones icon in the footer, or `ui references` from the command bar. It docks on the right.

| Part | What it does |
|---|---|
| `+` | **Add reference tracks**: pick one or more audio files to upload into `_references/`. Progress shows as "file — 40%". |
| A row | The track's name (the file name without extension) and its size. Click it to play; click the playing row again to pause. |
| Trash icon on a row | **Remove this reference track**. The file goes to the workspace's recycle bin rather than being destroyed. |
| `×` | Closes the panel. |

## The reference bar

Choosing a track opens a player bar at the bottom of the shell, above the status line. It stays there while you switch panes and close the panel.

| Element | Meaning |
|---|---|
| Play / pause | Starts or pauses the track. |
| Position slider | Seek anywhere in the track. |
| Name, and the folder | The folder under `_references/` is shown beside the name, since two bounces are often called the same thing. |
| "this browser's output" | A reminder that the sound does not go through the engine. |
| "ended" | The track reached its end; play starts it again. |
| "this browser cannot decode this file" | The format is not supported by this browser. |
| Close | Stops the track and removes the bar. |

## A/B against a mix

1. Upload the reference into `_references/`.
2. Start your arrangement or your rig on the engine as usual.
3. Click the reference in the panel. Pause it, then use the bar's play/pause to switch between hearing it and not.

Both sound together unless you stop one of them: the browser and the engine are separate. If your interface is not the browser's output device, the reference comes out elsewhere; set the browser's or the system's output to match. Levels are not matched for you.
