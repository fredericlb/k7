# Motion — drawing a shot that moves

The format is [../../song-video/docs/animation.md](../../song-video/docs/animation.md). This page
is about where the renderer applies it: `motion.ts` for the arithmetic, `plain.ts` for the program
and the compositor's three draw paths.

## One rule on every path: inside the lane's frame, cropped by its rect

A layer reaches the screen one of three ways ([passes.md](passes.md)): straight onto the canvas,
seeded into the scratch and run through the lane's passes, or mixed with a second picture by a
transition. A moved shot has to look the same on all three, or a dissolve would visibly re-frame
the shot as it started. Each path therefore applies the motion in the LANE's frame and lets the
rect crop it:

| path | where the motion goes in | what crops it |
|---|---|---|
| plain | the quad's own affine, drawn at the lane's rect | a scissor box on the rect |
| through passes | the seed of the scratch, which is the lane's frame | the final blit to the rect |
| through a blend | each side, drawn into a target of its own BEFORE its stretch and the blend | the final blit to the rect |

The motion goes in BEFORE the lane's passes, so an effect sees the shot as it moves, just as it
sees the transition before characterising it.

## Built in pixels, applied in clip space

`motionAffine` composes the move in the frame's px and only then maps it to clip space. A
rotation done in clip space would shear on any frame that is not square, which every video frame
is. The plain program applies it AFTER the rect mapping, as a `mat3` that is the identity for a
shot at rest. That keeps one program and one draw call for both.

## Opacity: straight onto the composite, premultiplied into a blend

A moved shot drawn onto the composite fades in STRAIGHT alpha, which is what the composite blends
in. A moved side drawn into its target for a blend is PREMULTIPLIED, because that is how the
blend's result is composited ([compositor.md](compositor.md)): straight there, a fading side would
dip through black exactly as an unpremultiplied crossfade does. `uAlpha` carries both the
opacity and which of the two the reader expects.

## A shot at rest costs nothing

`motionAt` answers null for a shot whose every property is at rest at that instant, and every
path then draws exactly as it would with no animation. The two side targets are allocated only
for a scene in which some shot animates.

## One limit worth stating

A moved side of a blend is drawn with the texture filling the lane's frame, as an unmoved side
is, and not cover-corrected as the plain path is. A source whose shape differs from its lane's is
therefore framed slightly differently during the fade than outside it, moved or not. Correcting
it means correcting the blend's sides as a whole, which is outside what motion changes.
