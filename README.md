# @haoyiyin/pi-done-sound

[Pi](https://pi.dev) extension. Plays a three-note chime (E5–G5–C6) when the **main** agent is fully done — after retries, compaction, and follow-ups. Nested subagent sessions do not chime.

macOS uses `afplay`. Windows uses `System.Media.SoundPlayer`. Linux tries `paplay` / `aplay`.

## Install

```bash
pi install npm:@haoyiyin/pi-done-sound
```

Try once without installing:

```bash
pi -e npm:@haoyiyin/pi-done-sound
```

## Usage

Reload the current session (`/reload`) after install.

- `/done-sound` — toggle
- `/done-sound on` / `/done-sound off`
- `/done-sound test` — play now

Custom wav:

```bash
export PI_DONE_SOUND=/path/to/file.wav
```

On/off is stored in `~/.pi/agent/done-sound.json`. The generated chime is cached at `~/.pi/agent/done-sound-chime.wav`.
