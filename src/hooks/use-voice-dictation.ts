/**
 * useVoiceDictation — thin wrapper around the browser's SpeechRecognition
 * API. Pushes interim + final transcripts into a callback so the composer
 * can stream the user's words straight into the textarea.
 *
 * Why Web Speech API and not ElevenLabs Scribe?
 *   - Zero cost, zero backend, zero key management.
 *   - On-device on iOS 14.5+ / modern Safari / Chrome / Edge.
 *   - Latency is ~instant — partials show up while the user is still talking.
 *
 * Graceful degradation: `supported = false` means we hide the mic button.
 * If the user denies the mic permission we surface a friendly error string.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type SR = typeof window extends { SpeechRecognition: infer T } ? T : unknown;

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
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
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

export function useVoiceDictation({
  lang = "en-US",
  onText,
}: {
  lang?: string;
  /** Called with the latest concatenated transcript (interim or final). */
  onText: (text: string, isFinal: boolean) => void;
}) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalSoFar = useRef("");

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    setError(null);
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Voice input is not supported on this browser.");
      return;
    }
    try {
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
        const combined = (finalSoFar.current + " " + interim).trim();
        onText(combined, false);
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone access was blocked.");
        } else if (e.error === "no-speech") {
          // benign — user didn't say anything yet, keep going
        } else {
          setError(`Voice error: ${e.error}`);
        }
      };
      r.onend = () => {
        setListening(false);
        if (finalSoFar.current.trim()) onText(finalSoFar.current.trim(), true);
        recognitionRef.current = null;
      };
      recognitionRef.current = r;
      r.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start voice input.");
      setListening(false);
    }
  }, [lang, onText]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* no-op */
      }
    };
  }, []);

  return { supported, listening, error, start, stop, toggle };
}
