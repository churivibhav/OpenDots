import { useCallback, useEffect, useRef, useState } from 'react';
import { api, authHeaders } from './api';

// Minimal Web Speech API surface; lib.dom does not ship these types.
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
type RecognitionConstructor = new () => Recognition;
function recognitionConstructor(): RecognitionConstructor | undefined {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

const mobile =
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// How long the speaker must pause before their words are sent.
const pauseMs = 1500;

// Cascaded voice: browser speech recognition, a Dot turn per utterance, and
// server-side TTS playback.
export function useVoice(
  threadId: string,
  onSaved: () => void,
  anchorMessageId?: string,
) {
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'active' | 'ending'
  >('idle');
  const generation = useRef(0);
  const connecting = useRef(false);
  const ending = useRef(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [phase, setPhase] = useState<'listening' | 'speaking' | 'thinking'>(
    'listening',
  );
  const [caption, setCaption] = useState('');
  const [userCaption, setUserCaption] = useState('');
  const session = useRef<
    | {
        id?: string;
        recognition: Recognition;
        audio: HTMLAudioElement;
        transcript: string[];
        cancelled: boolean;
        muted: boolean;
        speakerMuted: boolean;
        // Recognition is paused while the Dot thinks or speaks, to avoid
        // transcribing its own voice.
        busy: boolean;
        listening: boolean;
        pending: string[];
        // Final phrases heard since the last turn; sent after a pause.
        heard: string[];
        silence?: ReturnType<typeof setTimeout>;
      }
    | undefined
  >(undefined);
  const anchor = useRef(anchorMessageId);
  anchor.current = anchorMessageId;
  const listen = useCallback(() => {
    const current = session.current;
    if (
      !current ||
      current.cancelled ||
      current.muted ||
      current.busy ||
      current.listening
    )
      return;
    try {
      current.recognition.start();
      current.listening = true;
    } catch {
      // Already started; onend will retry.
    }
  }, []);
  const stopListening = useCallback(() => {
    const current = session.current;
    if (!current?.listening) return;
    current.listening = false;
    current.recognition.abort();
  }, []);
  const closeMedia = useCallback(() => {
    const current = session.current;
    if (!current) return;
    current.cancelled = true;
    current.recognition.onend = null;
    clearTimeout(current.silence);
    current.recognition.abort();
    current.audio.pause();
    if (current.audio.src) URL.revokeObjectURL(current.audio.src);
    current.audio.removeAttribute('src');
  }, []);
  const end = useCallback(async () => {
    if (ending.current) return;
    generation.current++;
    connecting.current = false;
    const current = session.current;
    if (!current) {
      setStatus('idle');
      return;
    }
    closeMedia();
    ending.current = true;
    setStatus('ending');
    try {
      if (current.id)
        await api(`/voice/calls/${current.id}/end`, 'POST', {
          transcript: current.transcript.join('\n').slice(0, 20000),
          anchorMessageId: anchor.current,
        });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Call ended, but its receipt could not be saved.',
      );
    } finally {
      session.current = undefined;
      ending.current = false;
      setStatus('idle');
    }
  }, [closeMedia, onSaved]);
  useEffect(
    () => () => {
      generation.current++;
      const current = session.current;
      closeMedia();
      if (current?.id && !ending.current)
        void fetch(`/api/voice/calls/${current.id}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            transcript: current.transcript.join('\n').slice(0, 20000),
            anchorMessageId: anchor.current,
          }),
          keepalive: true,
        }).catch(() => {});
    },
    [closeMedia],
  );
  useEffect(() => {
    if (status !== 'active' && status !== 'connecting') return;
    const timer = setInterval(() => {
      const current = session.current;
      const id = current?.id;
      if (id)
        void api<{ endedAt: number | null }>(`/voice/calls/${id}`)
          .then((call) => {
            if (session.current === current && call.endedAt) void end();
          })
          .catch(() => {
            if (session.current !== current) return;
            setError('Call control connection was lost.');
            void end();
          });
    }, 2000);
    return () => clearInterval(timer);
  }, [status, end]);
  const speak = useCallback(async (text: string) => {
    const current = session.current;
    if (!current?.id || current.cancelled || current.speakerMuted) return;
    const response = await fetch(`/api/voice/calls/${current.id}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text: text.slice(0, 4000) }),
    });
    if (!response.ok) throw new Error('Speech playback failed.');
    const blob = await response.blob();
    if (current.cancelled || current.speakerMuted) return;
    if (current.audio.src) URL.revokeObjectURL(current.audio.src);
    current.audio.src = URL.createObjectURL(blob);
    setPhase('speaking');
    await new Promise<void>((resolve) => {
      current.audio.onended = () => resolve();
      current.audio.onpause = () => resolve();
      current.audio.onerror = () => resolve();
      current.audio.play().catch(() => {
        if (!current.cancelled)
          setError(
            'Audio playback was blocked. Check your browser audio permissions.',
          );
        resolve();
      });
    });
  }, []);
  const respond = useCallback(
    async (request: string) => {
      const current = session.current;
      if (!current?.id || current.cancelled) return;
      current.busy = true;
      stopListening();
      setPhase('thinking');
      setCaption('');
      current.transcript.push(`You: ${request}`);
      try {
        const result = await api<{ text: string }>(
          `/voice/calls/${current.id}/compute`,
          'POST',
          { toolCallId: crypto.randomUUID(), request },
        );
        if (current.cancelled) return;
        current.transcript.push(`Dot: ${result.text}`);
        setCaption(result.text);
        await speak(result.text);
      } catch (e) {
        if (!current.cancelled)
          setError(e instanceof Error ? e.message : 'The Dot could not reply.');
      } finally {
        current.busy = false;
        if (!current.cancelled) {
          setPhase('listening');
          const next = current.pending.splice(0).join(' ');
          if (next) void respond(next);
          else listen();
        }
      }
    },
    [listen, speak, stopListening],
  );
  const start = async () => {
    if (session.current || connecting.current || ending.current) return;
    const Recognizer = recognitionConstructor();
    if (!Recognizer) {
      setError(
        'Voice calls need browser speech recognition (Chrome, Edge, or Safari).',
      );
      return;
    }
    connecting.current = true;
    const attempt = ++generation.current;
    setStatus('connecting');
    setError('');
    setMuted(false);
    setSpeakerMuted(false);
    setStartedAt(undefined);
    setPhase('listening');
    setCaption('');
    setUserCaption('');
    const recognition = new Recognizer();
    // Mobile engines mark short fragments final and repeat growing transcripts
    // in continuous mode, so phones use single-phrase sessions that restart.
    recognition.continuous = !mobile;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    const current = {
      id: undefined as string | undefined,
      recognition,
      audio: new Audio(),
      transcript: [] as string[],
      cancelled: false,
      muted: false,
      speakerMuted: false,
      busy: false,
      listening: false,
      pending: [] as string[],
      heard: [] as string[],
      silence: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    session.current = current;
    // Send what was heard once the speaker pauses, not on every final fragment.
    const flush = () => {
      current.silence = undefined;
      const text = current.heard.splice(0).join(' ').trim();
      if (!text || current.cancelled) return;
      if (current.busy) current.pending.push(text);
      else void respond(text);
    };
    recognition.onresult = (event) => {
      if (current.cancelled) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          const last = current.heard.at(-1);
          // Some engines resend the growing phrase; keep only the longest.
          if (last && text.startsWith(last))
            current.heard[current.heard.length - 1] = text;
          else if (!last?.startsWith(text)) current.heard.push(text);
        } else interim += `${text} `;
      }
      setUserCaption([...current.heard, interim.trim()].join(' ').trim());
      clearTimeout(current.silence);
      current.silence = setTimeout(flush, pauseMs);
    };
    recognition.onerror = (event) => {
      if (current.cancelled) return;
      if (['not-allowed', 'service-not-allowed'].includes(event.error)) {
        setError('Microphone access was denied.');
        void end();
      } else if (event.error === 'network') {
        // Brave, Chromium, Vivaldi and Opera expose the API without a service.
        setError(
          "This browser can't reach a speech recognition service. Use Chrome, Edge, or Safari for voice calls.",
        );
        void end();
      } else if (!['no-speech', 'aborted'].includes(event.error))
        setError(`Speech recognition error: ${event.error}.`);
    };
    recognition.onend = () => {
      current.listening = false;
      // Browsers stop recognition after silence; keep the call hands-free.
      if (!current.cancelled) setTimeout(listen, mobile ? 0 : 250);
    };
    try {
      const response = await api<{ id: string }>('/voice/calls', 'POST', {
        threadId,
      });
      current.id = response.id;
      if (current.cancelled || attempt !== generation.current) {
        await api(`/voice/calls/${response.id}/end`, 'POST', {
          transcript: '',
        });
        return;
      }
      await api(`/voice/calls/${response.id}/active`, 'POST', {});
      setStatus('active');
      setStartedAt(Date.now());
      listen();
    } catch (e) {
      if (attempt !== generation.current) return;
      const id = current.id;
      if (id)
        void api(`/voice/calls/${id}/end`, 'POST', {
          transcript: '',
          anchorMessageId: anchor.current,
        }).catch(() => {});
      closeMedia();
      session.current = undefined;
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not connect the call.');
    } finally {
      if (attempt === generation.current) connecting.current = false;
    }
  };
  const toggleMute = () => {
    const next = !muted;
    const current = session.current;
    if (current) {
      current.muted = next;
      if (next) stopListening();
      else listen();
    }
    setMuted(next);
  };
  const toggleSpeaker = () => {
    const next = !speakerMuted;
    const current = session.current;
    if (current) {
      current.speakerMuted = next;
      if (next) current.audio.pause();
    }
    setSpeakerMuted(next);
  };
  // Stop the Dot mid-sentence so the user can speak.
  const interrupt = () => session.current?.audio.pause();
  return {
    status,
    error,
    start,
    end,
    muted,
    speakerMuted,
    startedAt,
    phase,
    caption,
    userCaption,
    toggleMute,
    toggleSpeaker,
    interrupt,
  };
}
