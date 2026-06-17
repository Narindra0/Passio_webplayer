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
 *
 * Résilience réseau :
 * - keepalive: true via fetchWithRetry → évite la renégociation HTTP/3 ↔ HTTP/2
 * - Exponential backoff sur les erreurs réseau (QUIC/HTTP3 timeouts)
 */

import { fetchWithRetry } from './networkUtils';

const STREAM_HEADER = 'X-Passio-Stream';
const STREAM_HEADER_VALUE = 'secure';
const DEVICE_HEADER = 'x-passio-device-id';
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
  /** ID appareil pour l'authentification des requêtes de streaming */
  public deviceId: string | null = null;
  public currentToken: string | null = null;
  public currentTrackId: string | null = null;

  public onEnded: (() => void) | null = null;

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

  /** Promesse résolue après le premier batch initial (permet de détecter les erreurs QUIC) */
  private resolveInitialBatch: (() => void) | null = null;
  private rejectInitialBatch: ((err: Error) => void) | null = null;

  getAudioElement(): HTMLAudioElement | null {
    return this.audio;
  }

  /**
   * Détecte si le navigateur est sur mobile.
   */
  private static isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  static isSupported(): boolean {
    // Désactiver MSE sur mobile par défaut (meilleure compatibilité avec HTML5 Audio)
    if (this.isMobile()) {
      console.log('[MSE] Désactivé sur mobile pour une meilleure compatibilité');
      return false;
    }
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mp4');
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
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [STREAM_HEADER]: STREAM_HEADER_VALUE,
    };
    if (this.deviceId) {
      headers[DEVICE_HEADER] = this.deviceId;
    }
    if (this.currentToken) {
      headers['X-Audio-Token'] = this.currentToken;
    }
    return headers;
  }

  /**
   * Lance le streaming adaptatif MSE.
   * Retourne l'élément <audio> dès que le premier batch est chargé.
   * 
   * ⚡ Rejette la promesse si le téléchargement initial échoue (ex: erreur QUIC)
   * → le fallback SecureAudioPlayer (téléchargement complet) sera déclenché.
   */
  async loadAndPlay(url: string): Promise<HTMLAudioElement> {
    this.stop();
    this.mimeType = null;
    this.streaming = false;
    this.nextOffset = 0;
    this.totalSize = 0;

    const match = url.match(/\/api\/stream\/tracks\/([^/]+)\/audio/);
    this.currentTrackId = match ? decodeURIComponent(match[1]) : null;

    const controller = new AbortController();
    this.abortController = controller;

    // ── 1. Probe : Content-Type + taille totale ──
    const probeResponse = await fetchWithRetry(url, {
      headers: {
        'Range': 'bytes=0-1',
        ...this.getAuthHeaders(),
      },
      signal: controller.signal,
    });
    if (!probeResponse.ok && probeResponse.status !== 206) {
      throw new Error(`MSESecurePlayer: probe failed with HTTP ${probeResponse.status}`);
    }

    const rawType = probeResponse.headers.get('Content-Type') || 'audio/mpeg';
    let parsedMime = rawType.split(';')[0].trim();
    
    // Workaround: Si le backend renvoie octet-stream, on force audio/mp4
    // pour permettre au lecteur MSE (très rapide) de démarrer sans planter.
    if (parsedMime === 'application/octet-stream' || !MediaSource.isTypeSupported(parsedMime)) {
      console.warn(`[MSE] Type MIME non supporté détecté (${parsedMime}), tentative de forçage en audio/mp4...`);
      parsedMime = 'audio/mp4';
    }
    
    this.mimeType = parsedMime;
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
        const headResp = await fetchWithRetry(url, {
          method: 'HEAD',
          headers: { ...this.getAuthHeaders() },
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

    // ── 5. Créer la promesse du batch initial ──
    const initialBatchPromise = new Promise<void>((resolve, reject) => {
      this.resolveInitialBatch = resolve;
      this.rejectInitialBatch = reject;
    });
    // Timeout de sécurité : si le batch initial prend plus de 30s, on considère l'échec
    const timeoutId = setTimeout(() => {
      if (this.rejectInitialBatch) {
        this.rejectInitialBatch(new Error('Timeout batch initial MSE (30s)'));
      }
    }, 30000);

    // ── 6. Lancer le streaming adaptatif en arrière-plan ──
    this.streaming = true;
    this.startAdaptiveStreaming(url, controller).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[MSESecurePlayer] Streaming error:', err);
    });

    // ⚡ Attendre UNIQUEMENT le premier batch, pas tout le streaming
    // → si le batch initial échoue (QUIC, 403, réseau), la promesse loadAndPlay
    //   est rejetée et le fallback SecureAudioPlayer peut être déclenché.
    // → si le batch initial réussit, on retourne l'audio immédiatement
    //   (le streaming continue en arrière-plan via startAdaptiveStreaming)
    try {
      await initialBatchPromise;
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('[MSE] ❌ Échec batch initial, déclenchement fallback:', error.message);
      this.stop();
      throw error;
    } finally {
      this.resolveInitialBatch = null;
      this.rejectInitialBatch = null;
    }

    // ── 7. Brancher l'événement ended ──
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

      // ✅ Le batch initial a réussi → résoudre la promesse pour que loadAndPlay
      // retourne l'audio. Le streaming continue en arrière-plan Phase 2.
      // Si le batch a échoué (QUIC, 403), startAdaptiveStreaming est déjà dans le catch.
      if (this.resolveInitialBatch) {
        this.resolveInitialBatch();
        this.resolveInitialBatch = null;
        this.rejectInitialBatch = null;
      }

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
      // ⚡ AbortError = arrêt demandé (ex: changement de piste)
      // Il faut impérativement résoudre/rejeter la promesse du batch initial
      // pour que loadAndPlay ne reste pas bloqué indéfiniment.
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (this.rejectInitialBatch) {
          this.rejectInitialBatch(new Error('Lecture annulée (changement de piste)'));
        }
        return;
      }
      if (this.rejectInitialBatch) {
        this.rejectInitialBatch(err instanceof Error ? err : new Error(String(err)));
      }
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
   * Avec retry automatique via fetchWithRetry pour les erreurs QUIC/HTTP3.
   */
  private async downloadBatch(url: string, count: number, controller: AbortController) {
    if (this.downloadInProgress) return;
    this.downloadInProgress = true;

    try {
      for (let i = 0; i < count && this.streaming && !controller.signal.aborted; i++) {
        if (this.nextOffset >= this.totalSize) break;

        const end = Math.min(this.nextOffset + CHUNK_SIZE - 1, this.totalSize - 1);

        const response = await fetchWithRetry(url, {
          headers: {
            'Range': `bytes=${this.nextOffset}-${end}`,
            ...this.getAuthHeaders(),
          },
          signal: controller.signal,
          retries: 3,
        });

        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status} during chunk download`);
        }

        const chunk = await response.arrayBuffer();
        if (!this.streaming || controller.signal.aborted) break;

        let bufferToAppend = chunk;
        // --- XOR DECHIFFREMENT TEMPORAIREMENT DÉSACTIVÉ ---
        // if (this.currentTrackId) {
        //   const uint8 = new Uint8Array(chunk);
        //   const seed = await this.getXorSeed(this.currentTrackId);
        //   const seedHex = Array.from(seed).map(b => b.toString(16).padStart(2, '0')).join('');
        //   console.log(`[XOR MSE] Track: ${this.currentTrackId}, Seed Hash (hex): ${seedHex}, Chunk Size: ${uint8.length}, Offset: ${this.nextOffset}`);
        //   console.log(`[XOR MSE] Before De-XOR (first 16 bytes): ${Array.from(uint8.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')}`);
        //   this.applyXor(uint8, seed, this.nextOffset);
        //   console.log(`[XOR MSE] After De-XOR (first 16 bytes): ${Array.from(uint8.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')}`);
        //   bufferToAppend = uint8.buffer;
        // }

        // Attendre que le SourceBuffer soit prêt (avec timeout)
        if (this.sourceBuffer!.updating) {
          await this.waitForSourceBufferUpdate(controller);
        }
        if (!this.streaming || controller.signal.aborted) break;

        this.sourceBuffer!.appendBuffer(bufferToAppend);
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
