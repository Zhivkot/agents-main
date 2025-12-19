/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_RUNTIME_ID: string;
  readonly VITE_AGENT_REGION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
