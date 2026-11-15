import { MicIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { openMicrophone } from "../../speech/browserPcmCapture";
import { Button } from "../ui/button";

const TEST_SECONDS = 5;
const METER_BARS = 14;
// Below this peak the take is treated as silence, which points at the microphone, not at Tabs.
const SILENCE_PEAK = 0.02;

type Phase = "idle" | "recording" | "ready";

type Capture = {
  stream: MediaStream;
  recorder: MediaRecorder;
  context: AudioContext;
  meter: ReturnType<typeof setInterval>;
  stopTimer: ReturnType<typeof setTimeout>;
  peak: number;
};

/**
 * Records a few seconds and plays them back. Nothing leaves this device, so a silent take
 * means the microphone is muted or the wrong one is selected, not that transcription failed.
 */
export function MicrophoneTest({ microphoneId }: { microphoneId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const capture = useRef<Capture | null>(null);
  const url = useRef<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  const release = () => {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    clearInterval(current.meter);
    clearTimeout(current.stopTimer);
    if (current.recorder.state !== "inactive") current.recorder.stop();
    current.stream.getTracks().forEach((track) => track.stop());
    void current.context.close().catch(() => undefined);
  };
  const forgetTake = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    player.current = null;
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the microphone and the recording's object URL on unmount
  useEffect(
    () => () => {
      release();
      forgetTake();
    },
    [],
  );

  const start = async () => {
    release();
    forgetTake();
    setNote(null);
    setLevel(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNote("Microphone testing is not available here.");
      return;
    }
    try {
      const stream = await openMicrophone(microphoneId === "default" ? "" : microphoneId);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const current: Capture = {
        stream,
        recorder,
        context,
        peak: 0,
        meter: setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
          current.peak = Math.max(current.peak, peak);
          setLevel(Math.min(1, peak * 2.2));
        }, 70),
        stopTimer: setTimeout(() => release(), TEST_SECONDS * 1_000),
      };
      capture.current = current;
      recorder.addEventListener("dataavailable", ({ data }) => {
        if (data.size) chunks.push(data);
      });
      recorder.addEventListener("stop", () => {
        setLevel(0);
        if (current.peak < SILENCE_PEAK || chunks.length === 0) {
          setNote("That was silent. Is the microphone muted, or is another one selected?");
          setPhase("idle");
          return;
        }
        url.current = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
        player.current = new Audio(url.current);
        player.current.addEventListener("ended", () => setNote("Heard you loud and clear."));
        setNote("Heard you. Play it back to check how it sounds.");
        setPhase("ready");
      });
      recorder.start();
      setPhase("recording");
    } catch (error) {
      release();
      setPhase("idle");
      const name = typeof error === "object" && error !== null && "name" in error ? error.name : "";
      setNote(
        name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in your system settings."
          : "Could not open the microphone.",
      );
    }
  };

  const lit = Math.round(level * METER_BARS);
  return (
    <div className="flex flex-col items-end gap-2 sm:items-end">
      <div className="flex items-center gap-2">
        <div
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          className="flex h-5 items-end gap-[3px]"
        >
          {Array.from({ length: METER_BARS }, (_, bar) => (
            <span
              key={bar}
              aria-hidden="true"
              className={cn(
                "w-[3px] rounded-full bg-foreground transition-opacity duration-75",
                bar < lit ? "opacity-70" : "opacity-15",
              )}
              style={{ height: `${35 + (bar / METER_BARS) * 65}%` }}
            />
          ))}
        </div>
        {phase === "ready" ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void player.current?.play().catch(() => undefined)}
          >
            <PlayIcon className="size-3.5 mr-2" />
            Play back
          </Button>
        ) : null}
        {phase === "recording" ? (
          <Button variant="outline" size="sm" onClick={release}>
            <SquareIcon className="size-3.5 mr-2" />
            Stop
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void start()}>
            <MicIcon className="size-3.5 mr-2" />
            {phase === "ready" ? "Test again" : "Test microphone"}
          </Button>
        )}
      </div>
      {note ? (
        <span role="status" className="max-w-72 text-right text-[11px] text-muted-foreground/80">
          {note}
        </span>
      ) : null}
    </div>
  );
}
