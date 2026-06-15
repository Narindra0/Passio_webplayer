/**
 * mseSecurePlayer.ts — Lecteur audio MSE (Media Source Extensions) sécurisé.
 *
 * Principe :
 * 1. Hybrid bandwidth : télécharge d'abord 3 chunks (~1.5 Mo) pour lancer la lecture
 * 2. Puis ne télécharge plus que lorsque le buffer approche les ~20s restantes
 * 3. Si l'utilisateur skip → les chunks restants ne sont JAMAIS téléchargés (-90% sur les skips)
 * 4. Nettoie les données déjà jouées du buffer mémoire
 *
 * Sécurité :
 * - Header X-Passio-Stream: secure sur chaque requête
 * - src du <audio> = blob URL (MediaSource), pas d'URL réseau exposée
 */

const STREAM_HEADER = 'X-Passio-Stream';
const STREAM_HEADER_VALUE = 'secure';
const CHUNK_SIZE = 512 * 1024; // 512 KB
const INITIAL_BATCH = 3;        // 3 chunks au départ (~1.5 Mo)
const REFILL_BATCH = 2;         // 2 chunks quand le buffer est bas
const BUFFER_AHEAD_TARGET = 30; // secondes devant à maintenir
const BUFFER_AHEAD_MIN = 15;    // seconde minimum avant de recharger
const BUFFER_CLEAN_BEHIND = 10; // secondes derrière à garder dans le buffer

