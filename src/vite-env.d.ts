/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_METERED_DOMAIN?: string;
  readonly VITE_METERED_API_KEY?: string;
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
