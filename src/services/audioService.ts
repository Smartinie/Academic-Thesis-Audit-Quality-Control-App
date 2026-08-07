import { generateSpeech } from './gemini';

class AudioService {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private cache: Map<string, AudioBuffer> = new Map();
  private isMuted: boolean = false;
  private lastPlayedTime: Map<string, number> = new Map();

  // Cooldown in milliseconds to prevent fatigue (e.g., 60 seconds)
  private COOLDOWN_MS = 60000;
  private onPlayStateChangeCallbacks: Set<(isPlaying: boolean, text: string) => void> = new Set();

  constructor() {
    // Initialize lazily to comply with browser autoplay policies
  }

  public subscribe(callback: (isPlaying: boolean, text: string) => void) {
    this.onPlayStateChangeCallbacks.add(callback);
    return () => this.onPlayStateChangeCallbacks.delete(callback);
  }

  private notifyStateChange(isPlaying: boolean, text: string = '') {
    this.onPlayStateChangeCallbacks.forEach(cb => cb(isPlaying, text));
  }

  private initAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : 1;
    }
    if (muted) {
      this.stopCurrent();
    }
  }

  public getMuted() {
    return this.isMuted;
  }

  public stopCurrent(fadeDuration = 0.1) {
    if (this.currentSource && this.gainNode && this.audioContext) {
      try {
        // Fade out to prevent clicking
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.audioContext.currentTime);
        this.gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + fadeDuration);
        this.currentSource.stop(this.audioContext.currentTime + fadeDuration);
      } catch (e) {
        // Fallback if already stopped
      }
      this.currentSource = null;
      this.notifyStateChange(false);
    }
  }

  private async decodeBase64Audio(base64: string): Promise<AudioBuffer> {
    this.initAudioContext();
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Gemini TTS returns raw 16-bit PCM audio at 24000 Hz
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      // Normalize Int16 to Float32 (-1.0 to 1.0)
      float32Array[i] = int16Array[i] / 32768.0;
    }

    // Create AudioBuffer (1 channel, 24000 Hz)
    const audioBuffer = this.audioContext!.createBuffer(1, float32Array.length, 24000);
    audioBuffer.copyToChannel(float32Array, 0);
    
    return audioBuffer;
  }

  public async playGreeting(text: string, voiceName: 'Puck' | 'Zephyr' | 'Kore' | 'Fenrir' | 'Charon', forcePlay = false) {
    if (this.isMuted) return;

    // Check cooldown to prevent fatigue
    const now = Date.now();
    const lastPlayed = this.lastPlayedTime.get(text) || 0;
    if (!forcePlay && now - lastPlayed < this.COOLDOWN_MS) {
      return; // Skip if played recently
    }

    this.initAudioContext();

    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        // Ignore
      }
    }

    // Reset gain if it was faded out
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
      this.gainNode.gain.setValueAtTime(1, this.audioContext.currentTime);
    }

    this.stopCurrent();

    try {
      let audioBuffer = this.cache.get(text);

      if (!audioBuffer) {
        // Fetch from Gemini TTS
        const base64Audio = await generateSpeech(text, voiceName);
        if (!base64Audio) return;

        audioBuffer = await this.decodeBase64Audio(base64Audio);
        this.cache.set(text, audioBuffer);
      }

      // Play the buffer
      this.currentSource = this.audioContext!.createBufferSource();
      this.currentSource.buffer = audioBuffer;
      this.currentSource.connect(this.gainNode!);
      
      this.currentSource.onended = () => {
        if (this.currentSource === null || this.currentSource.buffer === audioBuffer) {
          this.notifyStateChange(false);
        }
      };

      this.currentSource.start(0);
      this.notifyStateChange(true, text);
      
      this.lastPlayedTime.set(text, now);

    } catch (error) {
      console.error("Error playing greeting:", error);
    }
  }
}

export const audioService = new AudioService();
