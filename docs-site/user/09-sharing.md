# Sharing a project

A **share link** lets anyone listen to a project as it is now, without an account. The listener
opens the link in a browser, sees the project read-only, plays it on the server's engine, and can
leave comments. You manage your links, and read the comments, from the home page.

## What a share is

- A share is the project **frozen at a checkpoint**. What you change afterwards is not part of it.
  The checkpoint stays in the project's history.
- It is played by the **server's engine**. Every visitor gets a session of their own on it.
- A visitor can play, stop and move through the song, and **mute or solo** tracks for themselves.
  They cannot change anything else.
- A visitor can **see** the tracks, the chains and the modules' parameters. The names of tracks,
  markers and modules, and the text of notes, are part of what they see.
- A share **does not expire**. It stays on the server until you take it down.

## Publishing a link

1. Open the project.
2. Open the share panel: click the share icon in the editor's toolbar (**Share / export**), or run
   `ui share`.
3. Under **Publish**, click **Share a link**. You can also run `project share link` directly.
4. A dialog, **Share this project as it is now?**, says what the link contains and who can see it.
   Click **Publish the link**.
5. k7 works through these steps, shown under the button and in the status line:

   | Step | Meaning |
   |---|---|
   | looking for VST tracks to render… | The server's engine may not have your plugins, so tracks that use them are rendered to audio first. |
   | rendering the VST tracks — n/total | Done on a machine that has the plugin. This can take a while. |
   | sending your last edits to the server… | |
   | naming the checkpoint… | |
   | building the shared version… | |
   | uploading — n / total MB | |

6. When it is done, the link is copied to the clipboard, and the status line says
   "link copied — N MB shared: &lt;link&gt;". If the browser refuses the clipboard, the status line
   still shows the link so you can copy it by hand.

Closing the panel during the steps does not stop them; only the progress bar goes away.

The link looks like `https://st0.app/@shares/<token>.k7`. It only works over https.

## What the visitor sees

The visitor opens the link with no sign-in. The editor opens on the frozen project:

- the project's name at the top left, and a **Shared version — read only; mute and solo are yours
  alone** badge;
- the transport, to play the song on the server's engine;
- the project's panes, with no text editor and no recording;
- a **Comments** button, which opens the comments panel.

In the comments panel, the visitor can:

1. type a name (optional; without one the comment is signed "someone") and a message;
2. click **Pin to the playhead** to attach the comment to the current position, or **Drop the
   timecode** to detach it;
3. click **Send**.

A comment pinned to a time shows **Play from here**, which plays the song from that point.
Everyone holding the link can read all comments, with the state you gave each one.

If the link was taken down or mistyped, the visitor sees **This link no longer works**.

## Managing shares from the home page

Each project row on the home page has a **Shares** button. The number of live links is shown in
brackets, and hovering the button shows how many links are published and how much space they take.

Click it to open **Shares of "&lt;project&gt;"**. Each share is listed with its date and its link
(click the link to see exactly what visitors see), its size, and three buttons:

| Button | What it does |
|---|---|
| **Comments** (with the number of active comments) | Opens what visitors wrote on that share. |
| Copy | Copies the link. |
| Delete (red) | Takes the share down, after confirmation. |

### Taking a share down

Taking a share down erases the shared version from the server at once: the link answers "not found"
for everyone who has it, for good. The row stays in the list, dated as withdrawn, and the checkpoint
stays in the project's history. Sharing the project again makes a **new** link; the old one never
comes back.

### Reading and sorting comments

The comments dialog has three tabs:

| Tab | Meaning |
|---|---|
| **Active** | New comments land here. |
| **Resolved** | Comments you dealt with. |
| **Ignored** | Comments you chose not to act on. |

Move a comment with **Resolve**, **Ignore**, or **Reopen**. Nothing is ever erased: resolving and
ignoring only take a comment out of the active list. Visitors see the state you give each comment,
but cannot change it.

## The rest of the share panel

The share panel holds more than the link. These entries are covered in other sections of this
guide:

| Entry | What it does |
|---|---|
| **Export MP3**, **Export WAV** | Render the mixdown through the engine and download it (`project export audio mp3`, `project export audio wav`). |
| **Export** a video | On a project with picture: render the picture with its sound and download it. |
| **Share to k7** | Publish the song to the rehearsal recorder as a release, with its stems (`project share k7`). The first time, it asks for the artist and the title. |
| **On another device** | QR codes for the project's surfaces, so a tablet or phone can drive one (same engine, same session). |
