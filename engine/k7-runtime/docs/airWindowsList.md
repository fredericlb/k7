# Regenerating `AirWindowsList.h`

The file lists the AirWindows effects Tracktion vendors: class, display name, and the
CATEGORY each one declares (its `pluginType`, from the closed enum in
`tracktion_AirWindows.h`: delay, dither, distortion, dynamics, emulation, eq, filter,
imaging, modulation, reverb, utility). Lower case, as everything downstream expects.

It is **generated**. The same pairs appear in that header as `AIRWINDOWSPLUGIN(...)`
invocations, and the categories in `tracktion_AirWindows{1,2,3}.cpp` — but neither is
re-includable: the header is `#pragma once` and its macro expands to a class
*declaration*, so the list exists only as a side effect of declaring the classes.

Regenerate after bumping the Tracktion tag by pairing:

```bash
grep -oP '^AIRWINDOWSPLUGIN\(\K\w+, "[^"]*"' tracktion_AirWindows.h
```

```bash
grep -oP '(\w+)::Type ::pluginType = AirWindowsPlugin::\K\w+' tracktion_AirWindows[123].cpp
```
