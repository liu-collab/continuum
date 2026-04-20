export interface WebSocketLike {
  send(data: string): void;
  on(event: "message", listener: (chunk: { toString(): string }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  close(code?: number): void;
}
