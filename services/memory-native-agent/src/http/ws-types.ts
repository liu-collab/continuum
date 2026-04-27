export interface WebSocketLike {
  readyState?: number;
  send(data: string): void;
  on(event: "message", listener: (chunk: { toString(): string }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  close(code?: number): void;
}
