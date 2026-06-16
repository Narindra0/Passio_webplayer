import { getTrackFromDB } from './indexedDB';
import { fetchWithRetry, getRetryDelay } from './networkUtils';
import { getAudioToken } from './api';

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

  // En-têtes pour les requêtes de streaming
  private readonly STREAM_HEADER = 'X-Passio-Stream';
  private readonly STREAM_HEADER_VALUE = 'secure';
  private readonly DEVICE_HEADER = 'x-passio-device-id';
  /** ID appareil pour l'authentification des requêtes de streaming */
  public deviceId: string | null = null;
  public currentToken: string | null = null;
  public currentTrackId: string | null = null;

  /**
   * Generates the deterministic XOR seed based on trackId
   */
  private async getXorSeed(trackId: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const data = encoder.encode('passio-xor-seed-' + trackId);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
  }

  /**
   * Applies XOR obfuscation/deobfuscation to the buffer
   */
  private applyXor(buffer: Uint8Array, seed: Uint8Array, offset: number = 0) {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] ^= seed[(offset + i) % seed.length];
    }
  }

  constructor() {
    // We don't initialize AudioContext here to respect Safari's policies
    // AudioContext must be created/resumed after a user interaction
  }

  /**
   * Configure l'ID appareil pour l'authentification.
   */
  setDeviceId(id: string | null) {
    this.deviceId = id;
  }

  /**
   * Retourne les en-têtes d'authentification pour les requêtes de streaming.
   */
  public getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [this.STREAM_HEADER]: this.STREAM_HEADER_VALUE,
    };
    if (this.deviceId) {
      headers[this.DEVICE_HEADER] = this.deviceId;
    }
    if (this.currentToken) {
      headers['X-Audio-Token'] = this.currentToken;
    }
    return headers;
  }

  /**
   * Fetch the ephemeral token for the track
   */
  public async fetchToken(trackId: string): Promise<void> {
    try {
      const tokenData = await getAudioToken(trackId);
      this.currentToken = tokenData.token;
    } catch (e) {
      console.warn('SecureAudioPlayer: Failed to get audio token', e);
    }
  }

  /**
   * Initialise l'AudioContext si pas déjà fait (compatible Safari).
   */
  public ensureContext() {
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
   * Si maxBytes est défini (ex: 1 Mo), on s'arrête après cette limite.
   * Utile pour le prefetch « 2 chunks » qui économise la bande passante.
   *
   * Utilise fetchWithRetry pour gérer les erreurs QUIC/HTTP3 avec
   * keepalive: true et exponential backoff.
   */
  public async downloadInChunks(url: string, onProgress?: (progress: number) => void, maxBytes?: number): Promise<Uint8Array> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const MAX_RETRIES = 3;
    let totalLength = 0;
    
    let currentByte = 0;
    let chunks: Uint8Array[] = [];
    let isFinished = false;
    let usedFullDownload = false;

    while (!isFinished) {
      // Si maxBytes défini et atteint, on s'arrête immédiatement
      if (maxBytes && currentByte >= maxBytes) {
        isFinished = true;
        break;
      }
      // Ne pas dépasser maxBytes
      const chunkEnd = maxBytes ? Math.min(currentByte + this.CHUNK_SIZE, maxBytes) : currentByte + this.CHUNK_SIZE;
      const start = currentByte;
      const end = chunkEnd - 1;
      
      let response: Response | null = null;
      let retries = 0;

      while (retries <= MAX_RETRIES && !response) {
        try {
          const resp = await fetchWithRetry(url, {
            headers: {
              'Range': `bytes=${start}-${end}`,
              ...this.getAuthHeaders(),
            },
            signal,
            retries: 0, // fetchWithRetry = keepalive uniquement, la boucle while gère les retries
          });

          if (resp.ok || resp.status === 206) {
            response = resp;
          } else if (resp.status === 416) {
            // Range not satisfiable — we have the whole file
            isFinished = true;
            break;
          } else {
            throw new Error(`HTTP ${resp.status}`);
          }
        } catch (err: any) {
          // Si l'abortController.stop() a été appelé, on abandonne immédiatement
          if (err.name === 'AbortError') throw err;

          retries++;
          if (retries > MAX_RETRIES) {
            // Si le serveur ne supporte pas les Range, fallback vers un téléchargement complet
            if (!usedFullDownload) {
              console.warn('SecureAudioPlayer: Range requests not supported, falling back to full download');
              usedFullDownload = true;
              const fullResp = await fetch(url, {
                signal,
                headers: this.getAuthHeaders(),
                keepalive: true,
              });
              if (!fullResp.ok) throw new Error(`HTTP ${fullResp.status}`);
              const fullBuffer = await fullResp.arrayBuffer();
              const uint8 = new Uint8Array(fullBuffer);
              if (this.currentTrackId) {
                const seed = await this.getXorSeed(this.currentTrackId);
                this.applyXor(uint8, seed, 0);
              }
              if (onProgress) onProgress(100);
              return uint8;
            }
            throw err;
          }
          // Attendre un peu avant de réessayer (exponential backoff)
          const delay = getRetryDelay(retries - 1);
          await new Promise(r => setTimeout(r, delay));
        }
      }

      if (!response) break;

      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      chunks.push(uint8Array);
      
      currentByte += uint8Array.length;

      // Extract total size from Content-Range
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

    // --- XOR DEOBFUSCATION ---
    if (this.currentTrackId) {
      const seed = await this.getXorSeed(this.currentTrackId);
      this.applyXor(fullBuffer, seed, 0);
    }

    // Efface les chunks intermédiaires de la RAM après assemblage
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    chunks = [];

    return fullBuffer;
  }

  /**
   * Loads and plays audio from a pre-downloaded buffer (prefetch),
   * sans passer par le réseau.
   */
  public async loadFromBuffer(uint8Array: Uint8Array): Promise<void> {
    this.stop();
    this.ensureContext();
    if (!this.audioContext) throw new Error('SecureAudioPlayer: AudioContext not available');

    const arrayBuffer = uint8Array.buffer.slice(
      uint8Array.byteOffset,
      uint8Array.byteLength + uint8Array.byteOffset
    ) as ArrayBuffer;

    // ⚡ Cloner l'ArrayBuffer AVANT decodeAudioData, car selon l'implémentation
    //    du navigateur, decodeAudioData peut DÉTACHER (transférer) le buffer
    //    → new Uint8Array(arrayBuffer) après decodeAudioData crashe avec
    //      "Cannot perform Construct on a detached ArrayBuffer"
    const safeClone = arrayBuffer.slice(0);
    this.audioBuffer = await this.audioContext.decodeAudioData(safeClone);

    // Nettoyer le buffer brut de la RAM (le clone est détaché, le original est intact)
    uint8Array.fill(0);
    const clearView = new Uint8Array(arrayBuffer);
    clearView.fill(0);
  }

  /**
   * Loads the audio from a URL using the chunking strategy and decodes it.
   * If trackId is provided or parsable from URL, it checks IndexedDB first.
   */
  public async loadTrack(url: string, onProgress?: (progress: number) => void, trackId?: string): Promise<void> {
    this.stop(); // Stop current playback if any

    this.ensureContext();

    try {
      // Extract trackId if not provided
      let id = trackId;
      if (!id) {
        const match = url.match(/\/api\/stream\/tracks\/([^/]+)\/audio/);
        if (match) id = decodeURIComponent(match[1]);
      }
      this.currentTrackId = id || null;

      let fileData: Uint8Array | ArrayBuffer | undefined;

      // Check IndexedDB first
      if (id) {
        fileData = await getTrackFromDB(id);
      }

      // If not in DB, download in chunks
      if (!fileData) {
        if (id) {
          await this.fetchToken(id);
        }
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
      if (!this.audioContext) {
        throw new Error('SecureAudioPlayer: AudioContext not available');
      }
      // ⚡ Cloner l'ArrayBuffer AVANT decodeAudioData, car selon l'implémentation
      //    du navigateur, decodeAudioData peut DÉTACHER (transférer) le buffer
      //    → new Uint8Array(arrayBuffer) après decodeAudioData crashe avec
      //      "Cannot perform Construct on a detached ArrayBuffer"
      const safeClone = arrayBuffer.slice(0);
      this.audioBuffer = await this.audioContext.decodeAudioData(safeClone);

      // === VIDER LA RAM : efface le fichier MP3 brut (ArrayBuffer) après décodage ===
      // Empêche l'extraction du MP3 par dump mémoire
      if (fileData instanceof Uint8Array) {
        fileData.fill(0);
      }
      fileData = undefined;

      // Zéro-fill du ArrayBuffer original (le clone est détaché par decodeAudioData)
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
   * Retourne true si la lecture a démarré, false sinon.
   */
  public async play(): Promise<boolean> {
    if (!this.audioContext || !this.audioBuffer) {
      console.warn("SecureAudioPlayer: Audio context or buffer not ready.");
      return false;
    }

    if (this.isPlaying) return true;

    // Must resume context on user action if suspended — ATTENDRE le resume !
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.error('SecureAudioPlayer: Failed to resume AudioContext', e);
        return false;
      }
    }

    if (this.audioContext.state !== 'running') {
      console.warn('SecureAudioPlayer: AudioContext not running, state:', this.audioContext.state);
      return false;
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
    try {
      this.sourceNode.start(0, this.pausedAt);
    } catch (e) {
      console.error('SecureAudioPlayer: Failed to start source node', e);
      return false;
    }
    this.startTime = this.audioContext.currentTime - this.pausedAt;
    this.isPlaying = true;
    return true;
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
      void this.play();
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
