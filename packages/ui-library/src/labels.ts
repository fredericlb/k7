// labels.ts — every sentence the media library draws, as one typed object the host fills from its own
// catalogue. A function where a sentence carries a value, so the host owns the word order too.
// See ../docs/host.md.

import type { MiniPlayerLabels } from "@studio/ui-mini-player";

export interface LibraryLabels {
  sections: {
    songs: string;
    samples: string;
    recordings: string;
    playlists: string;
    find: string;
  };
  common: {
    loading: string;
    cancel: string;
    back: string;
    moveUp: string;
    moveDown: string;
    remove: string;
    play: string;
    pause: string;
    /** "B", "kB", "MB" — how a size is printed on a row. */
    units: { b: string; kb: string; mb: string };
  };
  tree: {
    open: string;
    close: string;
    findSongs: string;
    dropOnSong: string;
    notAudio: (name: string) => string;
    addVariant: string;
    queue: string;
    delete: (name: string) => string;
    deleteFolder: (name: string) => string;
    deleteFolderConfirm: (name: string) => string;
    deleteSubmit: string;
    uploadFolder: string;
    newFolder: string;
    newFolderPlaceholder: string;
    newFile: string;
    newFilePlaceholder: string;
    create: string;
    rename: string;
    renamePlaceholder: string;
    renameSubmit: string;
    /** The ⋮ button on a row, which opens the same menu a right-click does. */
    more: string;
    /** The selector above the songs' tree: every song, or only the starred ones. */
    showAll: string;
    showFavorites: string;
    favorite: string;
    unfavorite: string;
    noFavorites: string;
  };
  contents: {
    emptyLibrary: string;
    emptyFamily: string;
    notCatalogued: string;
    noRecordings: string;
    /** Placement on a machine paired with a server, `host` being the server's. */
    synced: (host: string) => string;
    localOnly: string;
    download: string;
    /** The songs an album or a playlist names that only the server holds. */
    downloadMissing: (count: number) => string;
  };
  addRecording: { add: string; sending: string; cancel: string };
  addSong: {
    button: string;
    readingTags: string;
    hint: string;
    artist: string;
    artistPlaceholder: string;
    album: string;
    albumPlaceholder: string;
    title: string;
    titlePlaceholder: string;
    notAudio: (name: string) => string;
    occupied: string;
    cancelUpload: string;
    replace: string;
    send: string;
    /** The title when several were picked. */
    many: (count: number) => string;
    /** …and the button that sends them, one after another. */
    sendMany: (count: number) => string;
    /** Take one song off the list before sending. */
    drop: string;
    /** The share of a song's bytes sent so far, 0 to 100. */
    uploading: (percent: number) => string;
    /** Every byte sent, the server still filing it. */
    filing: string;
  };
  save: {
    clean: string;
    pending: string;
    saving: string;
    held: string;
    error: string;
  };
  song: {
    heading: (name: string) => string;
    saved: (path: string) => string;
    tagTitle: string;
    tagArtist: string;
    tagAlbum: string;
    tagBpm: string;
    tagTrack: string;
    trackInvalid: string;
    tagKey: string;
    noKey: string;
    bpmInvalid: string;
    /** Under the tag form: the tags are the master's, and changing them moves no folder. */
    tagsHint: string;
    tagsHeading: string;
    edit: string;
    done: string;
    /** The file's tags k7 does not use, listed read-only under the five. */
    otherTags: string;
    noOtherTags: string;
    variants: string;
    variantMissing: string;
    variantRemoved: (name: string) => string;
    alreadyAsked: string;
    analysedNoCache: string;
    analyseFailed: (message: string) => string;
    noMaster: string;
    fileNotInLibrary: string;
    notAnswering: (target: string) => string;
    fallback: string;
    fileMissing: string;
    noMasterShort: string;
    analysing: string;
    analyse: string;
    /** The song-info form's accessible name, `name` being the song's folder. */
    editor: (name: string) => string;
  };
  playlists: {
    unreadable: string;
    inline: string;
    none: string;
    newPlaylist: string;
    namePlaceholder: string;
    choose: string;
    showYaml: string;
    behind: string;
    search: string;
    queueAll: string;
    queueAllTitle: string;
    songCount: (n: number) => string;
    searchPlaceholder: string;
    noMatch: string;
    empty: string;
  };
  find: {
    failed: string;
    searching: string;
    youtubeDownloading: string;
    atPeer: (peer: string) => string;
    waitingPeer: string;
    peerTry: (n: number) => string;
    filed: string;
    youtubeTitle: string;
    noYtdlp: string;
    youtubeButton: string;
    abandon: string;
    forget: string;
    placeholder: string;
    search: string;
    settings: string;
    empty: string;
  };
  playback: {
    targets: Record<
      "browser" | "library" | "engine",
      { label: string; hint: string }
    >;
    title: string;
    picker: (target: string) => string;
    noEngine: string;
    notInLibrary: string;
    engineSaid: (message: string) => string;
    masterFailed: string;
    done: string;
    bar: MiniPlayerLabels;
    queueRegion: string;
    queueWaiting: (n: number) => string;
    queueButton: (n: number) => string;
    upNext: string;
    queueEmpty: string;
  };
  engines: {
    title: string;
    hint: string;
    refresh: string;
    looking: string;
    none: (origin: string) => string;
    chosen: string;
    unreachable: string;
    sameNetwork: string;
    someone: string;
    heldBy: (who: string) => string;
    /** What this account is to the engine — packages/engine-registry/docs/ownership.md. */
    yours: string;
    sharedBy: (owner: string) => string;
    server: string;
    unowned: string;
    unownedHint: string;
    share: string;
    shareHint: string;
    shareEveryone: string;
    sharePlaceholder: string;
    shareSave: string;
    shareSaved: string;
    notAnEmail: (what: string) => string;
    close: string;
    giveUp: string;
    giveUpConfirm: string;
    /** The admins' card of every owned engine — packages/engine-registry/docs/ownership.md. */
    ownersTitle: string;
    ownersHint: string;
    ownersNone: string;
    ownedBy: (owner: string) => string;
    sharedWith: (n: number) => string;
    offline: string;
    since: (date: string) => string;
    reset: string;
    resetConfirm: string;
  };
  slskd: {
    hint: string;
    address: string;
    apiKey: string;
    sftpHost: string;
    port: string;
    user: string;
    downloadsDir: string;
    sshKey: string;
    passphrase: string;
    password: string;
    onFile: string;
    forget: string;
    save: string;
    test: string;
  };
}