// Petite fonction utilitaire sleep
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class MSESecurePlayer {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private audio: HTMLAudioElement | null = null;
  private abortController: AbortController | null = null;
  private streaming = false;
  private mimeType: string | null = null;
  private totalSize = 0;
  private nextOffset = 0;
  private downloadInProgress = false;

  public onEnded: (() => void) | null = null;

  getAudioElement(): HTMLAudioElement | null {
    return this.audio;
  }

  static isSupported(): boolean {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');
  }

  /**
   * Lance le streaming adaptatif MSE.
   * Retourne l'élément <audio> dès que le premier batch est chargé.
   */
  async loadAndPlay(url: string): Promise<HTMLAudioElement> {
    this.stop();
    this.mimeType = null;
    this.streaming = false;
    this.nextOffset = 0;
    this.totalSize = 0;

    const controller = new AbortController();
    this.abortController = controller;

    // ── 1. Probe : Content-Type + taille totale ──
    const probeResponse = await fetch(url, {
      headers: {
        'Range': 'bytes=0-1',
        [STREAM_HEADER]: STREAM_HEADER_VALUE,
      },
      signal: controller.signal,
    });
    if (!probeResponse.ok && probeResponse.status !== 206) {
      throw new Error(`MSESecurePlayer: probe failed with HTTP ${probeResponse.status}`);
    }

    const rawType = probeResponse.headers.get('Content-Type') || 'audio/mpeg';
    this.mimeType = rawType.split(';')[0].trim();
    if (!MediaSource.isTypeSupported(this.mimeType)) {
      throw new Error(`MSESecurePlayer: MSE not supported for ${this.mimeType}`);
    }

    const contentRange = probeResponse.headers.get('Content-Range');
    if (contentRange) {
      const match = contentRange.match(/\/\d+$/);
      if (match) this.totalSize = parseInt(match[0].slice(1), 10);
    }
    if (!this.totalSize) {
      try {
        const headResp = await fetch(url, {
          method: 'HEAD',
          headers: { [STREAM_HEADER]: STREAM_HEADER_VALUE },
          signal: controller.signal,
        });
        this.totalSize = parseInt(headResp.headers.get('Content-Length') || '0', 10);
      } catch { /* keep 0 */ }
    }
    if (!this.totalSize) throw new Error('MSESecurePlayer: could not determine content length');

    // ── 2. Créer le MediaSource + <audio> ──
    this.mediaSource = new MediaSource();
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';
    this.audio.src = URL.createObjectURL(this.mediaSource);

    // ── 3. Attendre sourceopen ──
    await new Promise<void>((resolve, reject) => {
      if (!this.mediaSource) return reject(new Error('MediaSource destroyed'));
      const timeout = setTimeout(() => reject(new Error('MSESecurePlayer: sourceopen timeout')), 15000);
      this.mediaSource.onsourceopen = () => { clearTimeout(timeout); resolve(); };
    });
    if (!this.mediaSource || !this.audio) throw new Error('MediaSource destroyed');

    // ── 4. Créer le SourceBuffer ──
    this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType);

    // ── 5. Lancer le streaming adaptatif en arrière-plan ──
    this.streaming = true;
    this.startAdaptiveStreaming(url, controller).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[MSESecurePlayer] Streaming error:', err);
    });

    // ── 6. Brancher l'événement ended ──
    this.audio.addEventListener('ended', () => {
      if (this.onEnded) this.onEnded();
    }, { once: true });

    return this.audio;
  }

  /**
   * Boucle adaptative : télécharge juste assez pour rester ~30s devant.
   */
  private async startAdaptiveStreaming(url: string, controller: AbortController) {
    try {
      // ── Phase 1 : Batch initial (3 chunks) pour démarrer la lecture ──
      await this.downloadBatch(url, INITIAL_BATCH, controller);

      // ── Phase 2 : Monitoring adaptatif ──
      while (this.streaming && !controller.signal.aborted) {
        if (!this.audio || !this.sourceBuffer) break;

        const bufferedAhead = this.getBufferedAhead();
        const isPaused = this.audio.paused;

        if (bufferedAhead < BUFFER_AHEAD_MIN && !isPaused && this.nextOffset < this.totalSize) {
          // Buffer trop bas → télécharger un batch de rattrapage
          await this.downloadBatch(url, REFILL_BATCH, controller);
          // Nettoyer les données déjà jouées (après avoir attendu que l'append soit fini)
          await this.cleanupPlayedBuffer();
          // Petite pause pour laisser le SourceBuffer respirer
          await sleep(500);
        } else if (this.nextOffset >= this.totalSize) {
          // Tout est téléchargé → fin
          break;
        } else if (isPaused) {
          // En pause → on ne télécharge pas, on attend plus longtemps
          await sleep(3000);
        } else {
          // Buffer suffisant → on attend
          await sleep(1500);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[MSESecurePlayer] Adaptive streaming error:', err);
    }

    // Signaler la fin du flux (même en erreur pour libérer le player)
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try { this.mediaSource.endOfStream(); } catch { /* ignore */ }
    }
    this.streaming = false;
  }

  /**
   * Télécharge `count` chunks séquentiellement.
   */
  private async downloadBatch(url: string, count: number, controller: AbortController) {
    if (this.downloadInProgress) return;
    this.downloadInProgress = true;

    try {
      for (let i = 0; i < count && this.streaming && !controller.signal.aborted; i++) {
        if (this.nextOffset >= this.totalSize) break;

        const end = Math.min(this.nextOffset + CHUNK_SIZE - 1, this.totalSize - 1);

        const response = await fetch(url, {
          headers: {
            'Range': `bytes=${this.nextOffset}-${end}`,
            [STREAM_HEADER]: STREAM_HEADER_VALUE,
          },
          signal: controller.signal,
        });

        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status} during chunk download`);
        }

        const chunk = await response.arrayBuffer();
        if (!this.streaming || controller.signal.aborted) break;

        // Attendre que le SourceBuffer soit prêt (avec timeout)
        if (this.sourceBuffer!.updating) {
          await this.waitForSourceBufferUpdate(controller);
        }
        if (!this.streaming || controller.signal.aborted) break;

        this.sourceBuffer!.appendBuffer(chunk);
        this.nextOffset += chunk.byteLength;
      }
    } finally {
      this.downloadInProgress = false;
    }
  }

  /**
   * Attend que le SourceBuffer finisse sa mise à jour, avec un timeout.
   */
  private waitForSourceBufferUpdate(controller: AbortController): Promise<void> {
    return new Promise((resolve) => {
      const sb = this.sourceBuffer;
      if (!sb || !sb.updating) { resolve(); return; }
      const timeout = setTimeout(() => {
        sb.onupdateend = null;
        resolve();
      }, 5000);
      sb.onupdateend = () => {
        clearTimeout(timeout);
        sb.onupdateend = null;
        resolve();
      };
    });
  }

  /**
   * Retourne le nombre de secondes bufferisées devant la position courante.
   */
  private getBufferedAhead(): number {
    if (!this.sourceBuffer || !this.audio) return 0;
    try {
      const buffered = this.sourceBuffer.buffered;
      if (buffered.length === 0) return 0;
      return buffered.end(buffered.length - 1) - this.audio.currentTime;
    } catch {
      return 0;
    }
  }

  /**
   * Supprime du SourceBuffer les données déjà jouées (au-delà de BUFFER_CLEAN_BEHIND secondes).
   * Attend la fin de l'opération pour ne pas bloquer les appendBuffer suivants.
   */
  private cleanupPlayedBuffer(): Promise<void> {
    if (!this.sourceBuffer || !this.audio) return Promise.resolve();
    if (this.sourceBuffer.updating) return Promise.resolve();

    try {
      const buffered = this.sourceBuffer.buffered;
      if (buffered.length === 0) return Promise.resolve();
      const currentTime = this.audio.currentTime;
      const cleanEnd = Math.max(0, currentTime - BUFFER_CLEAN_BEHIND);
      if (cleanEnd > 0 && buffered.length > 0 && buffered.start(0) < cleanEnd) {
        this.sourceBuffer.remove(0, cleanEnd);
        // Attendre la fin du remove avant de continuer
        return this.waitForSourceBufferUpdate(new AbortController());
      }
    } catch { /* ignore */ }
    return Promise.resolve();
  }

  stop() {
    this.streaming = false;
    this.downloadInProgress = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.audio) {
      if (this.audio.src && this.audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.audio.src);
      }
      this.audio.pause();
      this.audio.src = '';
      try { this.audio.load(); } catch { /* ignore */ }
      this.audio = null;
    }

    if (this.mediaSource) {
      try {
        if (this.mediaSource.readyState === 'open') {
          this.mediaSource.endOfStream();
        }
      } catch { /* ignore */ }
      this.mediaSource = null;
    }

    if (this.sourceBuffer) {
      try { this.sourceBuffer.abort(); } catch { /* ignore */ }
      this.sourceBuffer = null;
    }

    this.nextOffset = 0;
    this.totalSize = 0;
    this.onEnded = null;
  }
}

export const mseSecurePlayer = new MSESecurePlayer();
