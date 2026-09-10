import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { makeClip, type Project, type Token, uid } from "../timeline";
import { importMedia, probeMedia, runFFmpeg } from "./media";
import { atomicJson, DATA, deleteProject, loadProject, mutateProject, newProject } from "./store";

const scenes = [
  { image: "mountain.jpg", name: "Mountain escape.mp4", seconds: 14, text: "Sometimes, the best way to move forward is to take a step back. Away from the noise." },
  { image: "forest.jpg", name: "Forest rhythm.mp4", seconds: 10, text: "Away from the everyday. Out here, you find a different rhythm." },
  { image: "valley.jpg", name: "A little perspective.mp4", seconds: 14, text: "A little more space. A little more perspective. This is where we come back to ourselves." },
] as const;
const script = scenes.map(scene => scene.text).join(" ");
const totalSeconds = scenes.reduce((total, scene) => total + scene.seconds, 0);

function fixtureTokens(text: string, start: number, end: number, narration: string): Token[] {
  const words = text.match(/\S+\s*/g) ?? [];
  // Character weights and punctuation pauses approximate speech, not forced alignment.
  const weights = words.map(word => Math.max(2, word.trim().length) + (/[.,!?]\s*$/.test(word) ? 4 : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let position = 0;
  return words.map((word, index) => {
    const from = start + (end - start) * position / total;
    position += weights[index];
    return {
      id: uid(), text: word, original: word, start: Math.round(from), end: Math.round(start + (end - start) * position / total),
      speaker: narration === "local-flite-slt" ? "Fixture narrator (local synthetic voice)" : "Fixture words (synthetic; not live transcription)",
      language: "en", raw: { fixture: true, synthetic: true, timing: "approximate", narration },
    };
  });
}

// Share only in-flight creation across requests and development module reloads.
// Completed calls reload storage so edits and deletion are never hidden by a cache.
const globalFixture = globalThis as typeof globalThis & { __videoSampleBoot?: Map<string, Promise<Project>> };
const boots = globalFixture.__videoSampleBoot ??= new Map<string, Promise<Project>>();

export async function ensureSampleProject(): Promise<Project> {
  const pending = boots.get(DATA);
  if (pending) return structuredClone(await pending);
  const boot = (async () => {
    const pointer = path.join(DATA, "sample-project.json");
    let saved: { id: string } | undefined;
    try {
      saved = JSON.parse(await readFile(pointer, "utf8")) as { id: string };
      if (!saved || typeof saved.id !== "string") throw new Error("Invalid sample project pointer");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // A dangling pointer records intentional deletion. Only removing the pointer
    // explicitly requests a new sample; ordinary startup must not resurrect it.
    if (saved) return loadProject(saved.id);

    await mkdir(DATA, { recursive: true });
    const temp = await mkdtemp(path.join(DATA, ".sample-"));
    let project: Project | undefined;
    try {
      project = await newProject("Into the quiet");
      const clips: Project["clips"] = [];
      const transcripts = new Map<string, Token[]>();
      let start = 0;
      for (const [index, scene] of scenes.entries()) {
        const speech = path.join(temp, `speech-${index}.wav`);
        const video = path.join(temp, scene.name);
        let narration = "local-flite-slt";
        let audioFilter: string;
        const lead = 350, speechLength = scene.seconds * 1000 - lead * 2;
        try {
          await runFFmpeg(["-f", "lavfi", "-i", `flite=voice=slt:text='${scene.text}'`, "-t", "60", "-c:a", "pcm_s16le", speech]);
          const metadata = await probeMedia(speech);
          let tempo = metadata.duration / speechLength;
          const filters: string[] = [];
          while (tempo < 0.5) { filters.push("atempo=0.5"); tempo /= 0.5; }
          while (tempo > 2) { filters.push("atempo=2"); tempo /= 2; }
          filters.push(`atempo=${tempo}`, "aresample=48000", `adelay=${lead}:all=1`);
          audioFilter = filters.join(",");
        } catch {
          // Some FFmpeg builds omit libflite. Keep the real audio stream silent,
          // and explicitly identify the supplied words as a silent fixture.
          narration = "silence-fallback";
          await runFFmpeg(["-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-t", String(scene.seconds), "-c:a", "pcm_s16le", speech]);
          audioFilter = "anull";
          console.warn("Sample fixture: local flite narration unavailable; using silence and synthetic fixture words, not live transcription.");
        }
        await runFFmpeg([
          "-protocol_whitelist", "file,pipe", "-f", "image2", "-pattern_type", "none", "-framerate", "30", "-i", path.join(process.cwd(), "public", "sample", scene.image),
          "-i", speech, "-map", "0:v:0", "-map", "1:a:0",
          "-vf", `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='1+0.045*on/${scene.seconds * 30 - 1}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${scene.seconds * 30}:s=1280x720:fps=30,setsar=1`,
          "-af", `${audioFilter},apad=whole_dur=${scene.seconds},atrim=duration=${scene.seconds}`,
          "-t", String(scene.seconds), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-threads", "2",
          "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", video,
        ]);
        const name = narration === "silence-fallback" ? scene.name.replace(".mp4", " (silent fixture).mp4") : scene.name;
        const asset = await importMedia(project.id, new File([await readFile(video)], name, { type: "video/mp4" }));
        transcripts.set(asset.id, fixtureTokens(`${scene.text}${index < scenes.length - 1 ? " " : ""}`, lead, scene.seconds * 1000 - lead, narration));
        clips.push({ ...makeClip(asset, "video", start), sourceOut: scene.seconds * 1000 });
        start += scene.seconds * 1000;
      }

      const ambient = path.join(temp, "Quiet atmosphere.wav");
      await runFFmpeg([
        "-f", "lavfi", "-i", `aevalsrc=0.018*(sin(2*PI*130.81*t)+sin(2*PI*164.81*t)+sin(2*PI*196*t))*(0.8+0.2*sin(2*PI*0.08*t)):s=48000:d=${totalSeconds}`,
        "-af", `afade=t=in:d=2,afade=t=out:st=${totalSeconds - 3}:d=3`, "-ac", "2", "-c:a", "pcm_s16le", ambient,
      ]);
      const music = await importMedia(project.id, new File([await readFile(ambient)], "Quiet atmosphere.wav", { type: "audio/wav" }));
      clips.push({ ...makeClip(music, "audio"), sourceOut: totalSeconds * 1000, volume: 0.6 });
      const title = makeClip(undefined, "titles");
      clips.push({ ...title, name: "Opening title", text: "A little further.\nA little freer.", sourceOut: 5000, fontSize: 70, effects: { ...title.effects, x: 0, y: 0.15 } });
      const complete = await mutateProject(project.id, p => {
        p.fixture = true;
        p.clips = clips;
        for (const asset of p.assets) {
          asset.fixture = true;
          const tokens = transcripts.get(asset.id);
          if (tokens) { asset.tokens = tokens; asset.transcription = "completed"; }
        }
        return p;
      });
      await atomicJson(pointer, { id: complete.id });
      return complete;
    } catch (error) {
      if (project) await deleteProject(project.id);
      throw error;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  })();
  boots.set(DATA, boot);
  try { return structuredClone(await boot); }
  finally { if (boots.get(DATA) === boot) boots.delete(DATA); }
}

/** Explicit local demo action, never a substitute for a failed live transcription. */
export async function addFixtureTranscript(projectId: string, assetId: string): Promise<Project> {
  if (process.env.FIXTURE_MODE === "false") throw new Error("Fixture mode is disabled");
  return mutateProject(projectId, p => {
    const asset = p.assets.find(asset => asset.id === assetId);
    if (!asset) throw new Error("Unknown asset");
    if (!["video", "audio"].includes(asset.kind) || !asset.hasAudio) throw new Error("Fixture transcripts require audio or video with an audio stream");
    if (["queued", "uploading", "processing"].includes(asset.transcription)) throw new Error("Cancel the active transcription before adding fixture words");
    // Keep original provider tokens and user corrections intact, including on retries.
    if (asset.tokens.length) return p;
    asset.fixture = true;
    asset.tokens = fixtureTokens(script, 0, asset.duration, "synthetic-script-only; not transcribed from this media");
    asset.transcription = "completed";
    delete asset.transcriptionError;
    return p;
  });
}
