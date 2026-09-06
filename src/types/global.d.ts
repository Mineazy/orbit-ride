/// <reference types="vite/client" />

declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.svg' {
  const content: string;
  export default content;
}

interface Window {
  google?: any;
  initGoogleMapCallback?: () => void;
}

interface GlobalFetch {
  (url: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
