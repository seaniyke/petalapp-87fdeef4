/**
 * useVoiceDictation — voice → text for the composer.
 *
 * Two paths under one API:
 *   1. Web Speech API (Chrome / Edge / Safari 14.5+ desktop) — instant,
 *      streaming partials, $0.
 *   2. MediaRecorder → /api/transcribe → Whisper (Safari iOS, Firefox,
 *      in-app webviews) — single-shot, ~1-3s latency, costs AI credits.
 *
 * `supported` is true if EITHER path works. The hook picks Web Speech when
 * available and falls back automatically.
 */
import { useCallback, useEffect, useRef, useState } from "react";

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function hasMediaRecorder(): boolean {
  if (typeof window === "undefined") return false;
  return typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export function useVoiceDictation({
  lang = "en-US",
  onText,
  /** Optional: bearer token (Supabase access_token) for the Whisper fallback. */
  getAuthToken,
}: {
  lang?: string;
  onText: (text: string, isFinal: boolean) => void;
  getAuthToken?: () => Promise<string | null> | string | null;
}) {
  const webSpeechCtor = useRef(getRecognitionCtor());
  const [mode] = useState<"webspeech" | "whisper" | "none">(() => {
    if (getRecognitionCtor()) return "webspeech";
    if (hasMediaRecorder()) return "whisper";
    return "none";
  });
  const supported = mode !== "none";

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Web Speech path ---
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalSoFar = useRef("");

  // --- MediaRecorder path ---
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    if (mode === "webspeech") recognitionRef.current?.stop();
    else if (mode === "whisper") {
      try { recorderRef.current?.stop(); } catch { /* no-op */ }
    }
  }, [mode]);

  const startWebSpeech = useCallback(() => {
    const Ctor = webSpeechCtor.current;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    finalSoFar.current = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0].transcript;
        if (res.isFinal) finalSoFar.current += txt;
        else interim += txt;
      }
      onText((finalSoFar.current + " " + interim).trim(), false);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access was blocked.");
      else if (e.error === "no-speech") { /* benign */ }
      else setError(`Voice error: ${e.error}`);
    };
    r.onend = () => {
      setListening(false);
      if (finalSoFar.current.trim()) onText(finalSoFar.current.trim(), true);
      recognitionRef.current = null;
    };
    recognitionRef.current = r;
    r.start();
    setListening(true);
  }, [lang, onText]);

  const startWhisper = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        setListening(false);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const ext = (recorder.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm";
        const fd = new FormData();
        fd.append("audio", new File([blob], `voice.${ext}`, { type: blob.type }));
        fd.append("lang", lang);
        try {
          const token = getAuthToken ? await getAuthToken() : null;
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: token ? { authorization: `Bearer ${token}` } : {},
            body: fd,
          });
          if (!res.ok) {
            if (res.status === 401) setError("Sign in to use voice on this browser.");
            else if (res.status === 402) setError("AI credits exhausted.");
            else setError("Transcription failed.");
            return;
          }
          const { text } = (await res.json()) as { text: string };
          if (text) onText(text, true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Transcription failed.");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setListening(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not access microphone.";
      setError(/permission|denied|allowed/i.test(msg) ? "Microphone access was blocked." : msg);
      setListening(false);
    }
  }, [lang, onText, getAuthToken]);

  const start = useCallback(() => {
    setError(null);
    if (mode === "webspeech") startWebSpeech();
    else if (mode === "whisper") void startWhisper();
    else setError("Voice input is not supported on this browser.");
  }, [mode, startWebSpeech, startWhisper]);

  const toggle = useCallback(() => {
    if (listening) stop(); else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch { /* no-op */ }
      try { recorderRef.current?.stop(); } catch { /* no-op */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { supported, listening, error, start, stop, toggle, mode };
}
