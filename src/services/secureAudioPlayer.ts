import { getTrackFromDB } from './indexedDB';

export class SecureAudioPlayer {
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private gainNode: GainNode | null = null;

  private isPlaying: boolean = false;
  private startTime: number = 0;
  private pausedAt: number = 0;
  public onEnded: (() => void) | null = null;

  // Chunk size: 512KB
  private CHUNK_SIZE = 512 * 1024;
  private abortController: AbortController | null = null;

  constructor() {
    // We don't initialize AudioContext here to respect Safari's policies
    // AudioContext must be created/resumed after a user interaction
  }

  /**
   * Initializes the AudioContext. Must be called from a user interaction (e.g., click).
   */
  public initContext() {
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  /**
   * Downloads the file in chunks using Range requests to evade IDM.
   */
  public async downloadInChunks(url: string, onProgress?: (progress: number) => void): Promise<Uint8Array> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    let totalLength = 0;
    
    // Attempt to get file size first using HEAD request if possible, 
    // but some servers don't support it or return incorrect size.
    // We will handle dynamic size by looking at the Content-Range response header.
    
    let currentByte = 0;
    let chunks: Uint8Array[] = [];
    let isFinished = false;

    while (!isFinished) {
      const start = currentByte;
      const end = currentByte + this.CHUNK_SIZE - 1;
      
      const response = await fetch(url, {
        headers: {
          'Range': `bytes=${start}-${end}`
        },
        signal
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      chunks.push(uint8Array);
      
      currentByte += uint8Array.length;

      // Extract total size from Content-Range if available: e.g. "bytes 0-511999/3145728"
      const contentRange = response.headers.get('Content-Range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
          totalLength = parseInt(match[1], 10);
        }
      }

      if (onProgress && totalLength > 0) {
        onProgress(Math.min(100, Math.round((currentByte / totalLength) * 100)));
      }

      // If we received less than requested, or we reached total length, we're done
      if (uint8Array.length < this.CHUNK_SIZE || (totalLength > 0 && currentByte >= totalLength)) {
        isFinished = true;
      }
    }

    // Assemble fragments in RAM
    const finalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const fullBuffer = new Uint8Array(finalLength);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Efface les chunks intermédiaires de la RAM après assemblage
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    chunks = [];

    return fullBuffer;
  }

  /**
   * Loads the audio from a URL using the chunking strategy and decodes it.
   * If trackId is provided or parsable from URL, it checks IndexedDB first.
   */
  public async loadTrack(url: string, onProgress?: (progress: number) => void, trackId?: string): Promise<void> {
    this.stop(); // Stop current playback if any

    if (!this.audioContext) {
      this.initContext();
    }

    try {
      // Extract trackId if not provided
      let id = trackId;
      if (!id) {
        const match = url.match(/\/api\/stream\/tracks\/([^/]+)\/audio/);
        if (match) id = decodeURIComponent(match[1]);
      }

      let fileData: Uint8Array | ArrayBuffer | undefined;

      // Check IndexedDB first
      if (id) {
        fileData = await getTrackFromDB(id);
      }

      // If not in DB, download in chunks
      if (!fileData) {
        fileData = await this.downloadInChunks(url, onProgress);
      } else {
        if (onProgress) onProgress(100);
      }

      // Step 3: Decode the audio data natively
      let arrayBuffer: ArrayBuffer;
      if (fileData instanceof Uint8Array) {
        arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteLength + fileData.byteOffset) as ArrayBuffer;
      } else {
        arrayBuffer = fileData as ArrayBuffer;
      }
      this.audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);

      // === VIDER LA RAM : efface le fichier MP3 brut (ArrayBuffer) après décodage ===
      // Empêche l'extraction du MP3 par dump mémoire
      if (fileData instanceof Uint8Array) {
        fileData.fill(0);
      }
      fileData = undefined;

      // Zéro-fill du ArrayBuffer passé à decodeAudioData
      const clearView = new Uint8Array(arrayBuffer);
      clearView.fill(0);
      arrayBuffer = null!;
      
    } catch (error) {
      console.error("SecureAudioPlayer: Error loading track", error);
      throw error;
    }
  }

  /**
   * Plays the decoded audio.
   */
  public play() {
    if (!this.audioContext || !this.audioBuffer) {
      console.warn("SecureAudioPlayer: Audio context or buffer not ready.");
      return;
    }

    if (this.isPlaying) return;

    // Must resume context on user action if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;

    this.gainNode = this.audioContext.createGain();

    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);

    this.sourceNode.onended = () => {
      this.isPlaying = false;
      if (this.onEnded) this.onEnded();
    };

    // Start playback from paused position
    this.sourceNode.start(0, this.pausedAt);
    this.startTime = this.audioContext.currentTime - this.pausedAt;
    this.isPlaying = true;
  }

  /**
   * Pauses the audio.
   */
  public pause() {
    if (!this.isPlaying || !this.sourceNode || !this.audioContext) return;

    this.sourceNode.stop();
    this.pausedAt = this.audioContext.currentTime - this.startTime;
    this.isPlaying = false;
  }

  /**
   * Stops the audio completely and resets position.
   */
  public stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        // Ignore if already stopped
      }
      this.sourceNode = null;
    }
    
    // Libère le buffer audio décodé de la RAM
    if (this.audioBuffer) {
      this.audioBuffer = null;
    }

    this.isPlaying = false;
    this.pausedAt = 0;
    this.startTime = 0;
  }

  /**
   * Seeks to a specific time in seconds.
   */
  public seekTo(seconds: number) {
    if (!this.audioBuffer || !this.audioContext) return;
    
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }

    this.pausedAt = Math.max(0, Math.min(seconds, this.audioBuffer.duration));

    if (wasPlaying) {
      this.play();
    }
  }

  public getCurrentTime(): number {
    if (!this.audioContext) return 0;
    if (this.isPlaying) {
      return this.audioContext.currentTime - this.startTime;
    }
    return this.pausedAt;
  }

  public getDuration(): number {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }
}

// Singleton instance if needed
export const secureAudioPlayer = new SecureAudioPlayer();
