declare module "ws" {
  export class WebSocket {
    constructor(url: string | URL, protocols?: string | string[]);
    send(data: string): void;
    close(): void;
    once(event: string, listener: (...args: any[]) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
  }

  export namespace WebSocket {
    type RawData = Buffer | ArrayBuffer | Buffer[] | Uint8Array;
  }

  export class WebSocketServer {
    constructor(options?: any);
    on(event: string, listener: (...args: any[]) => void): this;
    close(callback?: () => void): void;
  }
}
