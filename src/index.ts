/**
 * Play a three-note chime when the main agent is fully done
 * (no retry / compact / follow-up left). Subagent sessions are skipped.
 *
 * /done-sound          toggle
 * /done-sound on|off   set
 * /done-sound test     play now
 *
 * Optional: PI_DONE_SOUND=/path/to/file.wav
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATE_PATH = join(homedir(), ".pi", "agent", "done-sound.json");
const CHIME_PATH = join(homedir(), ".pi", "agent", "done-sound-chime.wav");

const SAMPLE_RATE = 22050;
const NOTES_HZ = [523.25, 659.25, 783.99]; // C5 E5 G5 — @0.00, @0.15, @0.30
const NOTE_SECS = 0.32; // osc.stop(t + 0.32)
const ATTACK_SECS = 0.02; // linear attack
const STAGGER_SECS = 0.15; // i * 0.15
const TOTAL_SECS = 0.62; // C5 starts (t+0.02) through G5 ends (t+0.30+0.32)

type State = { enabled: boolean };

function loadState(): State {
	try {
		const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<State>;
		return { enabled: raw.enabled !== false };
	} catch {
		return { enabled: true };
	}
}

function saveState(state: State): void {
	writeFileSync(STATE_PATH, `${JSON.stringify(state)}\n`);
}

function writeWav(path: string, pcm: Int16Array): void {
	const dataBytes = pcm.length * 2;
	const buf = Buffer.alloc(44 + dataBytes);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + dataBytes, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(SAMPLE_RATE, 24);
	buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(dataBytes, 40);
	for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, buf);
}

function buildChime(): Int16Array {
	const totalN = Math.round(SAMPLE_RATE * TOTAL_SECS);
	const noteN = Math.round(SAMPLE_RATE * NOTE_SECS);
	const attackN = Math.round(SAMPLE_RATE * ATTACK_SECS);
	const mix = new Float32Array(totalN);
	for (let n = 0; n < NOTES_HZ.length; n++) {
		const start = Math.round(SAMPLE_RATE * n * STAGGER_SECS);
		const freq = NOTES_HZ[n];
		for (let i = 0; i < noteN; i++) {
			const idx = start + i;
			if (idx >= totalN) break;
			// 0.02s linear attack → 0.30s linear decay to 0 (0.32s total)
			const env = i < attackN ? i / attackN : 1 - (i - attackN) / (noteN - attackN);
			mix[idx] += Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * env;
		}
	}
	let peak = 0;
	for (let i = 0; i < totalN; i++) peak = Math.max(peak, Math.abs(mix[i]));
	const scale = peak > 0 ? 22000 / peak : 0;
	const pcm = new Int16Array(totalN);
	for (let i = 0; i < totalN; i++) pcm[i] = Math.round(mix[i] * scale);
	return pcm;
}

function ensureChime(): string {
	if (!existsSync(CHIME_PATH)) writeWav(CHIME_PATH, buildChime());
	return CHIME_PATH;
}

function run(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: "ignore", windowsHide: true });
		child.unref();
		const done = () => resolve();
		child.on("error", done);
		child.on("close", done);
	});
}

async function playFile(file: string): Promise<void> {
	if (process.platform === "darwin") {
		await run("afplay", [file]);
		return;
	}
	if (process.platform === "win32") {
		const ps = join(tmpdir(), "pi-done-sound.ps1");
		writeFileSync(
			ps,
			`$p = New-Object System.Media.SoundPlayer '${file.replace(/'/g, "''")}'; $p.PlaySync()\n`,
		);
		await run("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			ps,
		]);
		return;
	}
	// ponytail: linux not requested; paplay/aplay if present
	await run("paplay", [file]).catch(() => run("aplay", [file]));
}

let playing = false;

async function play(): Promise<void> {
	if (playing) return;
	playing = true;
	try {
		const custom = process.env.PI_DONE_SOUND;
		const file = custom && existsSync(custom) ? custom : ensureChime();
		await playFile(file);
	} finally {
		playing = false;
	}
}

export default function (pi: ExtensionAPI) {
	let state = loadState();

	pi.on("agent_settled", (_event, ctx) => {
		if (!state.enabled) return;
		// Subagents bind without UI (print mode). Skip them; only the parent TUI/RPC session chimes.
		if (!ctx.hasUI) return;
		if (!ctx.isIdle()) return;
		void play();
	});

	pi.registerCommand("done-sound", {
		description: "Toggle / test the done-sound chime (on|off|test)",
		handler: async (args, ctx) => {
			const cmd = (args ?? "").trim().toLowerCase();
			if (cmd === "test") {
				void play();
				ctx.ui.notify("Done-sound: played", "info");
				return;
			}
			if (cmd === "on") state = { enabled: true };
			else if (cmd === "off") state = { enabled: false };
			else if (cmd === "" || cmd === "toggle") state = { enabled: !state.enabled };
			else {
				ctx.ui.notify("Usage: /done-sound [on|off|test]", "warning");
				return;
			}
			saveState(state);
			ctx.ui.notify(`Done-sound: ${state.enabled ? "on" : "off"}`, "info");
		},
	});
}
