declare module "@opencode-ai/sdk" {
  export function createOpencode(options?: any): Promise<{
    client: any;
    server: { url?: string; close: () => void };
  }>;

  export function createOpencodeClient(options: any): any;
}

