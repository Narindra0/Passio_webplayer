/// <reference types="vite/client" />

/**
 * Déclaration de type pour vite-plugin-javascript-obfuscator.
 * Le package npm n'inclut pas le dossier dist/ (package corrompu/incomplet).
 * Cette déclaration permet à TypeScript de résoudre le module sans erreur.
 *
 * @see https://www.npmjs.com/package/vite-plugin-javascript-obfuscator
 */
declare module 'vite-plugin-javascript-obfuscator' {
  import type { Plugin } from 'vite';

  interface ObfuscatorOptions {
    compact?: boolean;
    controlFlowFlattening?: boolean;
    deadCodeInjection?: boolean;
    disableConsoleOutput?: boolean;
    identifierNamesGenerator?: 'mangled' | 'mangled-shuffled' | 'hexadecimal';
    renameGlobals?: boolean;
    stringArray?: boolean;
    stringArrayEncoding?: ('base64' | 'rc4')[];
    stringArrayThreshold?: number;
    transformObjectKeys?: boolean;
    unicodeEscapeSequence?: boolean;
    splitStrings?: boolean;
    splitStringsChunkLength?: number;
    debugProtection?: boolean;
    selfDefending?: boolean;
  }

  interface ObfuscatorPluginOptions {
    options?: ObfuscatorOptions;
  }

  /**
   * Plugin Vite pour obfusquer le bundle JavaScript en production.
   * Utilise javascript-obfuscator en interne.
   */
  export default function obfuscator(
    options?: ObfuscatorPluginOptions,
  ): Plugin;
}
