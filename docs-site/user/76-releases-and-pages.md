# Releases and pages

A **release** is a song you put out: a title, an artist, and one or more **versions** (mixes) of
its audio. A **page** is a public address, `/rehearsal/@<nametag>`, listing some of your releases
for others to listen to. Both live under **Publications** (`/rehearsal/releases`).

## The Publications list

Releases are grouped by the pages that list them; each page is a collapsible group, closed by
default, with its number of releases and an **Open** link to its public address. A release on two
pages shows under both. Releases on no page are listed last under "Not on a page".

The **+** button offers **New release** and **New page**.

## Creating a release

**New release** asks for:

| Field | Required |
|---|---|
| Title, Artist | Yes |
| Release date | No |
| Description | No |
| Allow users to download this release | Off by default |
| Audio file (the song) | Yes |
| First version name | No ("Version 1" by default) |

**Create release** uploads the audio and opens the release.

## A release's page

`/rehearsal/releases/<id>` shows the release's details, whether it is "downloadable by users" or
"download disabled", and its **Versions**, each as a card with its waveform.

- **Add a version**: pick an audio file, give it a name (for example "Mix 2"), and optionally tick
  **Make this the default version**. Then **Add version**.
- The release's menu: **Edit release** (title, artist, date, description, download permission) and
  **Delete release** (with all its versions, after a confirmation).

Each version's menu (**⋮**):

| Entry | Does |
|---|---|
| **Download** | Downloads that version |
| **Download stem: <name>** | Downloads one of the version's stems, when it has any |
| **Set as default** | Makes it the version pages play by default |
| **Hide from pages** / **Show on pages** | A hidden version is left out of a page's version list |
| **Replace the file…** | Uploads new audio for this version |
| **Delete version** | After a confirmation |

Every published version is also filed in the media library's Songs, under an artist called `K7`.
Those songs are kept out of the Songs list.

## Publishing a song from a k7 project

A k7 project can publish itself as a release with the command **`project share k7`** ("Publish
this song to k7"). It renders the project's mixdown (as MP3 when the engine's machine has ffmpeg,
WAV otherwise) and its stems (FLAC, or WAV), and uploads them:

- The first time, k7 asks for the artist and title, creates the release, and writes a `uuid` into
  the project's `project.k7x` so it is recognised next time.
- Every later time, it adds a new version, named after the date and time, to the same release.

It needs the instance's address and a token. Generate the token in **Settings › Rehearsal ›
CLI access token**, then put both in `.settings.json` at the root of the workspace:

```json
{
  "k7": {
    "url": "https://k7.example.com",
    "token": "<your token>"
  }
}
```

The `K7_URL` and `K7_TOKEN` environment variables, or the same `k7` block in
`~/.studio/config.json`, are read when the workspace file does not give a value.

## Creating a page

**New page** asks for:

- **Nametag**: letters and numbers, no spaces, for example `summerdemos`. It is the public address:
  `/rehearsal/@summerdemos`. A nametag already taken is refused.
- **Who can open it**:

| Visibility | Who |
|---|---|
| Private | Only you |
| Signed in | Anyone signed in to the instance, with its link |
| Public | Anyone with the link, without signing in |

- **Releases on this page**: tick the ones to list.

## A page's page

`/rehearsal/pages/<id>`:

- **Copy link** copies the public address.
- **Edit** changes the nametag. Renaming it breaks the old link.
- The visibility picker changes who can open it.
- **Add a release** (from **Choose a release…**) and, on each release, **Remove from page**.
- For each release, the version the page plays: **Default** (the release's default version) or a
  specific version.
- **Delete page** removes the page only; its releases stay.

## The public page

`/rehearsal/@<nametag>` lists the page's releases with their waveforms. A visitor can pick another
version where the release has several (hidden versions are not offered) and, when the release
allows it, download it.

A page set to **Signed in** asks a visitor who is not signed in to "Sign in to open @<nametag>".
An unknown nametag says "No page named @<nametag>."

## On a desktop or phone

Releases and pages are kept on the server only. On the k7 desktop or Android app, Publications
works through the server the device is paired with, as the person who paired it. When it cannot,
the page says why: the device is not paired, the server cannot be reached, or the device must be
paired again.
